/**
 * app/lib/sms-v2/stage-dispatch.server.ts
 *
 * Phase 5.5 — Stage handler registry and dispatcher.
 *
 * Responsibilities:
 *   1. pickEffectiveStage() — intent-driven stage override BEFORE the handler runs.
 *   2. STAGE_HANDLERS registry — maps Stage values to their handler functions.
 *   3. dispatchStage() — looks up handler and calls it.
 *   4. stageResponseToProcessResult() — adapts StageResponse to ProcessSmsResult.
 */
import type { EmmaContext, IntentResult, StageResponse, Stage } from './types.server'
import type { ProcessSmsResult, SmsSegment } from '~/lib/sms-processor.server'
import { executeCheckoutStage } from './stages/checkout.server'
import { executeUpsellStage } from './stages/upsell.server'
import { executePresentationStage } from './stages/presentation.server'
import { executeDiscoveryStage } from './stages/discovery.server'
// Phase 6 stage handlers
import { executeObjectionStage } from './stages/objection.server'
import { executeResearchStage } from './stages/research.server'
import { executeSupportStage } from './stages/support.server'
import { executePostPurchaseStage } from './stages/post-purchase.server'
import { executeReconnectStage } from './stages/reconnect.server'

// ---------------------------------------------------------------------------
// 1. Intent-driven stage shim
// ---------------------------------------------------------------------------

/**
 * Some intents force a stage transition BEFORE the handler runs.
 *
 * Transition table (from spec Deliverable 1):
 *   PRESENTATION + COMMIT_PICK   → UPSELL (pitch the upsell first)
 *   UPSELL       + UPSELL_ACCEPT → CHECKOUT
 *   UPSELL       + UPSELL_DECLINE → CHECKOUT
 *   UPSELL       + COMMIT_PICK   → CHECKOUT
 *   OBJECTION    + COMMIT_PICK   → CHECKOUT
 *   DISCOVERY    + NAME_ITEM     → DISCOVERY (handler itself decides)
 *
 * All other pairs: return currentStage unchanged.
 */
export function pickEffectiveStage(currentStage: Stage, intent: IntentResult): Stage {
  const i = intent.intent

  switch (currentStage) {
    case 'PRESENTATION':
      if (i === 'COMMIT_PICK') return 'UPSELL'
      break

    case 'UPSELL':
      if (i === 'UPSELL_ACCEPT' || i === 'UPSELL_DECLINE' || i === 'COMMIT_PICK') return 'CHECKOUT'
      break

    case 'OBJECTION':
      if (i === 'COMMIT_PICK') return 'CHECKOUT'
      break

    default:
      // DISCOVERY + NAME_ITEM: handler decides internally — no pre-transition needed.
      // All other stages: pass through unchanged.
      break
  }

  return currentStage
}

// ---------------------------------------------------------------------------
// 2. Stage handler registry
// ---------------------------------------------------------------------------

export type StageHandler = (
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
) => Promise<StageResponse>

export const STAGE_HANDLERS: Partial<Record<Stage, StageHandler>> = {
  CHECKOUT:      executeCheckoutStage,
  UPSELL:        executeUpsellStage,
  PRESENTATION:  executePresentationStage,
  DISCOVERY:     executeDiscoveryStage,
  // Phase 6 — late-bound stages
  OBJECTION:     executeObjectionStage,
  RESEARCH:      executeResearchStage,
  SUPPORT:       executeSupportStage,
  POST_PURCHASE: executePostPurchaseStage,
  RECONNECT:     executeReconnectStage,
}

// ---------------------------------------------------------------------------
// 3. Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch to the registered stage handler. Returns null if no handler exists
 * for the stage (caller should fall through to v1).
 */
export function dispatchStage(
  stage: Stage,
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> | null {
  const handler = STAGE_HANDLERS[stage]
  return handler ? handler(ctx, intent, customerText) : null
}

// ---------------------------------------------------------------------------
// 4. Response adapter
// ---------------------------------------------------------------------------

/**
 * Convert a StageResponse to the ProcessSmsResult shape expected by the
 * webhook route and turn-logger.
 *
 * - replies: each segment maps to an SmsSegment. body = segment.prose.
 *   mediaUrl = segment.productCard?.imageUrl. Empty prose segments are dropped.
 * - reply: all prose joined with "\n\n", or null if no segments.
 * - outcome: 'reply_fallback' if telemetry.fabricationCaught, else 'reply'.
 * - simulated: threaded through from caller (not part of StageResponse).
 */
export function stageResponseToProcessResult(
  resp: StageResponse,
  simulated: boolean,
): ProcessSmsResult {
  const replies: SmsSegment[] = resp.segments
    .filter((s) => s.prose.trim().length > 0)
    .map((s): SmsSegment => ({
      body: s.prose,
      ...(s.productCard?.imageUrl ? { mediaUrl: s.productCard.imageUrl } : {}),
    }))

  const reply =
    replies.length > 0
      ? replies.map((r) => r.body).join('\n\n')
      : null

  const outcome: ProcessSmsResult['outcome'] = resp.telemetry.fabricationCaught
    ? 'reply_fallback'
    : 'reply'

  // simulated is threaded through but ProcessSmsResult doesn't carry it;
  // void it to satisfy the linter.
  void simulated

  return { replies, reply, outcome }
}
