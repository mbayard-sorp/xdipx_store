/**
 * Chat tool registry — JSON schemas for Claude tool use + handlers. Most
 * tools delegate to runQaTool in ai-agent/tools.server.ts so chat, voice,
 * and SMS share one implementation (and MAP rule logic).
 *
 * Channel-specific handlers (readTodaysDeal, lookupOrder, sendDealLinkSMS)
 * live here because the chat needs an in-process call path rather than the
 * HTTP proxy the IVR uses.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { runQaTool } from '~/lib/ai-agent/tools.server'
import { cached, KV_KEYS } from '~/lib/kv.server'
import { getDailyDeal } from '~/lib/shopify.server'
import { sendSms } from '~/lib/twilio.server'
import type { ChatSession } from './session.server'
import type { ChatToolName } from './settings.server'

const MAX_ORDER_LOOKUPS_PER_SESSION = 5

export interface ChatToolContext {
  session: ChatSession
}

const TOOL_SCHEMAS: Record<ChatToolName, Anthropic.Tool> = {
  readTodaysDeal: {
    name: 'readTodaysDeal',
    description:
      "Look up today's featured flash-sale deal on xdipx (title, tagline, price, % off, link). Call this when the user asks what's on sale today, what the deal is, or any variation.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  lookupOrder: {
    name: 'lookupOrder',
    description:
      "Look up a user's order by order number + last 4 digits of their billing ZIP. Collect both from the user first. Returns fulfilment status, tracking number, carrier, and estimated delivery. If verification_failed twice, stop retrying and offer human handoff.",
    input_schema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string', description: 'The order number (digits only).' },
        zipLast4: { type: 'string', description: 'Last 4 digits of the billing ZIP code.' },
      },
      required: ['orderNumber', 'zipLast4'],
      additionalProperties: false,
    },
  },
  searchProducts: {
    name: 'searchProducts',
    description:
      "Search the xdipx catalog by keyword. Returns up to 5 matches with titles, taglines, MAP-cleared prices, stock status, AND the Shopify variantId for createDraftOrder. Always call this before quoting any price.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Short search words. 1–3 words ideal (e.g. 'wand', 'lube', 'couples kit')." },
        limit: { type: 'number', description: '1–5, default 5.' },
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples', 'both'], description: 'Filter by audience.' },
        priceMax: { type: 'number', description: 'Max price in dollars.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  discoverProducts: {
    name: 'discoverProducts',
    description:
      "Find products by mood, use-case, experience level, or features. Use when the user describes a vibe or scenario ('for date night', 'beginner-friendly', 'waterproof and quiet') rather than naming a product.",
    input_schema: {
      type: 'object',
      properties: {
        mood: { type: 'array', items: { type: 'string', enum: ['playful', 'romantic', 'luxurious', 'adventurous', 'relaxing'] } },
        experience: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
        useCase: { type: 'array', items: { type: 'string', enum: ['solo', 'couples', 'date-night', 'gift', 'travel'] } },
        features: { type: 'array', items: { type: 'string', enum: ['waterproof', 'quiet', 'rechargeable', 'app-controlled', 'body-safe'] } },
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples', 'both'] },
        priceMax: { type: 'number' },
        limit: { type: 'number', description: '1–5, default 3.' },
      },
      additionalProperties: false,
    },
  },
  recommendSimilar: {
    name: 'recommendSimilar',
    description:
      "After the user picks a product, suggest 1–2 frequently bought-together items. Use as a natural add-on: 'people who got that also grabbed...'. Keep it brief. Never push if the user declined once.",
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Handle of the product the user chose.' },
        limit: { type: 'number', description: '1–3, default 2.' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
  getProductDetails: {
    name: 'getProductDetails',
    description:
      "Fetch extra details on a specific product by its handle. Only needed if the user asks about specific variant options or details not covered by the searchProducts result.",
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Product handle/slug.' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
  listCollections: {
    name: 'listCollections',
    description: "List the browsable collections on xdipx. Use when the user asks what we sell or what categories we have.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  lookupReturningCustomer: {
    name: 'lookupReturningCustomer',
    description:
      "Check if this user already has an account so you can skip re-collecting their shipping address. Uses the phone on file automatically.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  createDraftOrder: {
    name: 'createDraftOrder',
    description:
      "Create a Shopify draft order and EMAIL the user a secure checkout link. Call this ONLY after: (1) confirmed product + variant + quantity, (2) collected email + full name + shipping address, (3) got a clear 'yes' to the summary. Never collect card numbers. Hard caps: $500 subtotal, 5 line items.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variantId: { type: 'string', description: "Shopify variant GID, e.g. 'gid://shopify/ProductVariant/1234'." },
              quantity: { type: 'number', description: 'Integer 1–5.' },
              title: { type: 'string', description: 'Short human label for your own reference.' },
            },
            required: ['variantId', 'quantity'],
            additionalProperties: false,
          },
        },
        email: { type: 'string', description: "Customer email for the invoice." },
        name: { type: 'string', description: "Customer's full name for shipping." },
        address1: { type: 'string', description: 'Street address line 1.' },
        address2: { type: 'string', description: 'Apt/suite (optional).' },
        city: { type: 'string', description: 'City.' },
        state: { type: 'string', description: "Two-letter US state code, e.g. 'CA'." },
        zip: { type: 'string', description: 'ZIP code.' },
      },
      required: ['items', 'email', 'name', 'address1', 'city', 'state', 'zip'],
      additionalProperties: false,
    },
  },
  sendDealLinkSMS: {
    name: 'sendDealLinkSMS',
    description:
      "Text the user a link to today's deal at the phone number they gave us at the start of the chat. Call this when the user asks you to 'text me the deal' or similar. Requires a phone on file — if none, tell the user we only have their email and link them in chat instead.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
}

export function getChatToolDefinitions(enabled: readonly ChatToolName[]): Anthropic.Tool[] {
  return enabled.map((name) => TOOL_SCHEMAS[name])
}

/** Cached deal fetch — the KV deal-of-day cache already handles staleness. */
async function fetchTodaysDeal(): Promise<{ title: string; tagline?: string; price?: number; compareAtPrice?: number; pctOff?: number; handle: string; url: string } | null> {
  return await cached(`chat:${KV_KEYS.dealOfDay}`, 60, async () => {
    const deal = await getDailyDeal()
    if (!deal) return null
    const price = deal.dealPrice ?? (deal.variants?.[0]?.price ? Number(deal.variants[0].price) : 0)
    const msrp = deal.msrp ?? price
    const pctOff = msrp > 0 && price < msrp ? Math.round(((msrp - price) / msrp) * 100) : 0
    return {
      title: deal.seoTitle,
      ...(deal.tagline ? { tagline: deal.tagline } : {}),
      price,
      compareAtPrice: msrp,
      pctOff,
      handle: deal.handle,
      url: `https://xdipx.com/products/${deal.handle}`,
    }
  })
}

