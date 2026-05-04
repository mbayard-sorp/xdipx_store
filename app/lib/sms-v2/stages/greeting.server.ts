/**
 * app/lib/sms-v2/stages/greeting.server.ts
 *
 * Deterministic GREETING handler. Replaces the v1 fallthrough for new
 * GREETING-stage turns. No LLM, no tool hops. Two paths:
 *
 *   a. Returning customer with consent already on file —
 *      send RETURNING_GREETING_REPLY and bump stage to DISCOVERY so the
 *      next turn lands in the discovery agent. The processor's post-turn
 *      consent-bump (belt-and-braces) does this too, but writing it here
 *      means a single round-trip on this turn instead of two.
 *
 *   b. New customer (no consent row) —
 *      send AGE_GATE_REPLY and stay in GREETING. Stage stays put because
 *      consent has not been recorded yet.
 *
 * Detection: 3s timeout-wrapped check against smsAgeConsent. On timeout
 * we default to (b) — re-prompting is harmless if they're already
 * consented; the next turn's processor consent-bump will route them past
 * GREETING anyway.
 *
 * AGE_CONFIRM intent in GREETING is pre-routed by the dispatcher's
 * pickEffectiveStage to CONSENT_GATE — this handler does not need to
 * confirm consent itself.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsAgeConsent } from '../../../../db/schema'
import { withTimeout } from '~/lib/twilio.server'
import { resolveTransition } from '../transitions.server'
import {
  AGE_GATE_REPLY,
  RETURNING_GREETING_REPLY,
} from '../templates/compliance-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

const CONSENT_LOOKUP_TIMEOUT_MS = 3000

async function hasAgeConsent(phone: string): Promise<boolean> {
  try {
    const rows = await withTimeout(
      db
        .select({ phone: smsAgeConsent.phone })
        .from(smsAgeConsent)
        .where(eq(smsAgeConsent.phone, phone))
        .limit(1),
      CONSENT_LOOKUP_TIMEOUT_MS,
      [],
      'sms-v2/greeting consent lookup',
    )
    return rows.length > 0
  } catch (err) {
    console.error('[sms-v2/greeting] consent lookup threw, defaulting to "no consent"', err)
    return false
  }
}

export async function executeGreetingStage(
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

  const consented = await hasAgeConsent(phone)

  if (consented) {
    // Path (a) — returning customer. Bump to DISCOVERY so the next turn
    // dispatches to the discovery agent. The processor's post-turn
    // consent-bump would do this too; writing it here saves a turn.
    return {
      stageOut: resolveTransition('GREETING', 'DISCOVERY'),
      goalAchieved: false,
      segments: [{ prose: RETURNING_GREETING_REPLY }],
      stateWrites: { stage: 'DISCOVERY' },
      telemetry: baseTelemetry,
    }
  }

  // Path (b) — no consent on file. Re-prompt and stay in GREETING.
  return {
    stageOut: resolveTransition('GREETING', 'GREETING'),
    goalAchieved: false,
    segments: [{ prose: AGE_GATE_REPLY }],
    stateWrites: { stage: 'GREETING' },
    telemetry: baseTelemetry,
  }
}
