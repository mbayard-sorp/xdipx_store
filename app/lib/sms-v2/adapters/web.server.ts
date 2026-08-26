/**
 * app/lib/sms-v2/adapters/web.server.ts
 *
 * Web chat adapter for the v2 Emma engine.
 *
 * Provides processWebMessageV2(input) → Promise<ChatReply>:
 *   1. getOrCreateWebConversation() — rotation logic, stage TTL.
 *   2. classifyIntent() — reused from SMS (channel-agnostic).
 *   3. buildWebEmmaContext() — base context + pageContext + cart overlay.
 *   4. pickEffectiveStage() → dispatchStage() — same stage handlers as SMS.
 *   5. applyWebStateWrites() — persist state after handler.
 *   6. logWebStageResponse() — turn logging (channel='web').
 *   7. StageResponse → ChatReply adapter.
 *
 * The existing v1 web path (generateChatReply in chat.server.ts) is unchanged.
 * api.ask-emma.tsx calls processWebMessageV2 only when pickWebPipelineVersion
 * returns 'v2'.
 *
 * NOTE: Keep this file in sms-v2/adapters/ for now. A future consolidation
 * phase can rename the directory to emma-engine/ without touching locked files.
 */
import { getOrCreateWebConversation, applyWebStateWrites } from '../web-conversation.server'
import { classifyIntent } from '../intent-classifier.server'
import { buildWebEmmaContext } from '../web-context-builder.server'
import { findRecentCrossChannelActivity } from '../cross-channel.server'
import { pickEffectiveStage, dispatchStage, guardStagePreconditions } from '../stage-dispatch.server'
import { logWebStageResponse } from '../web-turn-logger.server'
import { loadConversationHistory } from '../conversation-history.server'
import { generateConversationSummary } from '../summary.server'
import type { ChatReply, ChatProductCard } from '~/lib/ai-agent/chat-types'
import type { StageResponse, ProductRef, ProductContext } from '../types.server'
import type { BudgetReservation } from '~/lib/emma-budget.server'
import { getPreviewImagesByHandles } from '~/lib/sanity.server'

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface ProcessWebInput {
  /** Emma session id — persists per-customer-cookie. */
  sessionId: string
  /** Shopify customer GID when known via Shopify customer auth. */
  customerGid?: string
  /** The customer's message text. */
  customerText: string
  /** Page context from the current browser URL. */
  pageContext?: { handle?: string; collection?: string; route?: string }
  /** Current cart cookie. */
  cartId?: string
  /** Existing emma-budget reservation (already checked by the route). */
  budgetReservation?: BudgetReservation
}

// ---------------------------------------------------------------------------
// StageResponse → ChatReply adapter
// ---------------------------------------------------------------------------

/**
 * Map a sms-v2 ProductRef (or ProductContext which extends it) to the web
 * ChatProductCard shape. We populate the fields we have; richer fields
 * (variants, pctOff, etc.) require a full Shopify fetch.
 */
/**
 * v2 stages emit absolute https://xdipx.com/products/{handle} URLs because SMS
 * (iMessage link previews) needs them. Web chat needs relative paths so the
 * link stays on the current origin — preview, localhost, or prod — and the
 * _layout-mounted Emma widget keeps its state across navigation. Strip the
 * canonical host (and any www/preview variant) down to the pathname.
 */
const ABSOLUTE_XDIPX_URL_RE = /https?:\/\/(?:www\.)?(?:xdipx\.com|[a-z0-9-]+\.vercel\.app)(\/[^\s)\]]*)/gi
function relativizeXdipxLinks(text: string): string {
  return text.replace(ABSOLUTE_XDIPX_URL_RE, '$1')
}
function relativizePdpUrl(url: string): string {
  if (!url) return url
  if (url.startsWith('/')) return url
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host === 'xdipx.com' || host === 'www.xdipx.com' || host.endsWith('.vercel.app')) {
      return u.pathname + u.search + u.hash
    }
  } catch { /* fall through */ }
  return url
}

