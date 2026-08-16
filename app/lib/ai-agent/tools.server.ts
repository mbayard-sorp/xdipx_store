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
import {
  addLinesToCart,
  createCartWithLines,
  createDraftOrder,
  findCollectionsByQuery,
  findCustomerByPhone,
  getCollectionProducts,
  getProductByHandle,
  getProductDetailForEmma,
  getStorefrontCollections,
  sendDraftOrderInvoice,
} from '~/lib/shopify.server'
import {
  searchForIvrWithDiagnostics,
  discoverForIvrWithDiagnostics,
  getIvrCardsByHandles,
  type SearchDiagnostics,
} from '~/lib/ivr-search.server'
import { getSimilarByTag } from '~/lib/recommendations.server'
import { db } from '~/lib/db.server'
import { draftOrders } from '~/../db/schema'
import type { Product } from '~/types'

export const MAX_ORDER_VALUE_CENTS = Number(process.env['IVR_MAX_ORDER_VALUE_CENTS'] ?? 50_000) // $500
export const MAX_ITEMS_PER_ORDER   = Number(process.env['IVR_MAX_ITEMS_PER_ORDER']   ?? 5)

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
  /** Optional logged-in Shopify customer id — used by future chat tools. */
  customerId?: string
  channel: 'voice' | 'sms' | 'chat'
  /** Current cart id from the site cookie. Chat's addItemsToCart uses this to mutate the shopper's real cart instead of creating a parallel one. */
  cartId?: string | null
  /** Called when a tool creates a new cart so the action can set the cookie. */
  onCartCreated?: (cartId: string) => void
  /** Called whenever a tool mutates cart contents so the widget can pop the drawer. */
  onCartMutated?: () => void
  /** Current page the shopper is on. chat.server.ts hydrates this into the system prompt so Emma can reference the page naturally. */
  pageContext?: { pathname: string } | undefined
  /** Web chat session ID (UUID cookie). Used by chat.server.ts to read/write gate state in web_conversations. */
  sessionId?: string
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
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples'], description: 'Filter by audience tag. Multi-select on the doc — this filter matches any product that has the given tag among its category array.' },
        priceMax: { type: 'number', description: 'Max price in dollars.' },
        productTypeDial: { type: 'string', enum: ['vibrator', 'dildo', 'anal', 'bondage', 'cock-ring', 'stroker', 'couples', 'harness', 'extender', 'pump', 'lube', 'massage', 'enhancer', 'wear', 'condom', 'wellness', 'novelty', 'book-media', 'sex-machine'], description: 'Filter to one product type. Only set when the user clearly named a type — the wrong value filters out everything.' },
        productSubtypeDial: { type: 'string', description: "Subtype within the productTypeDial (e.g. 'wand' under vibrator, 'plug' under anal, 'water-based' under lube). Only applied when productTypeDial is also set." },
        mattersTags: { type: 'array', items: { type: 'string' }, description: "Preference tags the user actually stated, e.g. 'quiet', 'waterproof', 'beginner-friendly'. Matched against enriched product tags." },
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
        category: { type: 'string', enum: ['for-him', 'for-her', 'couples'], description: 'Audience tag. Multi-select on the doc — this filter matches any product that has the given tag among its category array.' },
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
      "Fetch enriched details on a specific product by its handle, including per-variant specs. Call this when the customer asks about size, dimensions, color, material, fit, or 'is this right for me' on a named product — and whenever the product has multiple variants (sizes, colors) and you need to describe what makes each one different. Also call it before createDraftOrder when the result has variantOptions and you don't yet have the right variantId. searchProducts already returns title, tagline, pricing, and default variant; this tool goes deeper with variant-level original descriptions, feature bullets, and full story.",
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
      "List the browsable collections on xdipx. Use when the user asks 'what do you sell' or 'what categories do you have'. For a targeted lookup by category or brand, prefer findCollection.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'findCollection',
    description:
      "Find the best-matching Shopify collection (category or brand) for a shopper's query and return a few preview products. Use this when a shopper asks about a broad category ('lingerie', 'bondage', 'anal', 'blindfolds') or a brand ('Lelo', 'Lovense', 'b-Vibe', 'LELO'). Returns collection handle + title + preview products. You can then either (a) pitch 1-2 of the previewed products, or (b) link the shopper to the collection PLP at /collections/{handle} for the full browsable page when there are many results. Always prefer this over refusing from memory — the store carries lingerie, apparel, bondage, restraints, and every major brand.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Category or brand keyword (e.g. 'lingerie', 'bondage', 'lelo', 'blindfolds', 'bodysuit')." },
        limit: { type: 'number', description: 'Max collections to return. 1–3. Default 2.' },
        previewCount: { type: 'number', description: 'How many preview products per collection. 1–4. Default 3.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookupReturningCustomer',
    description:
      "Check whether the caller/texter already has an account on xdipx, so you can skip re-collecting their shipping address. Uses the caller's phone number automatically — do not ask the user for it. Returns name, email, and default shipping address if found.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'askQuickChoice',
    description:
      "Chat-only. Show the user a set of tappable choice pills (single-select) or checkboxes (multi-select) to narrow their intent when their opening message is vague. Use at MOST once near the start of a conversation — don't pepper the user with repeated menus. Pair with a short, warm prose reply that introduces the choice. Valid modes: 'single' (one pill tap = next message) or 'multi' (user picks several + hits Send).",
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: "Short question shown above the pills, e.g. 'What vibe are you after?'. Under 140 chars." },
        options: {
          type: 'array',
          description: '3–5 short labels. Keep each under 30 chars. Order matters — put the most common first.',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 6,
        },
        mode: { type: 'string', enum: ['single', 'multi'], description: "'single' for one-tap pills, 'multi' for checkboxes." },
      },
      required: ['question', 'options', 'mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'addItemsToCart',
    description:
      "Add one or more products to the shopper's active cart on xdipx.com. Use this the moment the user commits ('I'll take it', 'add to cart', 'yes and add lube', 'let's check out'). ALWAYS pass the product handle from searchProducts/getProductDetails — the server will resolve the current variant. Only pass variantId when the UI provided one via a variant-pill tap ('variantId: gid://...'). Do NOT invent or guess variantIds. The cart drawer pops open automatically after your reply, so keep your reply short — a one-sentence acknowledgement like 'Added! Your cart's ready when you are.' Do NOT share URLs, do NOT paste links, do NOT call buildCheckoutLink — the drawer handles checkout from here. Chat-only.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Line items. Max 5. Each must include handle; variantId is optional and only used when the UI passed one via a variant-pill tap.',
          items: {
            type: 'object',
            properties: {
              handle: { type: 'string', description: 'Product handle from searchProducts/getProductDetails (e.g. "lovense-osci-3"). Required.' },
              variantId: { type: 'string', description: "Optional Shopify variant GID — only pass when the UI supplied one via variant-pill (user message contained 'variantId: gid://...'). Leave empty otherwise." },
              quantity:  { type: 'number', description: 'Integer quantity, 1–5. Defaults to 1.' },
            },
            required: ['handle'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'buildCheckoutLink',
    description:
      "SMS-only. Build a Shopify checkout URL the shopper can tap to pay. Pass the product HANDLE (e.g. 'lovense-osci-3') from your latest searchProducts/getProductDetails/findCollection result — the server resolves the live in-stock variant from the handle. Do NOT pass variantIds; do NOT invent or guess product handles; if you don't have a handle yet, call searchProducts first. Returns data.url — paste that exact URL verbatim into your reply.",
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Line items, keyed by product handle. Max 5 items.',
          items: {
            type: 'object',
            properties: {
              handle:   { type: 'string', description: "Product handle from searchProducts/getProductDetails (e.g. 'lovense-osci-3'). Required." },
              quantity: { type: 'number', description: 'Integer quantity, 1–5. Defaults to 1.' },
            },
            required: ['handle'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
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

/**
 * Per-reason framing hint attached to a search/discover tool result so the model
 * can tell "loosen your filters" from "the catalog is down" and respond with
 * agency or an honest outage apology instead of a bare "no results". These are
 * guidance FOR Emma (patterns, not verbatim copy); the example phrasings passed
 * the emma-empathy-reviewer voice gate (ticket #1268). Returns undefined when
 * results matched, so a normal result carries no extra instruction.
 */
export function searchReasonGuidance(reason: SearchDiagnostics['reason']): string | undefined {
  switch (reason) {
    case 'matched':
      return undefined
    case 'filtered-to-zero':
      return 'Nothing matched every filter at once. Do not dead-end: offer to relax one, with agency. Pattern: "Want me to loosen the price cap or drop one of the features and look again?"'
    case 'no-base-results':
      return 'The catalog itself has nothing for this search, not just the filters, so do not blame filters. Ask for a different angle and search again. Pattern: "I do not have anything close to that in the catalog right now. What feeling are you hoping for, or how were you planning to use it?"'
    case 'sanity-unavailable':
    case 'catalog-unavailable':
      return 'Search is degraded right now, not empty. Be honest and warm and do not invent products. Pattern: "My catalog is being slow right now. Give me a few minutes and try again, sorry for the wait." Then offer to help another way.'
  }
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
      const productTypeDial = input['productTypeDial'] ? String(input['productTypeDial']).trim() : undefined
      const productSubtypeDial = input['productSubtypeDial'] ? String(input['productSubtypeDial']).trim() : undefined
      const mattersTags = Array.isArray(input['mattersTags'])
        ? (input['mattersTags'] as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : undefined
      const { cards, reason } = await searchForIvrWithDiagnostics({
        query,
        limit,
        category,
        priceMax,
        productTypeDial,
        ...(productTypeDial && productSubtypeDial ? { productSubtypeDial } : {}),
        ...(mattersTags && mattersTags.length > 0 ? { mattersTags } : {}),
      })
      const guidance = searchReasonGuidance(reason)
      return { ok: true, data: { query, results: cards, reason, ...(guidance ? { guidance } : {}) } }
    }

    if (name === 'discoverProducts') {
      const mood = Array.isArray(input['mood']) ? input['mood'] as string[] : undefined
      const experience = input['experience'] ? String(input['experience']) : undefined
      const useCase = Array.isArray(input['useCase']) ? input['useCase'] as string[] : undefined
      const features = Array.isArray(input['features']) ? input['features'] as string[] : undefined
      const category = input['category'] ? String(input['category']) : undefined
      const priceMax = input['priceMax'] != null ? Number(input['priceMax']) : undefined
      const limit = Math.max(1, Math.min(5, Number(input['limit'] ?? 3)))
      const { cards, reason } = await discoverForIvrWithDiagnostics({ mood, experience, useCase, features, category, priceMax, limit })
      const guidance = searchReasonGuidance(reason)
      return { ok: true, data: { results: cards, reason, ...(guidance ? { guidance } : {}) } }
    }

    if (name === 'recommendSimilar') {
      const handle = String(input['handle'] ?? '').trim()
      if (!handle) return { ok: false, error: 'handle required' }
      const limit = Math.max(1, Math.min(3, Number(input['limit'] ?? 2)))
      const handles = await getSimilarByTag(handle, limit)
      if (handles.length === 0) return { ok: true, data: { results: [] } }
      const cards = await getIvrCardsByHandles(handles)
      return { ok: true, data: { forHandle: handle, results: cards } }
    }

    if (name === 'getProductDetails') {
      const handle = String(input['handle'] ?? '').trim()
      if (!handle) return { ok: false, error: 'handle required' }
      const detail = await getProductDetailForEmma(handle)
      if (!detail) return { ok: false, error: 'not_found' }
      // Build a compact card from the base product for pricing/variant GIDs,
      // then layer on the enriched fields (feature bullets, sensation dial,
      // and per-variant originalDescription for size/material/fit questions).
      const product = await getProductByHandle(handle)
      const card = product ? productToCard(product) : undefined
      return {
        ok: true,
        data: {
          ...(card ?? {}),
          title: detail.title,
          handle: detail.handle,
          tagline: detail.tagline ?? '',
          fullStory: detail.fullStory ?? '',
          featureBullets: detail.featureBullets ?? [],
          sensationDial: detail.sensationDial,
          // variantDetails includes per-variant originalDescription (raw
          // manufacturer spec text — use for size, dimension, color, material,
          // and fit answers; translate into Emma voice, do not quote verbatim).
          variantDetails: detail.variants.map((v) => ({
            variantId: v.id,
            label: v.title,
            priceUsd: v.priceUsd,
            available: v.available,
            ...(v.originalDescription ? { originalDescription: v.originalDescription } : {}),
          })),
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

    if (name === 'findCollection') {
      const query = String(input['query'] ?? '').trim()
      if (!query) return { ok: false, error: 'empty query' }
      const limit = Math.max(1, Math.min(3, Number(input['limit'] ?? 2)))
      const previewCount = Math.max(1, Math.min(4, Number(input['previewCount'] ?? 3)))
      const matches = await findCollectionsByQuery(query, limit)
      if (matches.length === 0) return { ok: true, data: { query, collections: [] } }
      const results = await Promise.all(
        matches.map(async (m) => {
          const products = await getCollectionProducts(m.handle, previewCount)
          return {
            handle: m.handle,
            title: m.title,
            url: `/collections/${m.handle}`,
            preview: products.map(productToCard),
          }
        }),
      )
      return { ok: true, data: { query, collections: results } }
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

    if (name === 'askQuickChoice') {
      if (ctx.channel !== 'chat') {
        return { ok: false, error: 'unsupported_channel', message: 'Quick choices only work in web chat.' }
      }
      const question = typeof input['question'] === 'string' ? input['question'].slice(0, 140).trim() : ''
      const rawOpts = Array.isArray(input['options']) ? input['options'] as unknown[] : []
      const options = rawOpts
        .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        .map((o) => o.slice(0, 40).trim())
        .slice(0, 6)
      const mode = input['mode'] === 'multi' ? 'multi' : 'single'
      if (!question || options.length < 2) {
        return { ok: false, error: 'bad_input', message: 'Provide a question and at least 2 options.' }
      }
      return { ok: true, data: { question, options, mode, rendered: true } }
    }

    if (name === 'addItemsToCart') {
      if (ctx.channel !== 'chat') {
        return { ok: false, error: 'unsupported_channel', message: 'addItemsToCart is web-chat-only; use buildCheckoutLink on SMS or createDraftOrder on phone.' }
      }
      const rawItems = Array.isArray(input['items']) ? (input['items'] as Array<Record<string, unknown>>) : []
      if (rawItems.length === 0) return { ok: false, error: 'no_items' }
      if (rawItems.length > MAX_ITEMS_PER_ORDER) {
        return { ok: false, error: 'too_many_items', message: `Max ${MAX_ITEMS_PER_ORDER} line items.` }
      }
      // Resolve each line's variant server-side. Haiku has been observed to
      // hallucinate variant GIDs, so we treat its variantId as a hint — the
      // handle is the source of truth. We fetch live product data, prefer
      // Haiku's variantId only if it matches a real variant, otherwise fall
      // back to the first in-stock variant (or first variant if nothing is
      // in stock).
      const lines: { variantId: string; quantity: number }[] = []
      for (const it of rawItems) {
        const handle = String(it['handle'] ?? '').trim()
        const hintedGidRaw = String(it['variantId'] ?? '').trim()
        const hintedGid = hintedGidRaw
          ? (hintedGidRaw.startsWith('gid://')
              ? hintedGidRaw
              : `gid://shopify/ProductVariant/${hintedGidRaw.match(/(\d+)$/)?.[1] ?? ''}`)
          : ''
        const qtyRaw = Number(it['quantity'] ?? 1)
        const qty = Number.isFinite(qtyRaw) ? Math.max(1, Math.min(5, Math.floor(qtyRaw))) : 1

        if (!handle) {
          return { ok: false, error: 'missing_handle', message: 'Each item needs a product handle.' }
        }

        const product = await getProductByHandle(handle)
        if (!product || product.variants.length === 0) {
          return { ok: false, error: 'product_not_found', message: `No variants found for handle "${handle}". Re-run searchProducts.` }
        }

        const match = hintedGid ? product.variants.find((v) => v.id === hintedGid) : undefined
        const fallback = product.variants.find((v) => v.availableForSale) ?? product.variants[0]
        const chosen = match ?? fallback
        if (!chosen?.id || !/gid:\/\/shopify\/ProductVariant\/\d+/.test(chosen.id)) {
          return { ok: false, error: 'variant_unavailable', message: `Couldn't resolve a variant for "${handle}".` }
        }
        if (hintedGid && !match) {
          console.warn('[addItemsToCart] ignored hallucinated variantId', { handle, hintedGid, resolved: chosen.id })
        }
        lines.push({ variantId: chosen.id, quantity: qty })
      }
      // Try the existing cart first (when the shopper already has one). If Shopify
      // has expired or deleted it — common with stale cookies or after the dev DB
      // refresh — we fall through and mint a fresh cart with the lines in one shot.
      let cart
      const existingCartId = ctx.cartId ?? null
      if (existingCartId) {
        try {
          cart = await addLinesToCart(existingCartId, lines)
        } catch (err) {
          console.warn('[addItemsToCart] existing cart failed, minting a new one', err)
        }
      }
      if (!cart) {
        try {
          cart = await createCartWithLines(lines)
          ctx.onCartCreated?.(cart.id)
        } catch (err) {
          console.error('[addItemsToCart] createCartWithLines failed', err)
          return { ok: false, error: 'cart_add_failed', message: "Couldn't add those to the cart — please try again." }
        }
      }
      ctx.onCartMutated?.()
      return {
        ok: true,
        data: {
          cartId: cart.id,
          totalQuantity: cart.totalQuantity,
          addedCount: lines.length,
        },
      }
    }

    if (name === 'buildCheckoutLink') {
      // Web chat should ALWAYS use addItemsToCart. Keep buildCheckoutLink for SMS only.
      if (ctx.channel === 'chat') {
        return { ok: false, error: 'use_add_items_to_cart', message: 'On web chat, call addItemsToCart instead. Never share checkout URLs in chat.' }
      }
      if (ctx.channel !== 'sms') {
        return { ok: false, error: 'unsupported_channel', message: 'buildCheckoutLink is SMS-only.' }
      }
      const rawItems = Array.isArray(input['items']) ? (input['items'] as Array<Record<string, unknown>>) : []
      if (rawItems.length === 0) return { ok: false, error: 'no_items' }
      if (rawItems.length > MAX_ITEMS_PER_ORDER) {
        return { ok: false, error: 'too_many_items', message: `Max ${MAX_ITEMS_PER_ORDER} line items.` }
      }
      // Resolve each line's variant server-side from the handle. Same defense
      // as addItemsToCart: Haiku has been observed hallucinating variant GIDs,
      // so we only trust handles. Fetch live product data and pick the first
      // in-stock variant (or the first variant if nothing is in stock).
      const lines: { variantId: string; quantity: number }[] = []
      for (const it of rawItems) {
        const handle = String(it['handle'] ?? '').trim()
        if (!handle) {
          return { ok: false, error: 'missing_handle', message: 'Each item needs a product handle. Re-run searchProducts to get one.' }
        }
        const qtyRaw = Number(it['quantity'] ?? 1)
        const qty = Number.isFinite(qtyRaw) ? Math.max(1, Math.min(5, Math.floor(qtyRaw))) : 1

        const product = await getProductByHandle(handle)
        if (!product || product.variants.length === 0) {
          return { ok: false, error: 'product_not_found', message: `No variants found for handle "${handle}". Re-run searchProducts with a different query.` }
        }
        const chosen = product.variants.find((v) => v.availableForSale) ?? product.variants[0]
        if (!chosen?.id || !/gid:\/\/shopify\/ProductVariant\/\d+/.test(chosen.id)) {
          return { ok: false, error: 'variant_unavailable', message: `Couldn't resolve a variant for "${handle}".` }
        }
        lines.push({ variantId: chosen.id, quantity: qty })
      }
      try {
        const cart = await createCartWithLines(lines)
        return { ok: true, data: { url: cart.checkoutUrl, itemCount: lines.length } }
      } catch (err) {
        console.error('[buildCheckoutLink] cartCreate failed', err)
        return { ok: false, error: 'cart_create_failed', message: 'Couldn\'t build a checkout link — please try again.' }
      }
    }

    if (name === 'createDraftOrder') {
      // Voice (IVR) only — that's where the agent collects the address verbally
      // because the caller can't tap a link mid-call. On SMS, use buildCheckoutLink
      // (Shopify hosted checkout collects address at payment time). On web chat,
      // use addItemsToCart.
      if (ctx.channel !== 'voice') {
        return { ok: false, error: 'unsupported_channel', message: 'createDraftOrder is voice-channel-only. On SMS, call buildCheckoutLink with the variantId — Shopify checkout collects email/address at payment time. On web chat, call addItemsToCart.' }
      }
      if (!ctx.phone) return { ok: false, error: 'no_caller_phone' }
      const items = Array.isArray(input['items']) ? (input['items'] as Array<Record<string, unknown>>) : []
      if (items.length === 0) return { ok: false, error: 'no_items' }
      if (items.length > MAX_ITEMS_PER_ORDER) {
        return { ok: false, error: 'too_many_items', message: `Max ${MAX_ITEMS_PER_ORDER} line items.` }
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
      const customMessageRaw = typeof input['customMessage'] === 'string' ? input['customMessage'].trim() : ''
      const customMessage = customMessageRaw ? customMessageRaw.slice(0, 500) : undefined
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
          ...(customMessage ? { note: customMessage } : {}),
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
        await sendDraftOrderInvoice(draft.id, {
          to: email,
          ...(customMessage ? { customMessage } : {}),
        })
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

// ─── Phase 6c — Knowledge-base lookup tool (additive) ─────────────────────
// kbLookup is wired into DISCOVERY, RESEARCH, PRESENTATION, OBJECTION, and
// POST_PURCHASE stages. Additive — existing QA_TOOL_DEFINITIONS untouched.

export const KB_LOOKUP_TOOL_DEFINITION: Anthropic.Tool = {
  name: 'kbLookup',
  description:
    'Look up xdipx knowledge-base content: shipping policy, returns policy, product-type compatibility rules, troubleshooting guides, or brand FAQ entries. Use when the shopper asks about policies, compatibility ("can I use silicone lube with a silicone toy?"), device issues, or discreet shipping / billing descriptor questions. Returns a short plain-text answer (≤280 chars) suitable for SMS or IVR, plus an optional longer excerpt for web chat.',
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: ['shipping', 'returns', 'compatibility', 'troubleshooting', 'brand'],
        description: "Which knowledge-base topic to look up. 'shipping' = shipping policy. 'returns' = returns policy. 'compatibility' = product-type compatibility matrix. 'troubleshooting' = device troubleshooting guides. 'brand' = brand FAQ (billing descriptor, discreet packaging, etc.).",
      },
      query: {
        type: 'string',
        description: "Free-text from the shopper's message used to find the best match. Required for 'troubleshooting' and 'brand'. Optional for other topics.",
      },
      productCategory: {
        type: 'string',
        description: "Product type to narrow compatibility or troubleshooting results. e.g. 'silicone-toy', 'air-pulsation', 'vibrator'. Leave empty for general lookups.",
      },
    },
    required: ['topic'],
    additionalProperties: false,
  },
}

export { kbLookup } from '~/lib/sms-v2/tools/kb-lookup.server'
