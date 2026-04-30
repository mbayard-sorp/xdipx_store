/**
 * app/lib/sms-v2/stages/reconnect.server.ts
 *
 * Phase 6b — RECONNECT stage handler.
 *
 * Customer returned after >24h (set by getOrCreateConversation rotation).
 * One-turn stage. No LLM call. Templated greeting based on prior signals.
 *
 * After this greeting, the next turn reclassifies intent and the Phase 5.5
 * shim routes to DISCOVERY, POST_PURCHASE, or SUPPORT as appropriate.
 * For this phase, stageOut is always DISCOVERY (safe next hop).
 */

import { resolveTransition } from '../transitions.server'
import {
  pickReconnectWithOrderTemplate,
  pickReconnectColdTemplate,
} from '../templates/reconnect-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ─── Main export ──────────────────────────────────────────────────────────────

export async function executeReconnectStage(
  ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string,
): Promise<StageResponse> {
  const lastItem = ctx.customer?.lastOrderItems?.[0]

  const prose = lastItem
    ? pickReconnectWithOrderTemplate({ itemTitle: lastItem.title })
    : pickReconnectColdTemplate()

  return {
    // RECONNECT is a one-turn stage. Route to DISCOVERY — the next turn's
    // intent classifier will reclassify and the shim will route correctly
    // to DISCOVERY, POST_PURCHASE, or SUPPORT.
    stageOut:     resolveTransition('RECONNECT', 'DISCOVERY'),
    goalAchieved: false,
    segments:     [{ prose }],
    stateWrites:  { stage: 'DISCOVERY' },
    telemetry: {
      intent:           intent.intent,
      intentConfidence: intent.confidence,
    },
  }
}
