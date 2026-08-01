/**
 * app/lib/sms-v2/discovery-agent-tools.server.ts
 *
 * Tool surface for the Sonnet-driven discovery agent (Phase 2).
 *
 * Three tools — focused on what discovery actually needs:
 *   - searchProducts: catalog lookup, returns top 3 cards.
 *   - lookupReturningCustomer: phone-keyed Shopify customer fetch (voice/sms only).
 *   - getCategoryExplainer: serves the canned per-category explainer copy.
 *
 * The agent stage has three downstream needs that shape this surface:
 *   1. The agent should be able to pitch a specific product, so searchProducts
 *      MUST return something the caller can attach as a productCard segment.
 *   2. The discovery agent never builds a checkout, so no createDraftOrder /
 *      buildCheckoutLink / addItemsToCart here. Those live in later stages.
 *   3. lookupReturningCustomer can't run on web (no phone). We short-circuit
 *      with a structured 'no_caller_phone' error so the model can adapt
 *      rather than crashing the call.
 *
 * Card accumulator: searchProducts maps IvrProductCards into a JSON-friendly
 * shape for the model, but the caller (discovery-agent.server.ts) needs the
 * raw IvrProductCard list so it can attach a productCard to the segment when
 * the agent pitches one. We surface those cards through an optional Map the
 * caller passes in — keyed by tool_use id so multiple search hops in the same
 * turn each leave their cards behind without overwriting each other.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { searchForIvrWithDiagnostics, type IvrProductCard } from '~/lib/ivr-search.server'
import { findCustomerByPhone, getProductByHandle } from '~/lib/shopify.server'
import { getExplainer, type ExplainerCategory } from './templates/category-explainers'

// ─── Tool surface (model-facing definitions) ─────────────────────────────────

export const DISCOVERY_AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'searchProducts',
    description:
      "Search the xdipx catalog for products matching a keyword or short phrase. Use as soon as you have at least one of: a category noun (vibrator, lube, plug, wand, dildo, lingerie), a brand name, or enough vibe signal to commit to a search. Returns up to 3 products with title, handle, price, tagline, in-stock flag, and PDP URL. Always prefer this over guessing about products from memory. NEVER fabricate a product handle — pull it from a tool result here.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "Free-text search query — usually a category noun ('vibrator', 'water-based lube'), a brand ('Lelo'), or a short phrase ('beginner anal kit'). Required.",
        },
        audience: {
          type: 'string',
          enum: ['for-her', 'for-him', 'couples', 'gift'],
          description: "Optional audience filter. 'for-her' / 'for-him' / 'couples' restrict to products tagged for that audience. 'gift' is treated as no audience filter (gifts have no inherent audience).",
        },
        category: {
          type: 'string',
          description: "Optional product-type filter — one of 'vibrator', 'lube', 'plug', 'wand', 'dildo', 'wear', 'anal'. Mapped to the catalog's productTypeDial (+ subtype where needed, e.g. wand, plug). Only set this when you're sure of the category — passing the wrong one filters out everything.",
        },
        matters: {
          type: 'array',
          items: { type: 'string' },
          description: "Optional preference tags such as 'quiet', 'beginner-friendly', 'waterproof', 'travel-ready'. Matched against the product's enriched mattersTags. Pass through what the customer actually said — don't invent tags they didn't mention.",
        },
        priceMax: {
          type: 'number',
          description: 'Optional max price in dollars (e.g. 80). Use only when the customer mentioned a budget.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookupReturningCustomer',
    description:
      "Check whether the caller/texter already has an account on xdipx, so you can greet them by first name and skip re-collecting basics. Uses the caller's phone number automatically — do not ask the user for it, and do not try to pass it. Returns { found: boolean, firstName?, defaultCity?, defaultState?, gid? }. Voice/SMS only — on web chat this returns an error you should ignore (web has no phone).",
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'getCategoryExplainer',
    description:
      "Fetch the canonical Emma-voice explainer for a product category. Use when the customer asks 'what's the difference between X and Y?' or seems unfamiliar with a category. Returns a short SMS-length explainer plus optional voice/chat variants. After the explainer lands, ask which direction sounds right and then call searchProducts.",
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['lube', 'vibrator', 'wand', 'plug', 'dildo', 'wear'],
          description: "Category to explain. 'plug' covers anal plugs / beads / trainers. 'wear' covers lingerie, bodysuits, bodystockings, costumes.",
        },
      },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    name: 'getProductDetails',
    description:
      "Fetch detailed info on a specific product by its handle — variant options (colors/sizes), tagline, description, in-stock flag. Use when the customer asks about variants ('what colors?', 'do you have it in red?', 'what sizes?') or specs of a product you've already mentioned. Pass the handle from a prior tool result; never invent one.",
    input_schema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: "Product handle (e.g. 'lovense-osci-3'). Must come from a prior searchProducts result or ctx.currentPitchHandle.",
        },
      },
      required: ['handle'],
      additionalProperties: false,
    },
  },
]

export type DiscoveryToolName =
  | 'searchProducts'
  | 'lookupReturningCustomer'
  | 'getCategoryExplainer'
  | 'getProductDetails'

export interface DiscoveryAgentToolContext {
  /** Caller phone (E.164) for voice/sms, or `web:<sessionId>` for web chat. */
  phone: string
  channel: 'sms' | 'voice' | 'web'
  /**
   * Optional accumulator the caller passes in. When searchProducts runs we
   * stash the raw IvrProductCard[] under the tool_use id so the caller can
   * later detect when the agent pitched a specific product and attach it as
   * a productCard segment. Pass null when you don't need the cards.
   */
  cardSink?: Map<string, IvrProductCard[]> | null | undefined
  /** The current tool_use.id — used as the key when stashing cards. */
  toolUseId?: string | undefined
  /**
   * ADR-003a Fix 2+3: ordered log of handles pitched in prior turns
   * (most-recent last). Used by:
   *   - isAnalContextAuthorized: if any prior handle is anal-tagged, the
   *     current search is considered anal-context authorized.
   *   - dedup filter: cards whose handle appears here are dropped so the
   *     agent never re-pitches an already-shown product.
   * Undefined or null treated identically: no dedup, no prior-handle auth.
   */
  pitchedHandlesLog?: string[] | null | undefined
}

