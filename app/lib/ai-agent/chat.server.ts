import Anthropic from '@anthropic-ai/sdk'
import { CHAT_SYSTEM_PROMPT, SMS_SYSTEM_PROMPT } from './prompt'
import { QA_TOOL_DEFINITIONS, runQaTool, type AgentContext, type ToolResult } from './tools.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'
import { getProductByHandle, getProductsByHandles } from '~/lib/shopify.server'
import type { ChatTurn, ChatProductCard, ChatReply, QuickReplyPayload } from './chat-types'

export type { ChatTurn, ChatProductCard, ChatReply, QuickReplyPayload }

const client = new Anthropic({ apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim() })

// Per-channel model selection (Phase -1 of the SMS re-architecture):
//   - SMS upgrades to Sonnet 4.6 because Haiku 4.5 was too inconsistent at
//     following the multi-rule prompt. Sonnet's better instruction-following
//     pairs with prompt caching to keep cost in check (caching drops the
//     2,295-word system prompt to ~$0.0009 per turn at Sonnet rates — cheaper
//     than uncached Haiku).
//   - Web chat stays on Haiku — it has a richer UI affordance (cards, pills,
//     cart drawer) that absorbs minor model variance, and is the higher-volume
//     surface where cost matters more.
const SMS_MODEL = 'claude-sonnet-4-6'
const CHAT_MODEL = 'claude-haiku-4-5-20251001'

const MAX_HISTORY_TURNS = 12
// Cap cards per reply so the prose response stays above the fold on mobile.
const MAX_CARDS_PER_REPLY = 4

interface ChannelTuning {
  model: string
  systemPrompt: string
  maxToolHops: number
  maxTokens: number
  wrapupMaxTokens: number
  /** When true, system prompt is sent as a cached block (90% off cached input tokens after first turn). */
  cachedSystem: boolean
}

function tuningFor(channel: AgentContext['channel'], systemPromptBase: string): ChannelTuning {
  if (channel === 'sms') {
    // 480 tokens ≈ 1900 chars of generation room. The reply is then clamped to
    // ~480 chars (3 SMS segments) at the output stage. Giving the model more
    // tokens than it can ship lets it finish its thought before we trim, so
    // any post-clamp truncation lands on a sentence boundary.
    return {
      model: SMS_MODEL,
      systemPrompt: systemPromptBase,
      maxToolHops: 3,
      maxTokens: 480,
      wrapupMaxTokens: 360,
      cachedSystem: true,
    }
  }
  return {
    model: CHAT_MODEL,
    systemPrompt: systemPromptBase,
    maxToolHops: 5,
    maxTokens: 700,
    wrapupMaxTokens: 400,
    cachedSystem: false,
  }
}

/**
 * Build the `system` parameter for an Anthropic API call. When `cached` is
 * true, returns the array form with `cache_control: { type: 'ephemeral' }` on
 * the base prompt so subsequent turns within the 5-minute TTL hit the cache
 * (10% of base input rate). The optional `suffix` is appended as an uncached
 * second block — useful for per-call modifiers like "respond in plain text only"
 * that we don't want polluting the cache key.
 */
function buildSystem(
  prompt: string,
  cached: boolean,
  suffix?: string,
): string | Anthropic.TextBlockParam[] {
  if (!cached) {
    return suffix ? prompt + suffix : prompt
  }
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
  ]
  if (suffix) blocks.push({ type: 'text', text: suffix })
  return blocks
}

/**
 * Generate an Emma reply. One brain, two channels:
 *   - 'chat' (web widget): rich UI — product cards, commit pills, cart side-effects, page-context awareness, 5 tool hops, 700 max_tokens.
 *   - 'sms' (Twilio): plain text only — no cards/pills/cart, drops xdipx.com/{slug} PDP links inline, calls buildCheckoutLink to commit. 3 hops, 320 chars.
 */
