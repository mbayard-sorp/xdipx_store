/**
 * app/lib/sms-v2/discovery-agent.server.ts
 *
 * Sonnet-driven DISCOVERY stage handler — replaces the gate-state-machine
 * handler when DISCOVERY_AGENT_VERSION='v2-agent' or the conversation is on
 * the agent allowlist.
 *
 * Phase 1 status: STUB. Wire-up only — returns a "not yet implemented"
 * StageResponse so the env-flag dispatch is exercised end-to-end with zero
 * production risk. The real Sonnet loop, system prompt, and fabrication
 * guards land in Phase 2.
 *
 * Public signature mirrors executeDiscoveryGate exactly so the dispatcher can
 * swap them without any other plumbing changes.
 */
import { resolveTransition } from './transitions.server'
import type { EmmaContext, IntentResult, StageResponse } from './types.server'

export async function executeDiscoveryAgent(
  _ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string,
): Promise<StageResponse> {
  // Phase 1 placeholder — exercises the wiring without doing any real work.
  // Phase 2 replaces the body with the Sonnet loop + tools + fabrication
  // guards. Until then this returns a benign holding reply so a flipped
  // allowlist phone doesn't crash the call.
  return {
    stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
    goalAchieved: false,
    segments: [
      {
        prose:
          "Discovery agent (Phase 1 stub) — not yet implemented. Tell me a little about what you're after and I'll find something that fits.",
      },
    ],
    stateWrites: {
      stage: 'DISCOVERY',
    },
    telemetry: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      inputTokens: 0,
      outputTokens: 0,
    },
  }
}
