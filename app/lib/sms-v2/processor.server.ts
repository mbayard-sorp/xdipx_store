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
 *   4. On AGE_CONFIRM intent: write 'sms_yes_v2' consent method + fire
 *      subscribeToSms() (fire-and-forget, non-fatal).
 *
 * The contract still matches processSmsMessage byte-for-byte on outputs
 * (ProcessSmsResult). v2's dark-launch path is byte-identical to v1.
 */
import { processSmsMessage } from '~/lib/sms-processor.server'
import { getOrCreateConversation } from './conversation.server'
import { classifyIntent } from './intent-classifier.server'
import { withTurnLogging } from './turn-logger.server'
import { subscribeToSms } from './klaviyo.server'
import { db } from '~/lib/db.server'
import { smsAgeConsent } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import type { Stage } from './types.server'

// Re-export types so callers can switch by import only — no re-definition needed.
export type { ProcessSmsInput, ProcessSmsResult, SmsSegment } from '~/lib/sms-processor.server'

// ---------------------------------------------------------------------------
// Consent v2 helper
// ---------------------------------------------------------------------------

/**
 * Upgrade consent record to 'sms_yes_v2' if it exists with an older method.
 * Non-fatal — any error is logged and swallowed.
 */
async function upgradeConsentMethod(phone: string): Promise<void> {
  try {
    await db
      .update(smsAgeConsent)
      .set({ method: 'sms_yes_v2' })
      .where(eq(smsAgeConsent.phone, phone))
  } catch (err) {
    console.warn('[processor-v2] upgradeConsentMethod failed', err)
  }
}

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

  // --- Step 3: AGE_CONFIRM consent upgrade + Klaviyo subscribe ---
  if (intentResult.intent === 'AGE_CONFIRM') {
    // Upgrade consent record (written by v1 processor below) to 'sms_yes_v2'
    void upgradeConsentMethod(phone)

    // Fire-and-forget Klaviyo subscribe — non-fatal
    void subscribeToSms(phone, {
      source: 'sms_consent_yes',
      consentTimestamp: new Date(),
    }).catch((err) => {
      console.warn('[processor-v2] subscribeToSms failed (non-fatal)', err)
    })
  }

  // --- Step 4: Call v1 processor via withTurnLogging, passing observability ---
  const stageLabel = conversation.stage as string
  return withTurnLogging(
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
}
