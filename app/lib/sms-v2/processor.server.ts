/**
 * app/lib/sms-v2/processor.server.ts
 *
 * Phase 1: conversation entity + intent classifier wired into the v2 pipeline.
 *
 * The actual reply prose still comes from v1's processSmsMessage — no new
 * stage handlers in Phase 1. This is the "legacy LLM turn" pass-through
 * described in the plan.
 *
 * What's new in Phase 1:
 *   1. getOrCreateConversation() — triggers 24h rotation + 6h stage TTL check.
 *   2. classifyIntent() — labels every inbound turn with an Intent.
 *   3. withTurnLogging() receives intent + stage fields via the new
 *      TurnObservabilityUpdate param so sms_turns rows are populated.
 *   4. On AGE_CONFIRM intent (real path only): fire subscribeToSms() to
 *      Klaviyo SMS list (fire-and-forget, non-fatal). v1 writes the consent
 *      method tag directly: 'sms_yes_v2' for real, 'sms_yes_v2_sim' for sim.
 *
 * The contract still matches processSmsMessage byte-for-byte on outputs
 * (ProcessSmsResult). v2's dark-launch path is byte-identical to v1.
 */
import { processSmsMessage } from '~/lib/sms-processor.server'
import { getOrCreateConversation, applyStateWrites } from './conversation.server'
import { classifyIntent } from './intent-classifier.server'
import { withTurnLogging, withTurnLoggingForStageResponse } from './turn-logger.server'
import { subscribeToSms } from './klaviyo.server'
import { pickEffectiveStage, dispatchStage } from './stage-dispatch.server'
import { buildEmmaContextWithCrossChannel } from './cross-channel.server'
import { loadConversationHistory } from './conversation-history.server'
import { generateConversationSummary } from './summary.server'
import { db } from '~/lib/db.server'
import { smsAgeConsent } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import type { Stage } from './types.server'

