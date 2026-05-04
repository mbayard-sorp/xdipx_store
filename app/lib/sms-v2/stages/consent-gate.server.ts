/**
 * app/lib/sms-v2/stages/consent-gate.server.ts
 *
 * Deterministic CONSENT_GATE handler. Mirrors v1's age-confirm branch
 * (lines 109-115 of sms-processor.server.ts):
 *
 *   1. Insert into smsAgeConsent (onConflictDoNothing on the phone PK).
 *   2. Send AGE_WELCOME_REPLY.
 *   3. Bump stage to DISCOVERY so the next turn lands in the agent.
 *
 * The dispatcher's pickEffectiveStage routes GREETING + AGE_CONFIRM here
 * before this handler runs. The intent is therefore expected to be
 * AGE_CONFIRM in the common path.
 *
 * Edge case — stage was set to CONSENT_GATE without an AGE_CONFIRM intent:
 * the customer didn't actually say YES. Re-prompt with AGE_GATE_REPLY and
 * stay in CONSENT_GATE without writing consent.
 *
 * Trade-off on the `simulated` flag: EmmaContext does not currently
 * carry simulated, and the existing handler signature
 * (ctx, intent, customerText) is shared by every stage. Rather than
 * thread `simulated` through every handler for one consumer, this insert
 * uses method='sms_yes_v2' for both real and simulator paths. Practical
 * effect: a small number of simulator turns get tagged as real consent
 * in sms_age_consent. The Klaviyo subscribe in processor.server.ts is
 * already gated on input.simulated (step 4), so the marketing list
 * stays clean either way. A future cleanup can wire `simulated` through
 * the StageHandler signature if we ever need that fidelity in the
 * consent table.
 */
import { db } from '~/lib/db.server'
import { smsAgeConsent } from '../../../../db/schema'
import { resolveTransition } from '../transitions.server'
import {
  AGE_GATE_REPLY,
  AGE_WELCOME_REPLY,
} from '../templates/compliance-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

export async function executeConsentGateStage(
  ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string,
): Promise<StageResponse> {
  const phone = ctx.conversation.phone
  const baseTelemetry = {
    intent: intent.intent,
    intentConfidence: intent.confidence,
    inputTokens: 0,
    outputTokens: 0,
  }

  // Edge case: routed to CONSENT_GATE but no AGE_CONFIRM. Re-prompt and stay.
  if (intent.intent !== 'AGE_CONFIRM') {
    return {
      stageOut: resolveTransition('CONSENT_GATE', 'CONSENT_GATE'),
      goalAchieved: false,
      segments: [{ prose: AGE_GATE_REPLY }],
      stateWrites: { stage: 'CONSENT_GATE' },
      telemetry: baseTelemetry,
    }
  }

  // Happy path — record consent (idempotent on the phone PK).
  try {
    await db
      .insert(smsAgeConsent)
      .values({ phone, method: 'sms_yes_v2' })
      .onConflictDoNothing({ target: smsAgeConsent.phone })
  } catch (err) {
    // Non-fatal: if the insert fails, the next inbound turn will re-route
    // through GREETING and we'll try again. Better to send the welcome
    // than crash the webhook.
    console.error('[sms-v2/consent-gate] consent insert failed (non-fatal)', err)
  }

  return {
    stageOut: resolveTransition('CONSENT_GATE', 'DISCOVERY'),
    goalAchieved: false,
    segments: [{ prose: AGE_WELCOME_REPLY }],
    stateWrites: { stage: 'DISCOVERY' },
    telemetry: baseTelemetry,
  }
}
