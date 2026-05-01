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
import { pickEffectiveStage, dispatchStage } from '../stage-dispatch.server'
import { logWebStageResponse } from '../web-turn-logger.server'
import type { ChatReply, ChatProductCard } from '~/lib/ai-agent/chat-types'
import type { StageResponse, ProductRef, ProductContext } from '../types.server'
import type { BudgetReservation } from '~/lib/emma-budget.server'

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
function productRefToCard(ref: ProductRef | ProductContext): ChatProductCard {
  // Parse price string like "$49.99" → number of cents
  let price = 0
  if (ref.price) {
    const cleaned = ref.price.replace(/[^0-9.]/g, '')
    const parsed = parseFloat(cleaned)
    if (!isNaN(parsed)) price = Math.round(parsed * 100)
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
    inStock: true,         // Assume in-stock; stage handler validated this
    variantId: '',         // Stage handler doesn't carry variantId in ProductRef
    url: ref.pdpUrl,
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
function stageResponseToChatReply(
  resp: StageResponse,
  existingHistory: Array<{ role: 'user' | 'assistant'; text: string }>,
  userText: string,
): ChatReply {
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

  const reply = replyParts.join('\n\n') || "I'm here — what can I help with?"

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

  // --- Step 4: Stage dispatch ---
  const effectiveStage = pickEffectiveStage(conversation.stage, intentResult)
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
    if (pageContext?.handle        !== undefined) stateUpdate.pageHandle          = pageContext.handle
    if (pageContext?.route         !== undefined) stateUpdate.pageRoute           = pageContext.route
    await applyWebStateWrites(sessionId, stateUpdate)
  } catch (err) {
    console.error('[web-adapter] applyWebStateWrites failed (non-fatal)', err)
  }

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