// Exported for unit tests (ticket #3542): the web path must present a product as
// in-stock only when the ProductRef genuinely is.
export function productRefToCard(ref: ProductRef | ProductContext): ChatProductCard {
  // Parse price string like "$49.99" → number of dollars.
  // ChatProductCard.price is dollars (matches v1 productToCard, which uses
  // Number(variant.price)); AskEmmaProductCard's formatPrice does
  // `$${n.toFixed(2)}` with no division, so passing cents would render as
  // "$4999.00".
  let price = 0
  if (ref.price) {
    const cleaned = ref.price.replace(/[^0-9.]/g, '')
    const parsed = parseFloat(cleaned)
    if (!isNaN(parsed)) price = parsed
  }

  // description lives on ProductContext (superset of ProductRef)
  const tagline = ('description' in ref && typeof ref.description === 'string')
    ? ref.description
    : ''

  const card: ChatProductCard = {
    handle: ref.handle,
    title: ref.title,
    tagline,
    category: '',          // Stage handler doesn't return category in ProductRef
    price,
    pctOff: 0,
    phrasing: 'msrp_only',
    inStock: ref.inStock,  // Real availability threaded on ProductRef (#3542)
    variantId: '',         // Stage handler doesn't carry variantId in ProductRef
    url: relativizePdpUrl(ref.pdpUrl),
  }
  if (ref.imageUrl !== undefined) card.imageUrl = ref.imageUrl
  return card
}

/**
 * Convert a StageResponse to the ChatReply shape expected by the web front-end.
 *
 * Mapping rules:
 *   - segments[].prose → joined into reply string (separated by "\n\n")
 *   - segments[].productCard → ChatProductCard[]
 *   - segments[].pillOptions → quickReply.options (first segment with pills wins)
 *   - stateWrites.lastQuoteUrl being set → cartUpdated: true (checkout was created)
 *   - segments[].cta.kind === 'checkout' → cartUpdated: true
 */
