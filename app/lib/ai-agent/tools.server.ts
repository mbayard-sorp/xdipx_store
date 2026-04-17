/**
 * Shared Q&A tools exposed to Claude on both SMS and (eventually) phone
 * channels. Every price-returning tool applies the MAP rule so Claude never
 * advertises a discount we're not allowed to advertise.
 *
 * MAP rules (per CLAUDE.md):
 *   - MAP = 0        → fine to discount; show % off MSRP
 *   - 0 < MAP < MSRP → MAP is the floor; phrase as "best price we can advertise"
 *   - MAP = MSRP     → cannot advertise a discount at all
 */
import type Anthropic from '@anthropic-ai/sdk'
import { and, eq, gte, sql } from 'drizzle-orm'
import {
  createDraftOrder,
  findCustomerByPhone,
  getProductByHandle,
  getStorefrontCollections,
  sendDraftOrderInvoice,
} from '~/lib/shopify.server'
import { searchForIvr, discoverForIvr, getIvrCardsByHandles } from '~/lib/ivr-search.server'
import { getFrequentlyBoughtWith } from '~/lib/recommendations.server'
import { db } from '~/lib/db.server'
import { draftOrders } from '~/../db/schema'
import type { Product } from '~/types'

export const MAX_ORDER_VALUE_CENTS = Number(process.env['IVR_MAX_ORDER_VALUE_CENTS'] ?? 50_000) // $500
export const MAX_ITEMS_PER_ORDER   = Number(process.env['IVR_MAX_ITEMS_PER_ORDER']   ?? 5)
export const MAX_ORDERS_PER_24H    = Number(process.env['IVR_MAX_ORDERS_PER_24H']    ?? 50)

// Claude sometimes passes the full state name ("California") even when the
// prompt asks for a 2-letter code. Normalize on the server so the tool call
// succeeds instead of bouncing Claude into a voicemail fallback.
const STATE_CODES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
  MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH',
  OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
}

function normalizeState(raw: string): string {
  const s = raw.trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(s)) return s
  return STATE_CODES[s] ?? s
}

export interface AgentContext {
  phone?: string
  channel: 'voice' | 'sms'
}

export const QA_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'searchProducts',
    description:
      "Search the xdipx catalog for products matching a keyword or phrase. Use when the user names a specific product, category, or brand (e.g. 'vibrator', 'lube', 'show me rabbits'). Returns up to 5 products with titles, taglines, MAP-cleared prices, and variant IDs. Supports optional category and price filters. Never guess pricing — always call this.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query from the user.' },
        limit: { type: 'number', description: 'Max results to return. 1–5. Default 5.' },
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples', 'both'], description: 'Filter by audience category.' },
        priceMax: { type: 'number', description: 'Max price in dollars.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'discoverProducts',
    description:
      "Find products by mood, use-case, experience level, or features — use when the user describes a vibe or scenario rather than naming a specific product (e.g. 'something for date night', 'beginner-friendly', 'waterproof and quiet'). Uses structured tags for better matching than keyword search.",
    input_schema: {
      type: 'object',
      properties: {
        mood: { type: 'array', items: { type: 'string', enum: ['playful', 'romantic', 'luxurious', 'adventurous', 'relaxing'] }, description: 'Mood/vibe tags.' },
        experience: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], description: 'Experience level.' },
        useCase: { type: 'array', items: { type: 'string', enum: ['solo', 'couples', 'date-night', 'gift', 'travel'] }, description: 'Use-case tags.' },
        features: { type: 'array', items: { type: 'string', enum: ['waterproof', 'quiet', 'rechargeable', 'app-controlled', 'body-safe'] }, description: 'Feature tags.' },
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples', 'both'], description: 'Audience category.' },
        priceMax: { type: 'number', description: 'Max price in dollars.' },
        limit: { type: 'number', description: '1–5, default 3.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'recommendSimilar',
    description:
      "Suggest 1–2 frequently bought-together items after the user picks a product. Use as a natural add-on suggestion: 'people who got that also grabbed...' Returns recommendations based on real order data.",
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
  {
    name: 'getProductDetails',
    description:
      "Fetch extra details on a specific product by its handle. Only needed if the user asks about specific variant options or details not covered by the search result tagline — searchProducts already returns title, tagline, pricing, and default variant.",
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Product handle/slug (e.g. "acme-rabbit-2000").' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
  {
    name: 'listCollections',
    description:
      "List the browsable collections on xdipx. Use when the user asks 'what do you sell' or 'what categories do you have'.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lookupReturningCustomer',
    description:
      "Check whether the caller/texter already has an account on xdipx, so you can skip re-collecting their shipping address. Uses the caller's phone number automatically — do not ask the user for it. Returns name, email, and default shipping address if found.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'createDraftOrder',
    description:
      "Create a Shopify draft order and send the caller a secure checkout link via SMS + email. Call this ONLY after you have: (1) confirmed each product + variant + quantity, (2) collected email, full name, and shipping address (address1, city, state, zip), (3) read back a generic summary and gotten explicit confirmation ('yes, send it'). Never collect card numbers — Shopify checkout handles payment. Hard caps: $500 order subtotal, 5 line items, 2 orders per 24h per phone number. If the tool returns a limit error, apologize and offer to have a human follow up.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Line items keyed by Shopify variant GID from searchProducts/getProductDetails results.',
          items: {
            type: 'object',
            properties: {
              variantId: { type: 'string', description: "Shopify variant GID, e.g. 'gid://shopify/ProductVariant/1234'." },
              quantity:  { type: 'number', description: 'Integer quantity, 1–5.' },
              title:     { type: 'string', description: 'Short human-readable label for your own reference (not shown to user).' },
            },
            required: ['variantId', 'quantity'],
            additionalProperties: false,
          },
        },
        email:       { type: 'string', description: "Customer's email address for the invoice." },
        name:        { type: 'string', description: "Customer's full name for shipping." },
        address1:    { type: 'string', description: 'Street address line 1.' },
        address2:    { type: 'string', description: 'Apartment / suite (optional).' },
        city:        { type: 'string', description: 'City.' },
        state:       { type: 'string', description: "Two-letter US state code (e.g. 'CA')." },
        zip:         { type: 'string', description: 'ZIP / postal code.' },
      },
      required: ['items', 'email', 'name', 'address1', 'city', 'state', 'zip'],
      additionalProperties: false,
    },
  },
]

