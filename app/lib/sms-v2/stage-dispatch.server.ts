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
import { splitProseAtUrl } from '~/lib/sms-reply-segments.server'
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
// V1 retirement: GREETING / CONSENT_GATE / POST_CHECKOUT now handled in v2.
import { executeGreetingStage } from './stages/greeting.server'
import { executeConsentGateStage } from './stages/consent-gate.server'
import { executePostCheckoutStage } from './stages/post-checkout.server'

// ---------------------------------------------------------------------------
// 1. Intent-driven stage shim
// ---------------------------------------------------------------------------

/**
 * Some intents force a stage transition BEFORE the handler runs.
 *
 * Transition table:
 *   GREETING     + AGE_CONFIRM   → CONSENT_GATE (record consent + welcome)
 *   PRESENTATION + COMMIT_PICK   → UPSELL (pitch the upsell first)
 *   UPSELL       + UPSELL_ACCEPT → CHECKOUT
 *   UPSELL       + UPSELL_DECLINE → CHECKOUT
 *   UPSELL       + COMMIT_PICK   → CHECKOUT
 *   OBJECTION    + COMMIT_PICK   → CHECKOUT
 *   DISCOVERY    + NAME_ITEM     → DISCOVERY (handler itself decides)
 *
 * All other pairs: return currentStage unchanged.
 *
 * Note: STOP_HELP_START and OPT_OUT-shaped intents are NOT pre-transitioned
 * here. The Twilio webhook catches the carrier-required STOP/HELP/START
 * keywords upstream of stage dispatch and routes them through v1's
 * processSmsMessage, which is the carrier-required compliance path. We
 * deliberately leave that on v1 — it's well-tested and shouldn't drift.
 */
export function pickEffectiveStage(currentStage: Stage, intent: IntentResult): Stage {
  const i = intent.intent

  switch (currentStage) {
    case 'GREETING':
      // AGE_CONFIRM means the customer just texted YES (or equivalent) to the
      // age gate. Route to CONSENT_GATE so the consent insert + welcome fire
      // on this turn instead of waiting for the next inbound.
      if (i === 'AGE_CONFIRM') return 'CONSENT_GATE'
      break

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
  // V1 retirement — GREETING / CONSENT_GATE / POST_CHECKOUT now route to v2
  // handlers instead of falling through to v1's processSmsMessage. v1 is
  // reserved for the SMS_PIPELINE_VERSION='v1' kill-switch and the
  // STOP/HELP/START compliance keywords (handled upstream of dispatch).
  GREETING:      executeGreetingStage,
  CONSENT_GATE:  executeConsentGateStage,
  POST_CHECKOUT: executePostCheckoutStage,
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
 * Strip Markdown formatting from prose so it renders cleanly in SMS clients
 * (which don't parse Markdown — customers see literal asterisks otherwise).
 *
 * Specifically:
 *   - **bold** / __bold__ → bold (drop the marker pair)
 *   - *italic* / _italic_ → italic (drop the marker pair, only when wrapping word chars)
 *   - [text](url) → url (preserve the link, drop the link-text since it's
 *     usually redundant or truncated on SMS — the URL is what matters)
 *   - `inline code` → inline code (drop backticks)
 *   - ```code blocks``` → contents (drop the fences)
 *   - Heading prefixes (#, ##, etc.) → strip (rare in our output but cheap to handle)
 *   - Collapses 3+ consecutive blank lines to 2
 *
 * Pure text in / pure text out. Idempotent.
 */
function stripMarkdownForSms(prose: string): string {
  let out = prose

  // Code fences first (so we don't process their contents as bold/italic).
  out = out.replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1')
  // Inline code.
  out = out.replace(/`([^`]+)`/g, '$1')

  // Markdown links: [text](url) → url (the URL is the value on SMS).
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2')

  // Bold (** or __) — drop the wrapper pair.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')

  // Italic (single * or _) when it wraps word chars. Conservative: require
  // at least one non-whitespace, non-marker char inside.
  out = out.replace(/(^|[\s(])\*([^\s*][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1$2')
  out = out.replace(/(^|[\s(])_([^\s_][^_]*?)_(?=[\s).,!?:;]|$)/g, '$1$2')

  // Heading prefixes at the start of a line.
  out = out.replace(/^#{1,6}\s+/gm, '')

  // Collapse triple+ blank lines to double.
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}

/**
 * Convert a StageResponse to the ProcessSmsResult shape expected by the
 * webhook route and turn-logger.
 *
 * - replies: each StageResponse segment becomes one or more SmsSegments.
 *   body = segment.prose, with two transformations:
 *     1. Markdown stripped (SMS doesn't render it).
 *     2. Any PDP URL on its own line is pulled into its OWN SmsSegment so
 *        iMessage's auto-preview heuristic actually fires — a URL alone in
 *        a bubble previews reliably; mixed in with prose it usually doesn't.
 *
 *   mediaUrl is intentionally NOT set. iMessage's URL preview replaces the
 *   MMS image we used to send; Twilio MMS costs ~2-3× SMS per segment
 *   (~$0.029 vs ~$0.013 in 2026 pricing) and the visual outcome on iMessage
 *   is now better (rich product card via OG preview). Plain-SMS clients see
 *   two short messages: prose + a tappable link. Acceptable.
 *
 *   To re-enable MMS attachments on a per-channel basis later (e.g., for
 *   web chat or non-iMessage carriers we measure as cost-effective),
 *   reintroduce the mediaUrl spread here behind a feature flag.
 *
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
    .flatMap((s): SmsSegment[] => {
      // Strip Markdown — Twilio SMS doesn't render it and customers see
      // literal asterisks, double-underscores, [text](url) etc. as garbage
      // characters. Web chat keeps Markdown via its own adapter.
      const stripped = stripMarkdownForSms(s.prose)
      // Pull any PDP URL onto its own bubble so iMessage renders the OG
      // preview card reliably. The closing CTA stays with the prose so the
      // ask is still above the preview. See sms-reply-segments.server.ts
      // for the full splitter rationale.
      return splitProseAtUrl(stripped).map((part) => ({ body: part }))
      // Intentionally NO mediaUrl — iMessage's URL preview replaces the
      // MMS image we used to send (commit 3209c0b), at a fraction of the
      // cost.
    })

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