export interface DiscoveryToolResult {
  ok: boolean
  data?: unknown
  error?: string
  message?: string
}

// ─── ADR-003a: anal-product filter + dedup helpers ───────────────────────────

/**
 * Substrings checked against a card handle (case-insensitive) to decide
 * whether the card represents an anal-targeted product.
 *
 * ADR-003a condition 1: drop 'beads' from this list. Vibrating-bead products
 * often carry 'beads' in their handle but are not anal products. Rely on the
 * category field for anal-bead products that are correctly tagged in Sanity.
 */
const ANAL_HANDLE_SUBSTRINGS = ['anal', 'plug', 'prostate'] as const

/**
 * Returns true when a product card should be treated as anal-targeted.
 *
 * Primary signal: handle substring match (catches handle-tagged products
 * regardless of Sanity tagging hygiene).
 * Secondary signal: category field equals 'anal' or 'plug'.
 *
 * ADR-003a: 'beads' is intentionally excluded from the substring list to
 * avoid false positives on vibrating-bead products.
 */
export function isAnalTagged(card: IvrProductCard): boolean {
  const handle = (card.handle ?? '').toLowerCase()
  for (const sub of ANAL_HANDLE_SUBSTRINGS) {
    if (handle.includes(sub)) return true
  }
  const rawCategory = card.category ?? ''
  const categories = Array.isArray(rawCategory) ? rawCategory : [rawCategory]
  return categories.some((c) => {
    const norm = String(c ?? '').toLowerCase().trim()
    return norm === 'anal' || norm === 'plug'
  })
}

