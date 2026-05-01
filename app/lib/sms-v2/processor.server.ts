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

  // Re-run getOrCreateConversation with the intent so the 6h stage TTL check
  // can fire if needed. This second call is cheap (the DB row was just read).
  try {
    conversation = await getOrCreateConversation(phone, intentResult.intent)
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
    })

    result = await withTurnLoggingForStageResponse(input, stageResp, 'v2', {
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      stageIn: effectiveStage,
      stageOut: stageResp.stageOut,
      inputTokens: stageResp.telemetry.inputTokens,
      outputTokens: stageResp.telemetry.outputTokens,
      toolCalls: stageResp.telemetry.toolCalls,
      fabricationCaught: stageResp.telemetry.fabricationCaught,
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

  return result
}