export interface DisplayPrice {
  /** Numeric price to quote to the user. */
  price: number
  /** MSRP or original price (for % savings math). */
  msrp: number
  /** Percent off MSRP rounded to nearest int. 0 when discount not advertisable. */
  pctOffMsrp: number
  /** How Claude should phrase this price. */
  phrasing: 'deal' | 'map_floor' | 'msrp_only'
}

export function applyMapRule(price: number, msrp: number, mapPrice: number): DisplayPrice {
  const effectiveMsrp = msrp > 0 ? msrp : price
  if (mapPrice > 0 && mapPrice >= effectiveMsrp) {
    return { price: effectiveMsrp, msrp: effectiveMsrp, pctOffMsrp: 0, phrasing: 'msrp_only' }
  }
  const floor = mapPrice > 0 ? Math.max(price, mapPrice) : price
  const pct = effectiveMsrp > 0 ? Math.round(((effectiveMsrp - floor) / effectiveMsrp) * 100) : 0
  return {
    price: floor,
    msrp: effectiveMsrp,
    pctOffMsrp: pct > 0 ? pct : 0,
    phrasing: mapPrice > 0 && mapPrice < effectiveMsrp ? 'map_floor' : pct > 0 ? 'deal' : 'msrp_only',
  }
}

function productToCard(p: Product) {
  const variantPrice = p.variants[0]?.price
  const price = variantPrice ? Number(variantPrice) : (p.price ?? 0)
  const mapPrice = (p as Product & { mapPrice?: number }).mapPrice ?? 0
  const msrp = p.compareAtPrice ?? price
  const disp = applyMapRule(price, msrp, mapPrice)
  // Claude needs variant GIDs to build createDraftOrder line items. We expose
  // the default variant for single-variant products, plus a trimmed list of
  // in-stock variants for multi-variant products so Claude can offer options.
  const inStockVariants = p.variants.filter((v) => v.availableForSale)
  const defaultVariant = inStockVariants[0] ?? p.variants[0]
  const variantOptions =
    p.variants.length > 1
      ? p.variants.slice(0, 5).map((v) => ({
          variantId: v.id,
          label: v.title,
          price: Number(v.price),
          inStock: v.availableForSale,
        }))
      : undefined
  return {
    title: p.title,
    handle: p.handle,
    url: `https://xdipx.com/products/${p.handle}`,
    brand: p.brand ?? '',
    category: p.category ?? '',
    inStock: inStockVariants.length > 0,
    display: disp,
    variantId: defaultVariant?.id ?? '',
    ...(variantOptions ? { variantOptions } : {}),
  }
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
  message?: string
}