/**
 * Returns true when the current search context justifies returning
 * anal-tagged products to the agent.
 *
 * Three authorization signals (any one is sufficient):
 *  1. The agent's query string contains explicit anal language.
 *  2. A prior pitched handle is itself anal-tagged (user tolerated it).
 *  3. The explicit category input to searchProducts is 'plug' or 'anal'.
 *
 * Default-deny: when all signals are absent, returns false.
 * A false negative (legitimate anal query gets filtered) is recoverable
 * (user re-asks). A false positive (anal product on a general query) is
 * trust-breaking on first contact.
 */
const ANAL_QUERY_TERMS = ['anal', 'plug', 'prostate', 'butt', 'rear', 'backdoor'] as const

export function isAnalContextAuthorized(
  query: string,
  pitchedHandlesLog: string[] | null | undefined,
  category: string | undefined,
): boolean {
  // Signal 1: agent's query contains explicit anal language.
  const q = query.toLowerCase()
  for (const term of ANAL_QUERY_TERMS) {
    if (q.includes(term)) return true
  }

  // Signal 2: a prior pitched handle is anal-tagged. We create a minimal
  // stub card with only handle set so isAnalTagged can run its check.
  if (pitchedHandlesLog && pitchedHandlesLog.length > 0) {
    for (const h of pitchedHandlesLog) {
      const stubCard = { handle: h, category: '', title: '', tagline: '', inStock: false, price: 0, pctOff: 0, phrasing: 'msrp_only' as const, variantId: '' }
      if (isAnalTagged(stubCard)) return true
    }
  }

  // Signal 3: explicit category parameter is anal/plug.
  if (category) {
    const cat = category.toLowerCase().trim()
    if (cat === 'anal' || cat === 'plug') return true
  }

  return false
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Map an audience filter to the IvrSearchOpts.category field.
 * 'gift' has no inherent audience — return undefined so the search is
 * unrestricted on the audience axis.
 */
function audienceToCategory(audience: string | undefined): string | undefined {
  if (!audience) return undefined
  if (audience === 'gift') return undefined
  if (audience === 'for-her' || audience === 'for-him' || audience === 'couples') return audience
  return undefined
}

/**
 * Map the model-facing category vocabulary onto real productTypeDial (+
 * subtype) values. 'wand' and 'plug' are not dial values — a wand is a
 * vibrator subtype and a plug is an anal subtype — so passing them straight
 * through as productTypeDial filters every search to zero.
 */
const CATEGORY_TO_DIAL: Record<string, { productTypeDial: string; productSubtypeDial?: string }> = {
  vibrator: { productTypeDial: 'vibrator' },
  lube: { productTypeDial: 'lube' },
  dildo: { productTypeDial: 'dildo' },
  wear: { productTypeDial: 'wear' },
  anal: { productTypeDial: 'anal' },
  wand: { productTypeDial: 'vibrator', productSubtypeDial: 'wand' },
  plug: { productTypeDial: 'anal', productSubtypeDial: 'plug' },
}

export function categoryToDial(
  category: string | undefined,
): { productTypeDial: string; productSubtypeDial?: string } | undefined {
  if (!category) return undefined
  const key = category.trim().toLowerCase()
  const mapped = CATEGORY_TO_DIAL[key]
  if (mapped) return mapped
  // Unknown value from the model: pass through as a dial only if it is a real
  // dial value; otherwise drop the filter rather than guaranteeing zero results.
  return VALID_DIALS.has(key) ? { productTypeDial: key } : undefined
}

// Full productTypeDial vocabulary — studio/schemas/productPage.js.
const VALID_DIALS = new Set([
  'vibrator', 'dildo', 'anal', 'bondage', 'cock-ring', 'stroker', 'couples',
  'harness', 'extender', 'pump', 'lube', 'massage', 'enhancer', 'wear',
  'condom', 'wellness', 'novelty', 'book-media', 'sex-machine',
])

/**
 * Map an IvrProductCard into the JSON-friendly shape the agent reads. Keep
 * fields tight — the model burns tokens on whatever we hand it.
 */
function cardToAgentResult(card: IvrProductCard): {
  title: string
  handle: string
  price: number
  tagline: string
  in_stock: boolean
  pdpUrl: string
} {
  return {
    title: card.title,
    handle: card.handle,
    price: card.price,
    tagline: card.tagline,
    in_stock: card.inStock,
    pdpUrl: `https://xdipx.com/products/${card.handle}`,
  }
}

// ─── Tool runner ────────────────────────────────────────────────────────────

/**
 * Execute a discovery-stage tool. Errors are caught and returned as
 * { ok: false } so the agent can adapt — we never throw, since a thrown error
 * would crash the surrounding Sonnet loop and end the conversation hard.
 */
export async function runDiscoveryTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DiscoveryAgentToolContext,
): Promise<DiscoveryToolResult> {
  try {
    if (name === 'searchProducts') {
      const query = String(input['query'] ?? '').trim()
      if (!query) {
        return { ok: false, error: 'empty_query', message: 'searchProducts needs a non-empty query.' }
      }
      const audienceRaw = typeof input['audience'] === 'string' ? input['audience'] : undefined
      const categoryRaw = typeof input['category'] === 'string' ? input['category'].trim() : undefined
      const mattersRaw = Array.isArray(input['matters'])
        ? (input['matters'] as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : undefined
      const priceMaxRaw = input['priceMax']
      const priceMax = typeof priceMaxRaw === 'number' && Number.isFinite(priceMaxRaw)
        ? priceMaxRaw
        : undefined

      const dialFilter = categoryToDial(categoryRaw)
      const opts: Parameters<typeof searchForIvrWithDiagnostics>[0] = {
        query,
        limit: 3,
        ...(audienceToCategory(audienceRaw) !== undefined && { category: audienceToCategory(audienceRaw) }),
        ...(dialFilter ?? {}),
        ...(mattersRaw && mattersRaw.length > 0 && { mattersTags: mattersRaw }),
        ...(priceMax !== undefined && { priceMax }),
      }

      const diag = await searchForIvrWithDiagnostics(opts)
      const rawTop = diag.cards.slice(0, 3)

      // ── ADR-003a Fix 2: anal-product filter ─────────────────────────────
      // Filter runs before the dedup so the dedup receives a clean set.
      // Default-deny: unless the context authorizes anal results, drop them.
      const analAuthorized = isAnalContextAuthorized(
        query,
        ctx.pitchedHandlesLog,
        categoryRaw,
      )
      const analFiltered = analAuthorized
        ? rawTop
        : rawTop.filter((card) => !isAnalTagged(card))

      // ── ADR-003a Fix 3: pitched-handle dedup ────────────────────────────
      // Drop any card whose handle was pitched in a prior turn. Applied after
      // the anal filter so the prior-pitch anal-authorization check still
      // considers the full log (the dedup doesn't need to see anal cards to
      // authorize them — isAnalContextAuthorized does that separately).
      const priorHandles = new Set(
        (ctx.pitchedHandlesLog ?? []).map((h) => h.toLowerCase()),
      )
      const deduped = analFiltered.filter(
        (card) => !priorHandles.has(card.handle.toLowerCase()),
      )

      // Broaden-on-exhaustion: all results were previously pitched (dedup
      // emptied the list but anal-filter found real candidates).
      if (deduped.length === 0 && analFiltered.length > 0) {
        // No card stashed in cardSink — nothing to pitch.
        return {
          ok: true,
          data: {
            results: [],
            reason: 'all_results_previously_pitched',
            message:
              'All matching products have already been shown in this conversation. Try a different search angle: broader query, different category, or drop a filter.',
          },
        }
      }

      const top = deduped

      // Stash the raw cards so the caller can pull a productCard for the segment.
      if (ctx.cardSink && ctx.toolUseId) {
        ctx.cardSink.set(ctx.toolUseId, top)
      }

      return {
        ok: true,
        data: {
          results: top.map(cardToAgentResult),
          reason: diag.reason,
        },
      }
    }

    if (name === 'lookupReturningCustomer') {
      // Web chat has no phone — short-circuit with a structured error the model
      // can easily skip past. Don't crash, don't fall back to anything weird.
      if (ctx.phone.startsWith('web:')) {
        return {
          ok: false,
          error: 'no_caller_phone',
          message: 'lookupReturningCustomer is voice/sms-only.',
        }
      }
      if (!ctx.phone) {
        return {
          ok: false,
          error: 'no_caller_phone',
          message: 'lookupReturningCustomer needs a caller phone number.',
        }
      }

      const customer = await findCustomerByPhone(ctx.phone)
      if (!customer) {
        return { ok: true, data: { found: false } }
      }

      const addr = customer.defaultAddress
      const data: {
        found: true
        gid: string
        firstName?: string
        defaultCity?: string
        defaultState?: string
      } = {
        found: true,
        gid: customer.id,
        ...(customer.firstName ? { firstName: customer.firstName } : {}),
        ...(addr?.city ? { defaultCity: addr.city } : {}),
        ...(addr?.province ? { defaultState: addr.province } : {}),
      }
      return { ok: true, data }
    }

    if (name === 'getCategoryExplainer') {
      const raw = String(input['category'] ?? '').trim().toLowerCase()
      const allowed: ExplainerCategory[] = ['lube', 'vibrator', 'wand', 'plug', 'dildo', 'wear']
      if (!allowed.includes(raw as ExplainerCategory)) {
        return { ok: false, error: 'not_found', message: `No explainer for category "${raw}".` }
      }
      const explainer = getExplainer(raw as ExplainerCategory)
      if (!explainer) {
        return { ok: false, error: 'not_found', message: `No explainer for category "${raw}".` }
      }

      // The bank exposes sms + chat. There's no separate voice variant today —
      // sms reads cleanly aloud, so callers can use sms for voice too. We pass
      // both back so the agent can reach for whichever fits its channel.
      return {
        ok: true,
        data: {
          sms: explainer.sms,
          chat: explainer.chat,
        },
      }
    }

    if (name === 'getProductDetails') {
      const handle = String(input['handle'] ?? '').trim()
      if (!handle) {
        return { ok: false, error: 'missing_handle', message: 'getProductDetails needs a non-empty handle.' }
      }
      const product = await getProductByHandle(handle)
      if (!product) {
        return { ok: false, error: 'not_found', message: `No product with handle "${handle}".` }
      }
      // Stash a card in cardSink the same way searchProducts does so
      // detectPitchedCard can recognize follow-up mentions and the fabrication
      // guard's real-handles set picks up this handle on the next pass.
      const variantOptions =
        product.variants.length > 1
          ? product.variants.slice(0, 5).map((v) => ({
              variantId: v.id,
              label: v.title,
              price: Number(v.price),
              inStock: v.availableForSale,
            }))
          : undefined
      const inStock = product.variants.some((v) => v.availableForSale)
      const firstVariantPrice = product.variants[0]?.price
      const price = firstVariantPrice !== undefined ? Number(firstVariantPrice) : Number(product.price ?? 0)
      const ivrCard: IvrProductCard = {
        title: product.title,
        handle: product.handle,
        category: product.category ?? '',
        tagline: product.metaDescription ?? '',
        inStock,
        price,
        pctOff: 0,
        phrasing: 'msrp_only',
        variantId: product.variants[0]?.id ?? '',
        ...(variantOptions !== undefined && { variantOptions }),
      }
      if (ctx.cardSink && ctx.toolUseId) {
        ctx.cardSink.set(ctx.toolUseId, [ivrCard])
      }
      return {
        ok: true,
        data: {
          title: product.title,
          handle: product.handle,
          pdpUrl: `https://xdipx.com/products/${product.handle}`,
          tagline: product.metaDescription ?? '',
          description: (product.metaDescription ?? '').slice(0, 500),
          in_stock: inStock,
          variant_options: variantOptions ?? [],
          price,
        },
      }
    }

    return { ok: false, error: 'unknown_tool', message: `Unknown tool: ${name}` }
  } catch (err) {
    console.error(`[discovery-agent-tools] tool ${name} failed`, err)
    return { ok: false, error: 'tool_failed', message: 'Tool call failed unexpectedly.' }
  }
}