export async function runChatTool(
  name: string,
  input: unknown,
  ctx: ChatToolContext,
): Promise<unknown> {
  switch (name) {
    case 'readTodaysDeal': {
      const deal = await fetchTodaysDeal()
      if (!deal) return { ok: false, error: 'no_live_deal', message: 'No deal is live right now.' }
      return { ok: true, data: deal }
    }
    case 'lookupOrder': {
      const n = ctx.session.incrementToolCall('lookupOrder')
      if (n > MAX_ORDER_LOOKUPS_PER_SESSION) {
        return { ok: false, error: 'rate_limited', message: 'Too many lookup attempts this session. Offer human handoff.' }
      }
      const parsed = input as { orderNumber?: string; zipLast4?: string }
      if (!parsed?.orderNumber || !parsed?.zipLast4) {
        return { ok: false, error: 'verification_failed', message: 'Missing orderNumber or zipLast4.' }
      }
      const { lookupOrderForChat } = await import('~/lib/emma/order-lookup.server')
      return await lookupOrderForChat(parsed.orderNumber, parsed.zipLast4)
    }
    case 'searchProducts':
    case 'discoverProducts':
    case 'recommendSimilar':
    case 'getProductDetails':
    case 'listCollections':
    case 'lookupReturningCustomer':
    case 'createDraftOrder': {
      return await runQaTool(name, (input ?? {}) as Record<string, unknown>, {
        channel: 'chat',
        ...(ctx.session.phone ? { phone: ctx.session.phone } : {}),
      })
    }
    case 'sendDealLinkSMS': {
      if (!ctx.session.phone) {
        return { ok: false, error: 'no_phone_on_file', message: "Session has no phone — tell the user we only have their email and link them in chat instead." }
      }
      const deal = await fetchTodaysDeal()
      if (!deal) return { ok: false, error: 'no_live_deal', message: "No deal is live — can't send a link." }
      try {
        await sendSms(ctx.session.phone, `Today's deal on xdipx: ${deal.title} — ${deal.url}`)
        return { ok: true, sentTo: ctx.session.phone }
      } catch (err) {
        return { ok: false, error: 'sms_failed', message: err instanceof Error ? err.message : String(err) }
      }
    }
    default:
      return { ok: false, error: 'unknown_tool', message: `No handler for ${name}` }
  }
}
