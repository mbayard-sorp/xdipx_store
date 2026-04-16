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
  searchProducts as shopifySearch,
} from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { draftOrders } from '~/../db/schema'
import { sendSms } from '~/lib/twilio.server'
import type { Product } from '~/types'

export const MAX_ORDER_VALUE_CENTS = Number(process.env['IVR_MAX_ORDER_VALUE_CENTS'] ?? 50_000) // $500
export const MAX_ITEMS_PER_ORDER   = Number(process.env['IVR_MAX_ITEMS_PER_ORDER']   ?? 5)
export const MAX_ORDERS_PER_24H    = Number(process.env['IVR_MAX_ORDERS_PER_24H']    ?? 2)

export interface AgentContext {
  phone?: string
  channel: 'voice' | 'sms'
}

export const QA_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'searchProducts',
    description:
      "Search the xdipx catalog for products that match the user's words. Use when the user asks for a category, brand, problem, or use-case (e.g. 'anything for couples', 'lube for sensitive skin', 'show me rabbits'). Returns up to 5 products with titles, handles, and pricing cleared against MAP rules. Never guess pricing — always call this.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query from the user.' },
        limit: { type: 'number', description: 'Max results to return. 1–5. Default 5.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'getProductDetails',
    description:
      "Fetch full details on a specific product by its handle (slug). Use after searchProducts when the user picks one, or when they name a specific product. Returns title, description, price, MAP-cleared display price, tags, and URL.",
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
    name: 'listTodaysCollections',
    description:
      "List the top-level browsable collections on xdipx (For Him, For Her, Couples, Daily Deal, Bundles, Vault). Use when the user asks 'what do you sell' or 'what categories do you have'.",
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

function applyMapRule(price: number, msrp: number, mapPrice: number): DisplayPrice {
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
  return {
    title: p.title,
    handle: p.handle,
    url: `https://xdipx.com/products/${p.handle}`,
    brand: p.brand ?? '',
    category: p.category ?? '',
    inStock: p.variants.some((v) => v.availableForSale),
    display: disp,
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
      const { products } = await shopifySearch({ query, first: limit })
      const resolved = await Promise.all(
        products.slice(0, limit).map((sp) => getProductByHandle(sp.handle)),
      )
      const cards = resolved.filter((p): p is Product => !!p).map(productToCard)
      return { ok: true, data: { query, results: cards } }
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

    if (name === 'listTodaysCollections') {
      return {
        ok: true,
        data: {
          collections: [
            { handle: 'daily-deal', title: "Today's Deal", url: 'https://xdipx.com/' },
            { handle: 'for-him', title: 'For Him', url: 'https://xdipx.com/for-him' },
            { handle: 'for-her', title: 'For Her', url: 'https://xdipx.com/for-her' },
            { handle: 'couples', title: 'For Couples', url: 'https://xdipx.com/for-couples' },
            { handle: 'bundles', title: 'Bundles', url: 'https://xdipx.com/bundles' },
            { handle: 'vault', title: 'The Vault (past deals)', url: 'https://xdipx.com/vault' },
          ],
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
      const state = String(input['state'] ?? '').trim().toUpperCase()
      const zip = String(input['zip'] ?? '').trim()
      if (!email || !customerName || !address1 || !city || !state || !zip) {
        return { ok: false, error: 'missing_fields' }
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid_email' }
      if (!/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, error: 'invalid_zip' }
      if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: 'invalid_state' }

      const lineItems = items.map((it) => ({
        variantId: String(it['variantId'] ?? ''),
        quantity: Math.max(1, Math.min(MAX_ITEMS_PER_ORDER, Number(it['quantity'] ?? 1))),
      }))
      if (lineItems.some((li) => !li.variantId.startsWith('gid://shopify/ProductVariant/'))) {
        return { ok: false, error: 'invalid_variant_id' }
      }

      const address2 = String(input['address2'] ?? '').trim()
      const draft = await createDraftOrder({
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

      if (draft.subtotalPriceCents > MAX_ORDER_VALUE_CENTS) {
        return {
          ok: false,
          error: 'over_order_cap',
          message: `Subtotal $${(draft.subtotalPriceCents / 100).toFixed(2)} exceeds $${(MAX_ORDER_VALUE_CENTS / 100).toFixed(0)} phone-order cap.`,
        }
      }

      if (draft.invoiceUrl) {
        try {
          await sendSms(ctx.phone, `xdipx: your secure payment link for ${draft.name} — ${draft.invoiceUrl} — held 24h.`)
        } catch (err) {
          console.error('[ai-agent] failed to SMS invoice link', err)
        }
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