async function stageResponseToChatReply(
  resp: StageResponse,
  existingHistory: Array<{ role: 'user' | 'assistant'; text: string }>,
  userText: string,
): Promise<ChatReply> {
  const replyParts: string[] = []
  const products: ChatProductCard[] = []
  let pillOptions: string[] | undefined

  for (const segment of resp.segments) {
    if (segment.prose.trim()) {
      replyParts.push(segment.prose.trim())
    }

    if (segment.productCard) {
      products.push(productRefToCard(segment.productCard))
    }

    // First segment with pill options wins.
    if (segment.pillOptions && segment.pillOptions.length > 0 && !pillOptions) {
      pillOptions = segment.pillOptions
    }
  }

  const reply = relativizeXdipxLinks(
    replyParts.join('\n\n') || "I'm here — what can I help with?",
  )

  // Fall back to Sanity productPage.previewImageUrl for any card that didn't
  // get a Shopify image — common for newly bulk-imported products that have
  // no featured image attached yet. Single GROQ batch lookup.
  const missing = products.filter((p) => !p.imageUrl).map((p) => p.handle)
  if (missing.length > 0) {
    const sanityPreviews = await getPreviewImagesByHandles(missing)
    if (sanityPreviews.size > 0) {
      for (const card of products) {
        if (card.imageUrl) continue
        const url = sanityPreviews.get(card.handle)
        if (url) card.imageUrl = url
      }
    }
  }

  // Determine if a cart/checkout was created this turn.
  const cartCreated =
    !!resp.stateWrites.lastQuoteUrl ||
    resp.segments.some((s) => s.cta?.kind === 'checkout')

  const newHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [
    ...existingHistory,
    { role: 'user', text: userText },
    { role: 'assistant', text: reply },
  ]

  const chatReply: ChatReply = {
    reply,
    products,
    history: newHistory,
  }

  if (pillOptions && pillOptions.length > 0) {
    chatReply.quickReply = {
      question: reply,
      options: pillOptions,
      mode: 'single',
    }
  }

  if (resp.createdCartId) {
    chatReply.newCartId = resp.createdCartId
  }

  if (cartCreated) {
    chatReply.cartUpdated = true
  }

  return chatReply
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Process a web chat message through the v2 Emma engine.
 * Returns a ChatReply that is identical in shape to what generateChatReply()
 * returns — the route can return either without changing the client contract.
 */
export async function processWebMessageV2(
  input: ProcessWebInput,
  existingHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [],
): Promise<ChatReply> {
  const { sessionId, customerGid, customerText, pageContext, cartId } = input
  const startedAt = Date.now()

  // --- Step 1: Get or create web conversation (with rotation logic) ---
  let conversation: Awaited<ReturnType<typeof getOrCreateWebConversation>>
  try {
    conversation = await getOrCreateWebConversation(sessionId, customerGid)
  } catch (err) {
    console.error('[web-adapter] getOrCreateWebConversation failed', err)
    throw err
  }

  // --- Step 1b: Web has no consent gate — opening the chat widget IS consent.
  // GREETING has no v2 handler, so a stuck-in-GREETING conversation falls
  // through to the holding reply ("Hey! What can I help you find today?")
  // forever. Bump to DISCOVERY immediately so the first message gets a real
  // discovery response. RECONNECT (set by 24h rotation) is preserved.
  if (conversation.stage === 'GREETING') {
    try {
      await applyWebStateWrites(sessionId, { stage: 'DISCOVERY' })
      conversation = { ...conversation, stage: 'DISCOVERY' }
    } catch (err) {
      console.warn('[web-adapter] pre-dispatch GREETING→DISCOVERY bump failed (non-fatal)', err)
    }
  }

  // --- Step 2: Classify intent ---
  let intentResult: Awaited<ReturnType<typeof classifyIntent>>
  try {
    intentResult = await classifyIntent(
      { stage: conversation.stage },
      customerText,
    )
  } catch (err) {
    console.error('[web-adapter] classifyIntent failed — using OFF_TOPIC fallback', err)
    intentResult = { intent: 'OFF_TOPIC', confidence: 0.0, source: 'fallback' }
  }

  // Re-run with intent to apply 6h stage TTL if needed.
  try {
    conversation = await getOrCreateWebConversation(sessionId, customerGid, intentResult.intent)
  } catch {
    // Non-fatal — we already have a conversation from the first call.
  }

  // If page context provides a product handle and conversation has no pitch yet,
  // seed currentPitchHandle from pageContext so stage handlers can use it.
  if (
    pageContext?.handle &&
    !conversation.currentPitchHandle &&
    intentResult.intent === 'RESEARCH'
  ) {
    try {
      await applyWebStateWrites(sessionId, {
        currentPitchHandle: pageContext.handle,
        pageHandle: pageContext.handle,
        pageRoute: pageContext.route ?? null,
      })
      conversation = { ...conversation, currentPitchHandle: pageContext.handle }
    } catch (err) {
      console.warn('[web-adapter] could not seed pitch handle from page context', err)
    }
  }

  // --- Step 3: Build Emma context with web-specific overlays ---
  let ctx: Awaited<ReturnType<typeof buildWebEmmaContext>>
  try {
    const extras: import('../web-context-builder.server').WebContextExtras = {}
    if (pageContext !== undefined) extras.pageContext = pageContext
    if (cartId !== undefined) extras.cartId = cartId
    ctx = await buildWebEmmaContext(conversation, extras)
    // Phase 10: attach cross-channel hint (SMS/voice → web direction).
    const hint = await findRecentCrossChannelActivity(conversation.customerGid, 'web')
    if (hint) (ctx as typeof ctx & { crossChannelHint?: typeof hint }).crossChannelHint = hint
  } catch (err) {
    console.error('[web-adapter] buildWebEmmaContext failed', err)
    throw err
  }

  // --- Step 3b: Load history BEFORE dispatch (ADR-003 Sub-decision B) ---
  // The summarizer needs history to generate a meaningful summary. Loading here
  // (not inside executeConversationAgent) ensures the history is available for
  // the fire-and-forget summarizer call regardless of which stage handler ran.
  // The conversation agent also loads history internally for its own Sonnet call;
  // this second load is a read-only DB query and is acceptable at current volume.
  let historyForSummarizer: import('../conversation-history.server').HistoryTurn[] = []
  try {
    historyForSummarizer = await loadConversationHistory(conversation.conversationId, 12)
  } catch (err) {
    console.warn('[web-adapter] failed to load history for summarizer (non-fatal)', err)
  }

  // --- Step 4: Stage dispatch ---
  // Resolve the intent-driven stage, then enforce the precondition guards
  // (#5656): UPSELL requires a product selected this session, POST_CHECKOUT
  // requires a completed checkout this session. Either failing drops to
  // DISCOVERY so a stale handle or misclassified message can never fire an
  // upsell or a post-checkout script off state that isn't there.
  const effectiveStage = guardStagePreconditions(
    pickEffectiveStage(conversation.stage, intentResult, conversation.currentPitchHandle),
    conversation,
    conversation.stage,
  )
  const stageRespPromise = dispatchStage(effectiveStage, ctx, intentResult, customerText)

  let stageResp: StageResponse
  if (stageRespPromise !== null) {
    stageResp = await stageRespPromise
  } else {
    // No v2 handler registered for this stage (e.g. GREETING, CONSENT_GATE).
    // Return a minimal holding reply — the route only calls v2 when version='v2',
    // so this is only a safety fallback.
    console.warn(`[web-adapter] no v2 handler for stage=${effectiveStage} — returning holding reply`)
    stageResp = {
      stageOut: conversation.stage,
      goalAchieved: false,
      segments: [{ prose: "Hey! What can I help you find today?" }],
      stateWrites: {},
      telemetry: {
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
      },
    }
  }

  // --- Step 5: Persist state writes ---
  try {
    const writes = stageResp.stateWrites
    const stateUpdate: Parameters<typeof applyWebStateWrites>[1] = {
      stage: writes.stage ?? stageResp.stageOut,
    }
    if (writes.currentPitchHandle  !== undefined) stateUpdate.currentPitchHandle  = writes.currentPitchHandle
    if (writes.currentUpsellHandle !== undefined) stateUpdate.currentUpsellHandle = writes.currentUpsellHandle
    if (writes.lastQuoteUrl        !== undefined) stateUpdate.lastQuoteUrl        = writes.lastQuoteUrl
    if (writes.lastQuoteItems      !== undefined) stateUpdate.lastQuoteItems      = writes.lastQuoteItems
    if (writes.lastQuoteCreatedAt  !== undefined) stateUpdate.lastQuoteCreatedAt  = writes.lastQuoteCreatedAt
    if (writes.customerGid         !== undefined) stateUpdate.customerGid         = writes.customerGid
    // Discovery gate persistence — without these, the gate machine resets
    // every turn (caught during voice Stage D testing; same omission here).
    if (writes.discoveryState      !== undefined) stateUpdate.discoveryState      = writes.discoveryState
    if (writes.discoveredSlots     !== undefined) stateUpdate.discoveredSlots     = writes.discoveredSlots
    if (pageContext?.handle        !== undefined) stateUpdate.pageHandle          = pageContext.handle
    if (pageContext?.route         !== undefined) stateUpdate.pageRoute           = pageContext.route
    await applyWebStateWrites(sessionId, stateUpdate)
  } catch (err) {
    console.error('[web-adapter] applyWebStateWrites failed (non-fatal)', err)
  }

  // --- Step 5b: Memory primitives — summarizer + pitched-handles log (ADR-003 Sub-decision B) ---
  // Fires AFTER applyWebStateWrites returns. NEVER before — per architect condition #3.
  // The executeConversationAgent path also fires the summarizer internally for SMS; for web
  // the gate-machine path (runSearchBranch, executeDiscoveryGate) bypassed it entirely.
  // Moving it here ensures EVERY stage handler triggers the summary update, regardless
  // of dispatch path. OQ2 resolution: processWebMessageV2 is a separate function from
  // processSmsMessageV2 — both need this wiring.
  //
  // Non-blocking: do not await before returning reply to caller. Phase 0 condition #1.
  void (async () => {
    try {
      // Append new pitch handle to the log when the handler pitched something.
      // Guard: skip if the conversation-agent path already wrote the log via
      // stateWrites — same pattern as processor.server.ts:146 to avoid double-append.
      const newPitchHandle = stageResp.stateWrites.currentPitchHandle
      if (newPitchHandle && stageResp.stateWrites.pitchedHandlesLog === undefined) {
        const prior = conversation.pitchedHandlesLog ?? []
        // Append new handle (most-recent last), cap at 10.
        const updated = [...prior, newPitchHandle].slice(-10)
        await applyWebStateWrites(sessionId, { pitchedHandlesLog: updated }).catch((err) =>
          console.warn('[web-adapter] pitchedHandlesLog update failed (non-fatal)', err)
        )
      }

      // Run the Haiku summarizer with the history loaded before dispatch.
      const summary = await generateConversationSummary(
        historyForSummarizer,
        conversation.conversationSummary ?? null,
      )
      if (summary) {
        await applyWebStateWrites(sessionId, { conversationSummary: summary }).catch((err) =>
          console.warn('[web-adapter] conversationSummary update failed (non-fatal)', err)
        )
      }
    } catch (err) {
      console.warn('[web-adapter] memory primitive update failed (non-fatal)', err)
    }
  })()

  // --- Step 6: Turn logging (fire-and-forget, non-fatal) ---
  void logWebStageResponse(sessionId, customerText, stageResp, {
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    stageIn: effectiveStage,
    stageOut: stageResp.stageOut,
    inputTokens: stageResp.telemetry.inputTokens,
    outputTokens: stageResp.telemetry.outputTokens,
    toolCalls: stageResp.telemetry.toolCalls,
    fabricationCaught: stageResp.telemetry.fabricationCaught,
  }, startedAt).catch((err) => {
    console.error('[web-adapter] logWebStageResponse failed (non-fatal)', err)
  })

  // --- Step 7: Convert StageResponse → ChatReply ---
  return stageResponseToChatReply(stageResp, existingHistory, customerText)
}