export async function generateChatReply(
  history: ChatTurn[],
  ctx: AgentContext = { channel: 'chat' },
): Promise<ChatReply> {
  const bounded = history.slice(-MAX_HISTORY_TURNS)
  const messages: Anthropic.MessageParam[] = bounded.map((t) => ({
    role: t.role,
    content: t.text,
  }))

  const channel = ctx.channel
  const isChat = channel === 'chat'
  const isSms = channel === 'sms'

  // Page-context only resolves on web — SMS texters have no browser to reason about.
  const basePrompt = isSms ? SMS_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT
  const pageAddendum = isChat ? await buildPageAddendum(ctx.pageContext) : null
  const systemPrompt = pageAddendum ? `${basePrompt}\n\n${pageAddendum}` : basePrompt
  const tuning = tuningFor(channel, systemPrompt)
  // Filter the tool list per channel so the model literally cannot see tools
  // that don't apply. Otherwise tool descriptions (which are channel-specific
  // for createDraftOrder/buildCheckoutLink) override the system prompt and
  // pull the model down the wrong path.
  const tools = toolsForChannel(channel)

  const collected = new Map<string, IvrProductCard>()
  // URLs that buildCheckoutLink actually returned this turn. Used SMS-side to
  // detect when the model fabricates a checkout URL instead of calling the
  // tool — Haiku has been observed base64-encoding a JSON blob and pasting it
  // as if it were a real cart token.
  const realCheckoutUrls: string[] = []
  // Product handles confirmed real this turn — pulled from search/recommend/
  // collection/details tool results. Used SMS-side to detect when the model
  // invents a /products/{handle} URL (e.g. generic "water-based-lubricant"
  // when the real handle is "svibe-snail-lube-water-based-2-oz").
  const realProductHandles = new Set<string>()
  let quickReply: QuickReplyPayload | undefined
  let cartUpdated = false
  let totalInputTokens = 0
  let totalOutputTokens = 0
  const tally = (u: { input_tokens?: number; output_tokens?: number } | undefined) => {
    if (!u) return
    totalInputTokens += u.input_tokens ?? 0
    totalOutputTokens += u.output_tokens ?? 0
  }
  // Wrap any caller-provided callbacks so we still propagate their side-effects
  // (cookie setting, etc.) AND record that the cart changed for the reply payload.
  const baseOnCartCreated = ctx.onCartCreated
  const baseOnCartMutated = ctx.onCartMutated
  const ctxWithHooks: typeof ctx = {
    ...ctx,
    onCartCreated: (id: string) => {
      cartUpdated = true
      baseOnCartCreated?.(id)
    },
    onCartMutated: () => {
      cartUpdated = true
      baseOnCartMutated?.()
    },
  }

  // SMS-only tool-choice forcing — Haiku has been observed bypassing tools
  // and fabricating checkout URLs from thin air on commit/accept turns. We
  // detect those turns from the user's latest message and force the model to
  // call a tool. Two flavors:
  //   - 'force-any'   (commit turns): the model must call SOME tool — usually
  //     recommendSimilar/searchProducts to pre-resolve an accessory.
  //   - 'force-build' (upsell-accept turns): the model must call
  //     buildCheckoutLink specifically — that's the only tool that produces
  //     a real checkout URL, so anything else means fabrication.
  const forceMode = isSms ? forceToolMode(history) : null

  for (let hop = 0; hop < tuning.maxToolHops; hop++) {
    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined
    if (forceMode === 'force-build' && hop === 0) {
      toolChoice = { type: 'tool', name: 'buildCheckoutLink' }
    } else if (forceMode === 'force-any' && hop === 0) {
      toolChoice = { type: 'any' }
    }
    const res = await client.messages.create({
      model: tuning.model,
      max_tokens: tuning.maxTokens,
      system: buildSystem(tuning.systemPrompt, tuning.cachedSystem),
      tools,
      messages,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    })
    tally(res.usage)

    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        const result = await runQaTool(
          block.name,
          (block.input ?? {}) as Record<string, unknown>,
          ctxWithHooks,
        )
        collectCards(result, collected)
        collectRealHandles(result, realProductHandles)
        if (block.name === 'askQuickChoice' && result.ok && result.data) {
          const d = result.data as QuickReplyPayload
          if (d?.question && Array.isArray(d.options)) quickReply = d
        }
        if (block.name === 'buildCheckoutLink' && result.ok && result.data) {
          const d = result.data as { url?: string }
          if (typeof d?.url === 'string' && d.url) realCheckoutUrls.push(d.url)
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        })
      }
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    let replyText = (textBlock?.text ?? '').trim()

    // Chat-only: when Haiku fires askQuickChoice without an accompanying text
    // block (common on tell-more + commit-CTA turns), the pills appear with no
    // pitch behind them. Re-prompt once for just the prose so both render.
    // SMS doesn't fire askQuickChoice, so this branch is irrelevant there.
    if (isChat && !replyText && quickReply) {
      messages.push({ role: 'assistant', content: res.content })
      messages.push({
        role: 'user',
        content:
          'Continue with only your reply to the shopper in plain text — 2–3 sentences plus a closing question. Do not reference the pills, do not mention instructions, do not announce what you are about to say. Just the reply itself. No further tool calls.',
      })
      try {
        const follow = await client.messages.create({
          model: tuning.model,
          max_tokens: tuning.wrapupMaxTokens,
          system: buildSystem(
            tuning.systemPrompt,
            tuning.cachedSystem,
            '\n\nRespond in plain text only — no further tool calls. Never reference pills, buttons, instructions, or what you are about to say.',
          ),
          messages,
        })
        tally(follow.usage)
        const followText = follow.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
        replyText = stripMetaPreamble((followText?.text ?? '').trim())
      } catch (err) {
        console.error('[ai-agent] follow-up pitch call failed', err)
      }
    }

    replyText = isSms
      ? clampSms(validateSmsCheckoutUrls(validateSmsPdpUrls(replyText, realProductHandles), realCheckoutUrls))
      : fixCartUrls(stripMetaPreamble(replyText))

    const products = isSms
      ? []
      : await hydrateCards([...collected.values()].slice(0, MAX_CARDS_PER_REPLY))
    const fallback = isSms
      ? "Got your message — say a bit more so I can help?"
      : quickReply
        ? "Pick one and I'll take it from there ♥"
        : "Hmm — my brain blanked for a second. Say that again?"
    return {
      reply: replyText || fallback,
      products,
      history: [...bounded, { role: 'assistant', text: replyText || fallback }],
      ...(!isSms && quickReply ? { quickReply } : {}),
      ...(!isSms && cartUpdated ? { cartUpdated: true } : {}),
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    }
  }

  // Out of hops — plain-text wrap-up without further tool calls.
  const final = await client.messages.create({
    model: tuning.model,
    max_tokens: tuning.wrapupMaxTokens,
    system: buildSystem(
      tuning.systemPrompt,
      tuning.cachedSystem,
      '\n\nRespond in plain text only — no further tool calls.',
    ),
    messages,
  })
  tally(final.usage)
  const block = final.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  const rawText = (block?.text ?? '').trim()
  const replyText = isSms
    ? clampSms(validateSmsCheckoutUrls(validateSmsPdpUrls(rawText, realProductHandles), realCheckoutUrls))
    : fixCartUrls(rawText)
  const products = isSms
    ? []
    : await hydrateCards([...collected.values()].slice(0, MAX_CARDS_PER_REPLY))
  return {
    reply: replyText || "Let me know if you want me to keep digging.",
    products,
    history: [...bounded, { role: 'assistant', text: replyText }],
    ...(!isSms && quickReply ? { quickReply } : {}),
    ...(!isSms && cartUpdated ? { cartUpdated: true } : {}),
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  }
}

