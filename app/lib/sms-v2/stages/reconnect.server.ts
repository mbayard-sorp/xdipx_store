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
import { getCrossChannelHint } from '../cross-channel.server'
import { pickCrossChannelTemplate } from '../templates/cross-channel-templates'
import { runCatalogLookup } from './discovery.server'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ─── Main export ──────────────────────────────────────────────────────────────

export async function executeReconnectStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  // A returning customer whose first message back is itself a product question
  // ("do you sell X?") gets real catalog results rather than a generic reconnect
  // greeting. NAME_ITEM is the classifier's product/category intent; answer it
  // from the shared catalog search before falling back to the greeting paths.
  if (intent.intent === 'NAME_ITEM') {
    return runCatalogLookup(ctx, intent, customerText)
  }

  // Phase 10 — Cross-channel continuation: if the customer was active on
  // another channel recently and was looking at a specific product, surface
  // that immediately and route to DISCOVERY so the next turn can pick up.
  const xchannel = getCrossChannelHint(ctx)
  if (xchannel && xchannel.topic.kind === 'product') {
    return {
      stageOut: resolveTransition('RECONNECT', 'DISCOVERY'),
      goalAchieved: false,
      segments: [{
        prose: pickCrossChannelTemplate({
          channelLabel: xchannel.otherChannel === 'web' ? 'web chat' : 'text',
          productTitle: xchannel.topic.title ?? xchannel.topic.handle,
        }),
      }],
      stateWrites: { stage: 'DISCOVERY', currentPitchHandle: xchannel.topic.handle },
      telemetry: { intent: intent.intent, intentConfidence: intent.confidence },
    }
  }
  // If xchannel hint is topic.kind='stage', fall through to existing logic below.

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
