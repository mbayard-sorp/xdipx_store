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
import { getOrCreateConversation } from './conversation.server'
import { classifyIntent } from './intent-classifier.server'
import { withTurnLogging } from './turn-logger.server'
import { subscribeToSms } from './klaviyo.server'
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

  // --- Step 3: Call v1 processor via withTurnLogging, passing observability ---
  // v1 directly writes the correct consent method tag based on input.simulated:
  //   - real Twilio path → 'sms_yes_v2'
  //   - simulator path   → 'sms_yes_v2_sim'
  // No post-insert upgrade needed.
  const stageLabel = conversation.stage as string
  const result = await withTurnLogging(
    input,
    processSmsMessage,
    'v2',
    {
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      stageIn: stageLabel,
      stageOut: stageLabel,  // Phase 1: no stage transitions yet; stageOut = stageIn
    },
  )

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