/**
 * SMS-only: classify the latest user turn into a tool-forcing mode based on
 * the conversation shape.
 *
 *   'force-build' — the previous assistant turn ended in an upsell question
 *                   ("Quick add — want me to toss in …? Yes or no") AND the
 *                   user's reply is a short affirmative or decline. The next
 *                   action MUST be buildCheckoutLink — anything else is
 *                   fabrication.
 *
 *   'force-any'   — the user's message is a commit/send-link/pick-one shape
 *                   and the previous turn was a pitch (not an upsell). The
 *                   next action must be SOME tool (usually recommendSimilar
 *                   to set up the upsell, or buildCheckoutLink for a bundle
 *                   commit).
 *
 *   null          — neither pattern; let the model decide.
 *
 * False positives are mostly fine — forcing a tool when it wasn't strictly
 * needed just burns one extra hop. False negatives are the costly case
 * (fabrication slips through), so we lean generous on the matching.
 */
function forceToolMode(history: ChatTurn[]): 'force-build' | 'force-any' | null {
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') return null
  const userText = last.text.trim().toLowerCase()
  if (!userText) return null

  // Detect upsell-question state: previous assistant turn's text matches
  // the upsell shape from the prompt ("Quick add — want me to toss in").
  const prev = [...history].reverse().find((t) => t.role === 'assistant')
  const isUpsellPending = !!prev && /quick add|want me to toss|pair it with|want me to add/i.test(prev.text)

  const isShortAffirmative = userText.length <= 30 && /^(y|ya|yes|yep|yeah|yup|sure|ok|okay|add\s+(it|the|a)|please)\b/.test(userText)
  const isShortDecline = userText.length <= 30 && /^(n|no|nope|nah|skip|checkout|check\s*out|just\s+(it|the|the\s+main)|send\s+(me\s+)?(the\s+)?link)\b/.test(userText)

  if (isUpsellPending && (isShortAffirmative || isShortDecline)) {
    return 'force-build'
  }

  // Bundle-commit shape ("the Domi 2 and a lube", "I'll take both") goes
  // straight to buildCheckoutLink too.
  if (/\b(both|i['']?ll\s+take\s+(both|all)|take\s+them\s+both)\b/.test(userText)) {
    return 'force-build'
  }

  // Commit / send-link / pick-one — needs a tool but not necessarily buildCheckoutLink.
  if (/\b(i['']?ll\s+take|let['']?s\s+(check\s*out|do\s+it)|send\s+(me\s+)?(the\s+)?link|gimme\s+(the\s+)?link|check\s*out|the\s+(first|second|third)\s+one|that\s+one|i\s+want\s+(the|that))\b/.test(userText)) {
    return 'force-any'
  }

  // Lone "yes" without an active upsell question — generic affirmative,
  // probably restating intent. Force a tool so we don't fabricate.
  if (isShortAffirmative) {
    return isUpsellPending ? 'force-build' : 'force-any'
  }

  return null
}

