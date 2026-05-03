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
          description: "Optional product-type filter — one of 'vibrator', 'lube', 'plug', 'wand', 'dildo', 'wear', 'anal'. Maps to the productTypeDial in the catalog. Only set this when you're sure of the category — passing the wrong one filters out everything.",
        },
        matters: {
          type: 'array',
          items: { type: 'string' },
          description: "Optional preference tags such as 'quiet', 'beginner-friendly', 'waterproof', 'travel-ready'. Pass through what the customer actually said — don't invent tags they didn't mention.",
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
}

export interface DiscoveryToolResult {
  ok: boolean
  data?: unknown
  error?: string
  message?: string
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

      const opts: Parameters<typeof searchForIvrWithDiagnostics>[0] = {
        query,
        limit: 3,
        ...(audienceToCategory(audienceRaw) !== undefined && { category: audienceToCategory(audienceRaw) }),
        ...(categoryRaw && categoryRaw.length > 0 && { productTypeDial: categoryRaw }),
        ...(mattersRaw && mattersRaw.length > 0 && { tags: mattersRaw }),
        ...(priceMax !== undefined && { priceMax }),
      }

      const diag = await searchForIvrWithDiagnostics(opts)
      const top = diag.cards.slice(0, 3)

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
