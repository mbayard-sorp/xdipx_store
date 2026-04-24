import Anthropic from '@anthropic-ai/sdk'
import { CHAT_SYSTEM_PROMPT } from './prompt'
import { QA_TOOL_DEFINITIONS, runQaTool, type AgentContext, type ToolResult } from './tools.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import type { ChatTurn, ChatProductCard, ChatReply, QuickReplyPayload } from './chat-types'

export type { ChatTurn, ChatProductCard, ChatReply, QuickReplyPayload }

const client = new Anthropic({ apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim() })

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOOL_HOPS = 5
const MAX_HISTORY_TURNS = 12
// Cap cards per reply so the prose response stays above the fold on mobile.
const MAX_CARDS_PER_REPLY = 4

/**
 * Generate a web-chat reply. Mirrors the SMS tool loop but:
 *   - bigger max_tokens (no 320-char SMS cap)
 *   - 5 tool hops so discovery → details → upsell can chain
 *   - captures product cards from tool results and hydrates images
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

  const collected = new Map<string, IvrProductCard>()
  let quickReply: QuickReplyPayload | undefined
  let cartUpdated = false
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

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: CHAT_SYSTEM_PROMPT,
      tools: QA_TOOL_DEFINITIONS,
      messages,
    })

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
        if (block.name === 'askQuickChoice' && result.ok && result.data) {
          const d = result.data as QuickReplyPayload
          if (d?.question && Array.isArray(d.options)) quickReply = d
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

    // When Haiku fires askQuickChoice on its own without an accompanying text
    // block (common on tell-more + commit-CTA turns), the pills appear with no
    // pitch behind them. Re-prompt once for just the prose so both render.
    if (!replyText && quickReply) {
      messages.push({ role: 'assistant', content: res.content })
      messages.push({
        role: 'user',
        content:
          'Continue with only your reply to the shopper in plain text — 2–3 sentences plus a closing question. Do not reference the pills, do not mention instructions, do not announce what you are about to say. Just the reply itself. No further tool calls.',
      })
      try {
        const follow = await client.messages.create({
          model: MODEL,
          max_tokens: 400,
          system: CHAT_SYSTEM_PROMPT + '\n\nRespond in plain text only — no further tool calls. Never reference pills, buttons, instructions, or what you are about to say.',
          messages,
        })
        const followText = follow.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
        replyText = stripMetaPreamble((followText?.text ?? '').trim())
      } catch (err) {
        console.error('[ai-agent] follow-up pitch call failed', err)
      }
    }

    replyText = fixCartUrls(stripMetaPreamble(replyText))

    const products = await hydrateCards([...collected.values()].slice(0, MAX_CARDS_PER_REPLY))
    const fallback = quickReply
      ? "Pick one and I'll take it from there ♥"
      : "Hmm — my brain blanked for a second. Say that again?"
    return {
      reply: replyText || fallback,
      products,
      history: [...bounded, { role: 'assistant', text: replyText || fallback }],
      ...(quickReply ? { quickReply } : {}),
      ...(cartUpdated ? { cartUpdated: true } : {}),
    }
  }

  // Out of hops — plain-text wrap-up without further tool calls.
  const final = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: CHAT_SYSTEM_PROMPT + '\n\nRespond in plain text only — no further tool calls.',
    messages,
  })
  const block = final.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  const replyText = fixCartUrls((block?.text ?? '').trim())
  const products = await hydrateCards([...collected.values()].slice(0, MAX_CARDS_PER_REPLY))
  return {
    reply: replyText || "Let me know if you want me to keep digging.",
    products,
    history: [...bounded, { role: 'assistant', text: replyText }],
    ...(quickReply ? { quickReply } : {}),
    ...(cartUpdated ? { cartUpdated: true } : {}),
  }
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