// Re-export types so callers can switch by import only — no re-definition needed.
export type { ProcessSmsInput, ProcessSmsResult, SmsSegment } from '~/lib/sms-processor.server'

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function processSmsMessageV2(
  input: Parameters<typeof processSmsMessage>[0],
): Promise<Awaited<ReturnType<typeof processSmsMessage>>> {
  const phone = input.from.trim()

  // --- Step 1: Get or create conversation (with rotation logic) ---
  let conversation: Awaited<ReturnType<typeof getOrCreateConversation>>
  try {
    conversation = await getOrCreateConversation(phone)
  } catch (err) {
    console.error('[processor-v2] getOrCreateConversation failed — falling back to v1', err)
    return processSmsMessage(input)
  }

  // --- Step 2: Classify intent ---
  let intentResult: Awaited<ReturnType<typeof classifyIntent>>
  try {
    intentResult = await classifyIntent(
      { stage: conversation.stage as Stage },
      input.body,
    )
  } catch (err) {
    console.error('[processor-v2] classifyIntent failed — continuing without intent', err)
    intentResult = { intent: 'OFF_TOPIC', confidence: 0.0, source: 'fallback' }
  }

  // Re-run getOrCreateConversation with the intent so the stage TTL check
  // can fire if needed (Task 0.8: now gated on 24h + confidence >= 0.75).
  // Pass intentConfidence so low-confidence intent labels don't silently reset stage.
  try {
    conversation = await getOrCreateConversation(phone, intentResult.intent, intentResult.confidence)
  } catch {
    // Non-fatal — we already have a conversation object from the first call
  }

  // --- Step 3: v2 stage dispatch (Phase 5.5) ---
  // Resolve the effective stage (may differ from conversation.stage due to
  // intent-driven pre-transitions), then try to dispatch to a v2 handler.
  // Stages without a handler (GREETING, CONSENT_GATE, RECONNECT, SUPPORT, etc.)
  // return null here and fall through to v1.
  const effectiveStage = pickEffectiveStage(conversation.stage as Stage, intentResult)
  const stageLabel = conversation.stage as string

  let result: Awaited<ReturnType<typeof processSmsMessage>>

  const ctx = await buildEmmaContextWithCrossChannel(conversation, 'sms')

  // ADR-003 Sub-decision B: load history BEFORE dispatch so the summarizer
  // has it regardless of which stage handler runs (agent path or gate-machine).
  // The conversation agent also loads history internally for the Sonnet call;
  // this second load is acceptable at current volume and keeps the dispatcher
  // self-contained. See coupling analysis in ADR-003.
  let historyForSummarizer: Awaited<ReturnType<typeof loadConversationHistory>> = []
  try {
    historyForSummarizer = await loadConversationHistory(conversation.conversationId, 12)
  } catch (err) {
    console.warn('[processor-v2] failed to load history for summarizer (non-fatal)', err)
  }

  const stageRespPromise = dispatchStage(effectiveStage, ctx, intentResult, input.body)

  if (stageRespPromise !== null) {
    // v2 stage handler ran — persist state writes, log telemetry, return adapted result.
    const stageResp = await stageRespPromise

    // Persist state (stage transition + any handles/URLs the handler wrote).
    // Build the writes object explicitly to satisfy exactOptionalPropertyTypes.
    const writes = stageResp.stateWrites
    await applyStateWrites(phone, {
      // Always persist the resolved stageOut even if stateWrites.stage is absent.
      stage: writes.stage ?? stageResp.stageOut,
      ...(writes.currentPitchHandle  !== undefined && { currentPitchHandle:  writes.currentPitchHandle }),
      ...(writes.currentUpsellHandle !== undefined && { currentUpsellHandle: writes.currentUpsellHandle }),
      ...(writes.lastQuoteUrl        !== undefined && { lastQuoteUrl:        writes.lastQuoteUrl }),
      ...(writes.lastQuoteItems      !== undefined && { lastQuoteItems:      writes.lastQuoteItems }),
      ...(writes.lastQuoteCreatedAt  !== undefined && { lastQuoteCreatedAt:  writes.lastQuoteCreatedAt }),
      ...(writes.customerGid         !== undefined && { customerGid:         writes.customerGid }),
      // Discovery gate columns — passed through as raw JSON (types are unknown
      // here to avoid circular imports; the DB column is JSONB).
      ...(writes.discoveryState  !== undefined && { discoveryState:  writes.discoveryState }),
      ...(writes.discoveredSlots !== undefined && { discoveredSlots: writes.discoveredSlots }),
      // Migration 032: memory primitive writes.
      // conversationSummary is written by the fire-and-forget below (not the agent).
      // If the stage handler explicitly sets it, honor it here too.
      ...(writes.conversationSummary !== undefined && { conversationSummary: writes.conversationSummary }),
      // pitched_handles_log — built by conversation-agent; also updated by the
      // fire-and-forget block below when the agent path ran.
      ...(writes.pitchedHandlesLog   !== undefined && { pitchedHandlesLog:   writes.pitchedHandlesLog }),
    })

    // ADR-003 Sub-decision B: fire-and-forget memory primitives AFTER applyStateWrites.
    // Covers the gate-machine path (runSearchBranch, executeDiscoveryGate) which
    // previously bypassed generateConversationSummary entirely (Phase 0 regression).
    // Also covers the agent path — executeConversationAgent no longer fires the
    // summarizer internally (deduplication: dispatcher is the single location).
    //
    // Non-blocking: do not await before returning reply to caller. Phase 0 condition #1.
    void (async () => {
      try {
        // Append new pitch handle to the log when the handler pitched something
        // via a path that didn't go through conversation-agent (which handles
        // pitchedHandlesLog internally). Guard: skip if already written above.
        const newPitchHandle = writes.currentPitchHandle
        if (newPitchHandle && writes.pitchedHandlesLog === undefined) {
          const prior = conversation.pitchedHandlesLog ?? []
          const updated = [...prior, newPitchHandle].slice(-10)
          await applyStateWrites(phone, { pitchedHandlesLog: updated }).catch((err) =>
            console.warn('[processor-v2] pitchedHandlesLog update failed (non-fatal)', err)
          )
        }

        // Haiku summarizer — uses the history snapshot loaded before dispatch.
        const summary = await generateConversationSummary(
          historyForSummarizer,
          conversation.conversationSummary ?? null,
        )
        if (summary) {
          await applyStateWrites(phone, { conversationSummary: summary }).catch((err) =>
            console.warn('[processor-v2] conversationSummary update failed (non-fatal)', err)
          )
        }
      } catch (err) {
        console.warn('[processor-v2] memory primitive update failed (non-fatal)', err)
      }
    })()

    result = await withTurnLoggingForStageResponse(input, stageResp, 'v2', {
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      stageIn: effectiveStage,
      stageOut: stageResp.stageOut,
      inputTokens: stageResp.telemetry.inputTokens,
      outputTokens: stageResp.telemetry.outputTokens,
      toolCalls: stageResp.telemetry.toolCalls,
      fabricationCaught: stageResp.telemetry.fabricationCaught,
      softBeat: stageResp.telemetry.softBeat,
      toolBudgetExhausted: stageResp.telemetry.toolBudgetExhausted,
    })
  } else {
    // No v2 handler for this stage — fall through to v1 (existing Phase 1 behavior).
    // v1 directly writes the correct consent method tag based on input.simulated:
    //   - real Twilio path → 'sms_yes_v2'
    //   - simulator path   → 'sms_yes_v2_sim'
    result = await withTurnLogging(
      input,
      processSmsMessage,
      'v2',
      {
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        stageIn: stageLabel,
        stageOut: stageLabel,  // v1 fallback: no stage transition
      },
    )
  }

  // --- Step 4: AGE_CONFIRM post-processing — Klaviyo subscribe ---
  // Fire-and-forget; non-fatal. Klaviyo is for real consents only — simulator
  // turns shouldn't pollute the marketing list.
  if (intentResult.intent === 'AGE_CONFIRM' && !(input.simulated ?? false)) {
    void subscribeToSms(phone, {
      source: 'sms_consent_yes',
      consentTimestamp: new Date(),
    }).catch((err) => {
      console.warn('[processor-v2] subscribeToSms failed (non-fatal)', err)
    })
  }

  // --- Step 5: GREETING → DISCOVERY transition once consent is on file ---
  // The conversation row defaults to stage='GREETING'. Nothing else in the
  // pipeline transitions out of it: GREETING has no v2 stage handler, and
  // v1's processSmsMessage inserts the consent row but doesn't update the
  // conversation row. Result: stuck in GREETING forever, every turn falls
  // through to v1.
  //
  // Fix: post-turn, if we're still in GREETING but the customer is past the
  // consent gate (consent row exists), bump to DISCOVERY so the next turn
  // dispatches to the DISCOVERY stage handler. This handles two cases:
  //   1. AGE_CONFIRM turn: v1 just inserted consent → bump now → next turn
  //      lands in DISCOVERY.
  //   2. Returning consented customer with a fresh conversation row: bump
  //      immediately on first contact → no wasted v1 turns.
  // RECONNECT (set by getOrCreateConversation's 24h rotation) is preserved
  // because we only bump when stage === 'GREETING'.
  if (conversation.stage === 'GREETING') {
    try {
      const consent = await db
        .select({ phone: smsAgeConsent.phone })
        .from(smsAgeConsent)
        .where(eq(smsAgeConsent.phone, phone))
        .limit(1)
      if (consent.length > 0) {
        await applyStateWrites(phone, { stage: 'DISCOVERY' })
      }
    } catch (err) {
      console.warn('[processor-v2] post-consent stage bump failed (non-fatal)', err)
    }
  }

  return result
}
