/**
 * app/lib/sms-v2/discovery-agent.server.ts
 *
 * Legacy entry point preserved for backwards compatibility. Phase 6 unified
 * the Sonnet conversation logic into conversation-agent.server.ts which
 * handles DISCOVERY, PRESENTATION, and OBJECTION uniformly. This shim keeps
 * existing callers (stage-dispatch, tests) wired without churn.
 *
 * Phase 6b cleanup will inline the conversation-agent call at the call sites
 * and delete this file.
 */
import { executeConversationAgent } from './conversation-agent.server'
import type { EmmaContext, IntentResult, StageResponse } from './types.server'

export async function executeDiscoveryAgent(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  return executeConversationAgent({ ctx, intent, customerText, stage: 'DISCOVERY' })
}