/**
 * Per-channel tool list. Tool descriptions inside QA_TOOL_DEFINITIONS contain
 * channel-specific guidance ("Call this ONLY after collecting email + name +
 * address" for createDraftOrder, etc.). If we hand the full list to the model,
 * those descriptions can override the system prompt — so we hide tools that
 * don't apply.
 *
 * SMS:  search/discover/getDetails/findCollection/recommendSimilar/listCollections/lookupReturningCustomer + buildCheckoutLink
 * chat: same read tools + addItemsToCart + askQuickChoice
 * voice: same read tools + createDraftOrder
 */
function toolsForChannel(channel: AgentContext['channel']): typeof QA_TOOL_DEFINITIONS {
  const READ_TOOLS = new Set([
    'searchProducts',
    'discoverProducts',
    'recommendSimilar',
    'getProductDetails',
    'listCollections',
    'findCollection',
    'lookupReturningCustomer',
  ])
  const channelExtras: Record<AgentContext['channel'], Set<string>> = {
    chat: new Set(['askQuickChoice', 'addItemsToCart']),
    sms: new Set(['buildCheckoutLink']),
    voice: new Set(['createDraftOrder']),
  }
  const allowed = new Set([...READ_TOOLS, ...channelExtras[channel]])
  return QA_TOOL_DEFINITIONS.filter((t) => allowed.has(t.name))
}

/**
 * Pull every product handle that a tool result confirms is real this turn.
 * Used to detect fabricated /products/{handle} URLs in SMS replies — a
 * handle that didn't come from a tool result is a model invention.
 */