export async function runQaTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext = { channel: 'sms' },
): Promise<ToolResult> {
  try {
    if (name === 'searchProducts') {
      const query = String(input['query'] ?? '').trim()
      const limit = Math.max(1, Math.min(5, Number(input['limit'] ?? 5)))
      if (!query) return { ok: false, error: 'empty query' }
      const category = input['category'] ? String(input['category']).trim() : undefined
      const priceMax = input['priceMax'] != null ? Number(input['priceMax']) : undefined
      const cards = await searchForIvr({ query, limit, category, priceMax })
      return { ok: true, data: { query, results: cards } }
    }

    if (name === 'discoverProducts') {
      const mood = Array.isArray(input['mood']) ? input['mood'] as string[] : undefined
      const experience = input['experience'] ? String(input['experience']) : undefined
      const useCase = Array.isArray(input['useCase']) ? input['useCase'] as string[] : undefined
      const features = Array.isArray(input['features']) ? input['features'] as string[] : undefined
      const category = input['category'] ? String(input['category']) : undefined
      const priceMax = input['priceMax'] != null ? Number(input['priceMax']) : undefined
      const limit = Math.max(1, Math.min(5, Number(input['limit'] ?? 3)))
      const cards = await discoverForIvr({ mood, experience, useCase, features, category, priceMax, limit })
      return { ok: true, data: { results: cards } }
    }

    if (name === 'recommendSimilar') {
      const handle = String(input['handle'] ?? '').trim()
      if (!handle) return { ok: false, error: 'handle required' }
      const limit = Math.max(1, Math.min(3, Number(input['limit'] ?? 2)))
      const handles = await getFrequentlyBoughtWith(handle, limit)
      if (handles.length === 0) return { ok: true, data: { results: [] } }
      const cards = await getIvrCardsByHandles(handles)
      return { ok: true, data: { forHandle: handle, results: cards } }
    }

    if (name === 'getProductDetails') {
      const handle = String(input['handle'] ?? '').trim()
      if (!handle) return { ok: false, error: 'handle required' }
      const product = await getProductByHandle(handle)
      if (!product) return { ok: false, error: 'not_found' }
      return {
        ok: true,
        data: {
          ...productToCard(product),
          description: (product.metaDescription || '').slice(0, 400),
          tags: product.tags.slice(0, 8),
        },
      }
    }

    if (name === 'listCollections') {
      const collections = await getStorefrontCollections()
      return {
        ok: true,
        data: {
          collections: collections.map(c => ({
            handle: c.handle,
            title: c.title,
            url: `https://xdipx.com/collections/${c.handle}`,
          })),
        },
      }
    }

    if (name === 'lookupReturningCustomer') {
      if (!ctx.phone) return { ok: false, error: 'no_caller_phone' }
      const c = await findCustomerByPhone(ctx.phone)
      if (!c) return { ok: true, data: { found: false } }
      return {
        ok: true,
        data: {
          found: true,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          defaultAddress: c.defaultAddress,
        },
      }
    }

    if (name === 'createDraftOrder') {
      if (!ctx.phone) return { ok: false, error: 'no_caller_phone' }
      const items = Array.isArray(input['items']) ? (input['items'] as Array<Record<string, unknown>>) : []
      if (items.length === 0) return { ok: false, error: 'no_items' }
      if (items.length > MAX_ITEMS_PER_ORDER) {
        return { ok: false, error: 'too_many_items', message: `Max ${MAX_ITEMS_PER_ORDER} line items.` }
      }

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(draftOrders)
        .where(and(eq(draftOrders.phone, ctx.phone), gte(draftOrders.createdAt, since)))
      if ((recent?.n ?? 0) >= MAX_ORDERS_PER_24H) {
        return { ok: false, error: 'rate_limited', message: `Max ${MAX_ORDERS_PER_24H} orders per 24h.` }
      }

      const email = String(input['email'] ?? '').trim()
      const customerName = String(input['name'] ?? '').trim()
      const address1 = String(input['address1'] ?? '').trim()
      const city = String(input['city'] ?? '').trim()
      const stateRaw = String(input['state'] ?? '').trim()
      const state = normalizeState(stateRaw)
      const zipRaw = String(input['zip'] ?? '').trim()
      // Strip any spaces/dashes ElevenLabs transcribed mid-zip ("9 1 0 1 1").
      const zip = zipRaw.replace(/\s+/g, '').replace(/[^\d-]/g, '')
      const missing: string[] = []
      if (!email) missing.push('email')
      if (!customerName) missing.push('name')
      if (!address1) missing.push('address1')
      if (!city) missing.push('city')
      if (!stateRaw) missing.push('state')
      if (!zipRaw) missing.push('zip')
      if (missing.length) {
        return { ok: false, error: 'missing_fields', message: `Missing: ${missing.join(', ')}. Ask the caller for these and try again.` }
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: 'invalid_email', message: `Email "${email}" doesn't look right. Read it back to the caller and retry.` }
      }
      if (!/^\d{5}(-\d{4})?$/.test(zip)) {
        return { ok: false, error: 'invalid_zip', message: `ZIP "${zipRaw}" isn't 5 digits. Ask the caller for their ZIP again.` }
      }
      if (!/^[A-Z]{2}$/.test(state)) {
        return { ok: false, error: 'invalid_state', message: `State "${stateRaw}" is not a US state. Retry with a 2-letter code like CA or NY.` }
      }

      const lineItems = items.map((it) => ({
        variantId: String(it['variantId'] ?? ''),
        quantity: Math.max(1, Math.min(MAX_ITEMS_PER_ORDER, Number(it['quantity'] ?? 1))),
      }))
      if (lineItems.some((li) => !li.variantId.startsWith('gid://shopify/ProductVariant/'))) {
        return { ok: false, error: 'invalid_variant_id', message: 'One or more variantIds are missing the Shopify GID prefix. Re-run searchProducts to get fresh variantIds.' }
      }

      const address2 = String(input['address2'] ?? '').trim()
      let draft: Awaited<ReturnType<typeof createDraftOrder>>
      try {
        draft = await createDraftOrder({
          lineItems,
          customer: { email, name: customerName, phone: ctx.phone },
          shipping: {
            address1,
            ...(address2 ? { address2 } : {}),
            city,
            province: state,
            zip,
            country: 'US',
          },
          channel: ctx.channel,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ai-agent] createDraftOrder shopify failed', { msg, state, zip, city })
        return { ok: false, error: 'shopify_rejected', message: `Shopify rejected the draft: ${msg}. Read back the address to the caller and try again.` }
      }

      if (draft.subtotalPriceCents > MAX_ORDER_VALUE_CENTS) {
        return {
          ok: false,
          error: 'over_order_cap',
          message: `Subtotal $${(draft.subtotalPriceCents / 100).toFixed(2)} exceeds $${(MAX_ORDER_VALUE_CENTS / 100).toFixed(0)} phone-order cap.`,
        }
      }

      // Fire Shopify's built-in draft-order invoice email. SMS isn't wired up
      // on this number yet, so email is the only delivery channel for the
      // secure checkout link.
      let emailSent = false
      try {
        await sendDraftOrderInvoice(draft.id, { to: email })
        emailSent = true
      } catch (err) {
        console.error('[ai-agent] failed to send draft invoice email', err)
      }

      await db.insert(draftOrders).values({
        shopifyDraftId: draft.id,
        shopifyInvoiceUrl: draft.invoiceUrl,
        channel: ctx.channel,
        phone: ctx.phone,
        email,
        customerName,
        subtotalCents: draft.subtotalPriceCents,
        itemCount: draft.lineItems.reduce((s, li) => s + li.quantity, 0),
        lineItems: draft.lineItems.map((li) => ({
          variantId: li.variantId,
          title: li.title,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
        })),
      })

      return {
        ok: true,
        data: {
          draftName: draft.name,
          invoiceUrl: draft.invoiceUrl,
          subtotalCents: draft.subtotalPriceCents,
          totalCents: draft.totalPriceCents,
          emailSent,
          sentTo: email,
          lineItems: draft.lineItems.map((li) => ({
            title: li.title, quantity: li.quantity, unitPriceCents: li.unitPriceCents,
          })),
        },
      }
    }

    return { ok: false, error: `unknown tool: ${name}` }
  } catch (err) {
    console.error(`[ai-agent] tool ${name} failed`, err)
    return { ok: false, error: 'tool_failed' }
  }
}
