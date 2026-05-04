/**
 * app/lib/sms-v2/stages/post-checkout.server.ts
 *
 * POST_CHECKOUT stage handler. Flag-aware dispatch shim, same pattern as
 * stages/discovery.server.ts and stages/objection.server.ts:
 *
 *   - When DISCOVERY_AGENT_VERSION (or per-phone allowlist) resolves to
 *     'v2-agent', route to the unified Sonnet conversation agent with
 *     stage='POST_CHECKOUT' so the POST_CHECKOUT stage addendum fires.
 *
 *   - Otherwise fall through to a deterministic gate handler that warmly
 *     acknowledges the customer and offers help. This path is only hit
 *     if someone deliberately runs the gate fallback for POST_CHECKOUT.
 *
 * The conversation agent is the intended production path; the gate
 * fallback exists so flipping the env flag back to 'v2-gate' in an
 * emergency rollback still produces something coherent here instead of
 * falling all the way through to v1.
 */
import { executeConversationAgent } from '../conversation-agent.server'
import { pickDiscoveryAgentVersion } from '../discovery-agent-flag.server'
import { resolveTransition } from '../transitions.server'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

export async function executePostCheckoutStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const version = pickDiscoveryAgentVersion(ctx.conversation.phone)
  if (version === 'v2-agent') {
    return executeConversationAgent({ ctx, intent, customerText, stage: 'POST_CHECKOUT' })
  }
  return executePostCheckoutStageGate(ctx, intent, customerText)
}

/**
 * Deterministic POST_CHECKOUT fallback for the 'v2-gate' branch.
 * Warm acknowledgement, no pitch, no tool calls. Stays on POST_CHECKOUT
 * so subsequent turns continue to dispatch here until the flag flips
 * back to v2-agent or the customer pivots into another stage via intent
 * routing.
 */
async function executePostCheckoutStageGate(
  _ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string,
): Promise<StageResponse> {
  return {
    stageOut: resolveTransition('POST_CHECKOUT', 'POST_CHECKOUT'),
    goalAchieved: false,
    segments: [
      {
        prose: "All set on your end? Want me to help with anything else, or are you good?",
      },
    ],
    stateWrites: { stage: 'POST_CHECKOUT' },
    telemetry: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      inputTokens: 0,
      outputTokens: 0,
    },
  }
}