function collectRealHandles(result: ToolResult, sink: Set<string>): void {
  if (!result.ok || !result.data) return
  const data = result.data as Record<string, unknown>
  const list = data['results']
  if (Array.isArray(list)) {
    for (const item of list) {
      const h = (item as { handle?: string })?.handle
      if (h) sink.add(h)
    }
  }
  const single = data as { handle?: string }
  if (single?.handle) sink.add(single.handle)
  const collections = data['collections']
  if (Array.isArray(collections)) {
    for (const c of collections) {
      const preview = (c as { preview?: Array<{ handle?: string }> })?.preview
      if (Array.isArray(preview)) {
        for (const p of preview) if (p?.handle) sink.add(p.handle)
      }
    }
  }
}

/**
 * Catch fabricated /products/{handle} URLs before we send the SMS. Handles
 * that aren't in realHandles weren't returned by any tool this turn — they're
 * inventions. We strip them rather than swap-and-send a wrong product, which
 * would be worse than no product link.
 */
export function validateSmsPdpUrls(text: string, realHandles: Set<string>): string {
  if (!text) return text
  const PDP_RE = /(https?:\/\/)?xdipx\.com\/products\/([a-z0-9][a-z0-9-]*)/gi
  let stripped = false
  const out = text.replace(PDP_RE, (match, _proto: string | undefined, handle: string) => {
    if (realHandles.has(handle.toLowerCase())) return match
    stripped = true
    return '' // remove the fabricated URL entirely
  })
  if (stripped) {
    console.warn('[ai-agent] sms reply contained a fabricated PDP URL — stripped', {
      realHandles: [...realHandles],
    })
    // Tidy any double-spaces or orphan punctuation left behind by the strip.
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+\n/g, '\n').trim()
  }
  return out
}

/**
 * Catch fabricated checkout URLs before we send them. Haiku has been observed
 * inventing a Shopify cart URL by base64-encoding a JSON blob like
 * `{cart_id, line_items, attributes}` instead of calling buildCheckoutLink.
 *
 * If the reply contains a Shopify checkout-shaped URL that doesn't match any
 * URL the buildCheckoutLink tool actually returned this turn:
 *   - if we have a real URL captured, swap the fake one out for the real one
 *   - otherwise replace the whole reply with a recovery line so the shopper
 *     gets a clear "try again" rather than a 404
 */
