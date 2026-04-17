/**
 * Tool registry — JSON schemas for Claude tool use + handlers. Each handler
 * receives { session, input } and returns a JSON-serialisable result that's
 * fed back to Claude as a tool_result block.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { Session } from '../session.ts'
import { readTodaysDeal } from './deal.ts'
import { lookupOrder } from './orders.ts'
import { sendDealLinkSMS } from './sms.ts'
import { recordVoicemail } from './voicemail.ts'
import { callQaTool } from './catalog.ts'

const MAX_ORDER_LOOKUPS_PER_CALL = 5

export interface ToolContext {
  session: Session
}

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'readTodaysDeal',
    description:
      "Look up today's featured flash-sale deal on xdipx (title, tagline, price, % off, stock). Call this when the caller asks what's on sale, what the deal is, what's featured, or any variation of 'what do you have today'. Always call this tool — never guess prices.",
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'lookupOrder',
    description:
      "Look up a customer's order by order number + last 4 digits of their billing ZIP. Collect both from the caller first — they may say the order number in words (e.g. 'number one two three four'); treat as digits. Returns fulfilment status, tracking number, carrier, and estimated delivery. If verification_failed twice, offer to take a voicemail instead of retrying further.",
    input_schema: {
      type: 'object',
      properties: {
        orderNumber: {
          type: 'string',
          description: "The order number the caller gave, digits only (e.g. '1234').",
        },
        zipLast4: {
          type: 'string',
          description: 'Last 4 digits of the billing ZIP code.',
        },
      },
      required: ['orderNumber', 'zipLast4'],
      additionalProperties: false,
    },
  },
  {
    name: 'recordVoicemail',
    description:
      "Save a voicemail from this caller. Call this AFTER you've confirmed: (1) the caller wants to leave a message, (2) you have a brief written summary of what they need, and (3) you have a callback number (default to their caller ID if they confirm). Optionally include an order number if the call was about one. Do not call this tool silently — tell the caller their message was saved.",
    input_schema: {
      type: 'object',
      properties: {
        callbackNumber: {
          type: 'string',
          description: 'Phone number to call back (with country code if international). Defaults to caller ID if omitted.',
        },
        summary: {
          type: 'string',
          description: "One or two sentences describing what the caller needs and any context. Written, not spoken.",
        },
        contextOrderNumber: {
          type: 'string',
          description: 'Related order number if the caller mentioned one.',
        },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'searchProducts',
    description:
      "Search the xdipx catalog for products matching a keyword or phrase. Returns up to 5 matches with titles, taglines, MAP-cleared prices, stock status, AND the Shopify variantId you'll need later to create a draft order. Always call this before quoting any price. Supports optional category and price filters. If the first search returns nothing useful, try again with a broader or different term (e.g. 'massager' instead of 'back massager'). Remove modifiers and retry before telling the caller we don't carry it.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Short search words. Prefer 1–2 words (e.g. 'wand', 'lube', 'couple kit'). Don't paste the caller's full sentence." },
        limit: { type: 'number', description: '1–5, default 3. Keep low on phone — you can only say a few aloud.' },
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples', 'both'], description: 'Filter by audience category if the caller specified.' },
        priceMax: { type: 'number', description: 'Max price in dollars if the caller gave a budget.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'discoverProducts',
    description:
      "Find products by mood, use-case, experience level, or features — use when the caller describes a vibe or scenario rather than naming a specific product (e.g. 'something for date night', 'beginner-friendly', 'waterproof and quiet'). Uses structured tags for better matching than keyword search.",
    input_schema: {
      type: 'object',
      properties: {
        mood: { type: 'array', items: { type: 'string', enum: ['playful', 'romantic', 'luxurious', 'adventurous', 'relaxing'] }, description: 'Mood/vibe tags matching what the caller described.' },
        experience: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], description: 'Experience level if the caller mentioned it.' },
        useCase: { type: 'array', items: { type: 'string', enum: ['solo', 'couples', 'date-night', 'gift', 'travel'] }, description: 'Use-case tags.' },
        features: { type: 'array', items: { type: 'string', enum: ['waterproof', 'quiet', 'rechargeable', 'app-controlled', 'body-safe'] }, description: 'Feature tags the caller asked about.' },
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples', 'both'], description: 'Audience category.' },
        priceMax: { type: 'number', description: 'Max price in dollars.' },
        limit: { type: 'number', description: '1–5, default 3. Keep low on phone.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'recommendSimilar',
    description:
      "After the caller picks a product, suggest 1–2 frequently bought-together items. Use as a natural add-on: 'people who got that also grabbed...' Keep it brief — one sentence. Never push if the caller has declined or seems in a hurry.",
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Handle of the product the caller is buying.' },
        limit: { type: 'number', description: '1–3, default 2.' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
  {
    name: 'getProductDetails',
    description:
      "Fetch extra details on a specific product by its handle. Only needed if the caller asks about specific variant options or details not covered by the search result tagline — searchProducts already returns title, tagline, pricing, and default variant.",
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Product handle/slug returned by searchProducts.' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
  {
    name: 'listTodaysCollections',
    description:
      "List the browsable collections on xdipx (For Him, For Her, Couples, Bundles, Vault). Use when the caller asks what we sell overall.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lookupReturningCustomer',
    description:
      "Check if this caller is an existing xdipx customer so you can skip asking for their shipping address. Uses caller ID automatically — don't ask them for their phone number.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'createDraftOrder',
    description:
      "Create a Shopify draft order and EMAIL the caller a secure Shopify checkout link. SMS is not wired up — delivery is email only, so the caller's email must be correct. ONLY call after: (1) confirmed each product + variant + quantity via searchProducts/getProductDetails, (2) collected email (read back to confirm) + full name + full shipping address, (3) read back a GENERIC item description (e.g. 'one item from for-her, one accessory') and got a clear 'yes'. Never read full product names on a speakerphone. Never collect card numbers — Shopify handles payment. Hard caps: $500 subtotal, 5 line items. On limit error, apologize and offer a human callback via recordVoicemail.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variantId: { type: 'string', description: "Shopify variant GID, e.g. 'gid://shopify/ProductVariant/1234'." },
              quantity:  { type: 'number', description: 'Integer 1–5.' },
              title:     { type: 'string', description: 'Short human label — your own reference.' },
            },
            required: ['variantId', 'quantity'],
            additionalProperties: false,
          },
        },
        email:    { type: 'string', description: 'Customer email for the invoice.' },
        name:     { type: 'string', description: 'Full name for shipping.' },
        address1: { type: 'string', description: 'Street address line 1.' },
        address2: { type: 'string', description: 'Apt/suite (optional).' },
        city:     { type: 'string', description: 'City.' },
        state:    { type: 'string', description: "Two-letter US state code, e.g. 'CA'." },
        zip:      { type: 'string', description: 'ZIP code.' },
      },
      required: ['items', 'email', 'name', 'address1', 'city', 'state', 'zip'],
      additionalProperties: false,
    },
  },
  {
    name: 'sendDealLinkSMS',
    description:
      "Text the caller a link to today's deal at their calling-number. Call this when the caller asks you to 'text me the link', 'send it to my phone', or similar. Confirms the number you're texting before sending is not required — we always use their caller ID.",
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]

export async function runTool(
  name: string,
  _input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case 'readTodaysDeal': {
      const deal = await readTodaysDeal()
      if (!deal) return { error: 'no_live_deal', message: 'No deal is live right now.' }
      return deal
    }
    case 'lookupOrder': {
      const n = ctx.session.incrementToolCall('lookupOrder')
      if (n > MAX_ORDER_LOOKUPS_PER_CALL) {
        return {
          ok: false,
          error: 'rate_limited',
          message: 'Too many lookup attempts on this call. Offer voicemail.',
        }
      }
      const parsed = _input as { orderNumber?: string; zipLast4?: string }
      if (!parsed?.orderNumber || !parsed?.zipLast4) {
        return { ok: false, error: 'verification_failed', message: 'Missing orderNumber or zipLast4.' }
      }
      return await lookupOrder({
        orderNumber: parsed.orderNumber,
        zipLast4: parsed.zipLast4,
      })
    }
    case 'recordVoicemail': {
      const parsed = _input as {
        callbackNumber?: string
        summary?: string
        contextOrderNumber?: string
      }
      if (!parsed?.summary) {
        return { ok: false, error: 'summary_required', message: 'Summary is required.' }
      }
      return await recordVoicemail(ctx.session, {
        callbackNumber: parsed.callbackNumber,
        summary: parsed.summary,
        contextOrderNumber: parsed.contextOrderNumber,
      })
    }
    case 'searchProducts':
    case 'discoverProducts':
    case 'recommendSimilar':
    case 'getProductDetails':
    case 'listTodaysCollections':
    case 'lookupReturningCustomer':
    case 'createDraftOrder': {
      return await callQaTool(name, (_input ?? {}) as Record<string, unknown>, {
        channel: 'voice',
        ...(ctx.session.fromNumber ? { phone: ctx.session.fromNumber } : {}),
      })
    }
    case 'sendDealLinkSMS': {
      const deal = await readTodaysDeal()
      if (!deal) return { error: 'no_live_deal', message: "No deal is live — can't send a link." }
      if (!ctx.session.fromNumber) {
        return { error: 'no_caller_id', message: "Caller ID isn't available." }
      }
      try {
        await sendDealLinkSMS(ctx.session.fromNumber, { title: deal.title, url: deal.url })
        return { ok: true, sentTo: ctx.session.fromNumber }
      } catch (err) {
        return { error: 'sms_failed', message: err instanceof Error ? err.message : String(err) }
      }
    }
    default:
      return { error: 'unknown_tool', message: `No handler for ${name}` }
  }
}