export function validateSmsCheckoutUrls(text: string, realUrls: string[]): string {
  if (!text) return text
  const CHECKOUT_RE = /https?:\/\/(?:[\w-]+\.)?(?:myshopify\.com|xdipx\.com)\/(?:cart|checkouts?)\/\S+/gi
  // Also match bare-domain forms that ensureCheckoutProtocol() will rescue downstream.
  const BARE_RE = /\b(?:[\w-]+\.)?(?:myshopify\.com|xdipx\.com)\/(?:cart|checkouts?)\/\S+/gi

  const realSet = new Set(realUrls)
  const realBareSet = new Set(realUrls.map((u) => u.replace(/^https?:\/\//, '')))

  const replaceBad = (match: string, isBare: boolean): string => {
    const candidate = isBare ? match : match
    const hit = isBare ? realBareSet.has(candidate) : realSet.has(candidate)
    if (hit) return match
    if (realUrls.length > 0) {
      // Swap to the first real URL so the customer gets a working checkout.
      return realUrls[0]!
    }
    // No real URL captured — strip and let the outer recovery branch handle it.
    return '__FABRICATED_CHECKOUT__'
  }

  let out = text.replace(CHECKOUT_RE, (m) => replaceBad(m, false))
  out = out.replace(BARE_RE, (m) => replaceBad(m, true))

  if (out.includes('__FABRICATED_CHECKOUT__')) {
    console.warn('[ai-agent] sms reply contained a fabricated checkout URL — replacing reply', { realUrls })
    return "Hmm — couldn't generate the checkout link cleanly. Mind saying 'send the link' once more?"
  }
  return out
}

// Hard ceiling on SMS replies. Twilio auto-concatenates segments at ~153 chars
// each (GSM-7 with header), so 480 ≈ 3 segments. Two-product pitches with PDP
// links + price + closing question land around 350–420 chars, so 480 leaves
// headroom without runaway-output risk. Single-product pitches still fit in 1
// segment if Emma writes tight; the prompt keeps her aiming low.
const SMS_MAX_CHARS = 480
// Below this length we pass through untouched.
const SMS_SOFT_LIMIT = 480

/**
 * Clamp SMS replies to fit Twilio's segment economics, trimming at a sentence
 * boundary when possible (then word boundary, then hard cut) so we never break
 * mid-word and never cut a customer off mid-thought. Also re-adds https:// to
 * Shopify checkout URLs the model occasionally emits as bare domains.
 */
export function clampSms(text: string): string {
  const fixed = ensureCheckoutProtocol(text)
  const trimmed = fixed.trim()
  if (trimmed.length <= SMS_SOFT_LIMIT) return trimmed

  const cut = trimmed.slice(0, SMS_MAX_CHARS - 3)
  // Prefer cutting at a sentence terminator (. ! ? \n) so we end on a complete thought.
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('\n'),
  )
  if (sentenceEnd > SMS_MAX_CHARS * 0.6) {
    return cut.slice(0, sentenceEnd + 1).trimEnd()
  }
  // Fall back to a word boundary so we never end mid-token.
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace > SMS_MAX_CHARS * 0.6) {
    return cut.slice(0, lastSpace).trimEnd() + '...'
  }
  return cut + '...'
}

function ensureCheckoutProtocol(text: string): string {
  if (!text) return text
  // Re-prefix bare Shopify checkout / cart URLs with https:// when the model
  // strips the protocol. Skip URLs that already have a scheme.
  return text.replace(
    /(^|[\s(])(xdipx\.myshopify\.com\/(?:cart|checkouts?)\/\S+)/g,
    (_match, lead: string, url: string) => `${lead}https://${url}`,
  )
}

/**
 * Turn the shopper's current page into a one-line system-prompt addendum.
 * Only resolves products for /products/{handle} (the expensive case) so we
 * don't pay Shopify round-trips for routes that don't benefit from extra
 * context. Other routes get a short "shopper is on X" note.
 */
async function buildPageAddendum(
  pageContext: AgentContext['pageContext'],
): Promise<string | null> {
  const pathname = pageContext?.pathname?.trim()
  if (!pathname) return null

  const productMatch = pathname.match(/^\/products\/([a-z0-9][a-z0-9-]*)\/?$/i)
  if (productMatch && productMatch[1]) {
    const handle = productMatch[1]
    try {
      const product = await getProductByHandle(handle)
      if (product) {
        return `CURRENT PAGE: The shopper is on the product page for "${product.title}" (handle: ${handle}, URL: /products/${handle}). When they ask ambiguous questions ("how big is it?", "tell me more", "is it waterproof?"), assume they mean THIS product — call getProductDetails with the handle above and answer directly. Do not re-run searchProducts or ask who it's for unless the shopper explicitly steers to a different product. You can reference the product naturally ("this one", "the ${product.title}") without re-pitching from scratch.`
      }
    } catch (err) {
      console.warn('[chat.server] pageContext product lookup failed', { handle, err })
    }
    // Handle didn't resolve — still useful context that they're on a PDP.
    return `CURRENT PAGE: The shopper is on a product detail page (${pathname}).`
  }

  const collectionMatch = pathname.match(/^\/collections\/([a-z0-9][a-z0-9-]*)\/?$/i)
  if (collectionMatch) {
    return `CURRENT PAGE: The shopper is browsing the collection page at ${pathname}. If they ask ambiguous questions ("any good ones?", "what's popular here?"), assume they mean this collection.`
  }

  const friendly = pathname === '/' ? 'the homepage'
    : pathname === '/vault' ? 'the Vault (past deals archive)'
    : pathname === '/for-her' ? 'the For Her landing page'
    : pathname === '/for-him' ? 'the For Him landing page'
    : pathname === '/faq' ? 'the FAQ page'
    : pathname === '/about' ? 'the About page'
    : `the page at ${pathname}`
  return `CURRENT PAGE: The shopper is on ${friendly}.`
}

/**
 * Shopify cart permalinks use commas between line items — `/cart/ID:QTY,ID:QTY`.
 * Haiku occasionally writes `&` (URL-query style) or a space, which 404s. Fix
 * both forms defensively so a model slip doesn't break checkout.
 */
function fixCartUrls(text: string): string {
  if (!text) return text
  return text.replace(/\/cart\/([0-9:&,\s]+)/g, (_match, body: string) => {
    const normalized = body.replace(/[\s&]+/g, ',').replace(/,+/g, ',').replace(/,$/, '')
    return `/cart/${normalized}`
  })
}

/**
 * Haiku sometimes leaks the follow-up prompt's framing as a meta-preamble
 * ("Got it! Here's the pitch that goes above those pills:"). Strip leading
 * sentences/lines that reference pitch/pills/instructions/prompt/reply so
 * only the shopper-facing copy remains.
 */
function stripMetaPreamble(text: string): string {
  if (!text) return text
  const metaWord = /\b(pitch|pills?|prompt|instructions?|reply|response)\b/i
  let out = text.trim()
  // Repeatedly peel a leading meta-sentence ending in : or . or newline.
  for (let i = 0; i < 3; i++) {
    const match = out.match(/^([^\n.:!?]{0,160}[.:!?\n])\s*/)
    if (!match) break
    if (!metaWord.test(match[1] ?? '')) break
    out = out.slice(match[0].length)
  }
  return out.trim() || text
}

/**
 * Pull IvrProductCard[] out of a tool result and stash by handle so the same
 * product isn't rendered twice when multiple tools surface it.
 */
function collectCards(result: ToolResult, sink: Map<string, IvrProductCard>) {
  if (!result.ok || !result.data) return
  const data = result.data as Record<string, unknown>
  const list = data['results']
  if (Array.isArray(list)) {
    for (const item of list) {
      const card = item as IvrProductCard
      if (card?.handle && !sink.has(card.handle)) sink.set(card.handle, card)
    }
    return
  }
  // getProductDetails returns a single card at the top level.
  const single = result.data as Partial<IvrProductCard>
  if (single?.handle && !sink.has(single.handle)) {
    sink.set(single.handle, single as IvrProductCard)
  }
}

/** Batch-fetch Shopify products once so cards render with real images. */
async function hydrateCards(cards: IvrProductCard[]): Promise<ChatProductCard[]> {
  if (cards.length === 0) return []
  const handles = cards.map((c) => c.handle).filter(Boolean)
  const products = await getProductsByHandles(handles)
  const imgByHandle = new Map<string, { url: string; alt: string }>()
  for (const p of products) {
    const img = p.images[0]
    if (img?.url) imgByHandle.set(p.handle, { url: img.url, alt: img.altText || p.title })
  }
  return cards.map((c) => {
    const img = imgByHandle.get(c.handle)
    const variantOptions = filterRealVariants(c.variantOptions)
    return {
      handle: c.handle,
      title: c.title,
      tagline: c.tagline,
      category: c.category,
      price: c.price,
      pctOff: c.pctOff,
      phrasing: c.phrasing,
      inStock: c.inStock,
      variantId: c.variantId,
      url: `/products/${c.handle}`,
      ...(img ? { imageUrl: img.url, imageAlt: img.alt } : {}),
      ...(variantOptions.length > 1 ? { variantOptions } : {}),
    }
  })
}

/** Drop Shopify's "Default Title" synthetic variants so single-option products don't show pills. */
function filterRealVariants(opts: IvrProductCard['variantOptions']): NonNullable<IvrProductCard['variantOptions']> {
  if (!opts || opts.length === 0) return []
  return opts.filter((v) => v.label && v.label.trim().toLowerCase() !== 'default title')
}
