import type Anthropic from '@anthropic-ai/sdk'
import {
  getEmmaCardsByHandles,
  getProductDetailForEmma,
  type EmmaProductDetail,
} from './shopify.server'
import { searchForIvrWithDiagnostics } from './ivr-search.server'
import { categoryToDial, audienceToCategory } from './sms-v2/discovery-agent-tools.server'

export const EMMA_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the live xdipx.com catalog. Use this BEFORE naming any xdipx product so you ' +
      'never invent SKUs. Runs the same Sanity-backed search core as the voice and SMS ' +
      'channels (dial + preference-tag filtering, MAP pricing, margin-weighted ranking), so ' +
      'the same query surfaces the same products a customer gets on the phone. Returns up ' +
      'to 20 cards with handle, title, priceUsd, available, mapRestricted, tagline, ' +
      'productTypeDial, and audience/mood/matters tags. Deeper enrichment (full story, ' +
      'sensation_dial, per-variant specs) still lives on get_product_details. PRIMARY LEVER ' +
      'is `keyword` (matches the product title); `category`, `audience`, `matters`, and ' +
      'price bounds are refinements.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            'Title keyword (substring match). Best lever for "find me X" queries. ' +
            'Examples: "wand", "bullet", "vibrator", "kegel", "couples ring", "lube".',
        },
        category: {
          type: 'string',
          description:
            "Optional product-type filter — one of 'vibrator', 'lube', 'plug', 'wand', " +
            "'dildo', 'wear', 'anal'. Mapped to the catalog's productTypeDial (+ subtype " +
            'where needed, e.g. wand, plug). Only set it when you are sure of the type — ' +
            'the wrong one filters everything out.',
        },
        audience: {
          type: 'string',
          enum: ['for-her', 'for-him', 'couples', 'gift'],
          description:
            "Optional audience filter. 'for-her' / 'for-him' / 'couples' restrict to " +
            "products tagged for that audience; 'gift' applies no audience filter.",
        },
        matters: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Optional preference tags such as 'quiet', 'beginner-friendly', 'waterproof', " +
            "'travel-ready'. Matched against each product's enriched mattersTags. Pass " +
            "through what was actually asked for — don't invent tags.",
        },
        price_min: { type: 'number', description: 'USD lower bound (inclusive). Skip if no minimum.' },
        price_max: { type: 'number', description: 'USD upper bound (inclusive). Skip if no maximum.' },
        limit: {
          type: 'integer',
          description: 'How many to return. Default 12, max 20.',
          minimum: 1,
          maximum: 20,
        },
      },
    },
  },
  {
    name: 'get_product_details',
    description:
      'Fetch full enrichment for one product by handle: Emma-voice tagline, full story, ' +
      'feature bullets, sensation_dial ratings (per-dimension 1-5), pairing_why for ' +
      'accessories, all variants and prices. Each variant object includes: id, title, ' +
      'priceUsd, available, and originalDescription (raw manufacturer text for that ' +
      'variant — use for size, dimension, material, and fit questions; do not quote ' +
      'verbatim). Use this AFTER search_products when the user wants depth on a ' +
      'specific pick or you need to compare against a competitor.',
    input_schema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description:
            'Shopify product handle (URL slug, e.g. "satisfyer-pro-2-air-pulse"). ' +
            'Always use a handle returned from search_products.',
        },
      },
      required: ['handle'],
    },
  },
]

export type EmmaToolExecutionResult = {
  content: string
  is_error?: boolean
  /** Diagnostic-only telemetry the orchestrator can persist alongside the tool row. */
  diagnostics?: {
    durationMs: number
    resultCount?: number
    handle?: string
  }
}

/**
 * Execute a single tool by name. Returns a JSON-string `content` payload that
 * gets sent back to Claude as the `tool_result` block. Errors are caught and
 * returned with `is_error: true` so the model can recover (apologize, retry,
 * pivot) rather than the whole stream crashing.
 */
export async function executeEmmaChatTool(
  name: string,
  input: Record<string, unknown>,
): Promise<EmmaToolExecutionResult> {
  const start = Date.now()
  try {
    if (name === 'search_products') {
      const keyword = typeof input['keyword'] === 'string' ? input['keyword'].trim() : ''
      // The shared search core requires a text query; preserve the prior
      // browse default so an argument-less search still returns something
      // rather than erroring on an empty query.
      const query = keyword || 'wellness'
      const limit = Math.min(Math.max(typeof input['limit'] === 'number' ? input['limit'] : 12, 1), 20)
      const priceMax = typeof input['price_max'] === 'number' ? input['price_max'] : undefined
      const priceMin = typeof input['price_min'] === 'number' ? input['price_min'] : undefined
      const category = typeof input['category'] === 'string' ? input['category'] : undefined
      const audience = typeof input['audience'] === 'string' ? input['audience'] : undefined
      const matters = Array.isArray(input['matters'])
        ? (input['matters'] as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : undefined

      // Route through the same core the voice/SMS channels use so web chat and
      // SMS surface the same catalog. categoryToDial / audienceToCategory are
      // the canonical model-facing → productTypeDial/category mappers (they own
      // the dial vocabulary), so this list never drifts out of sync.
      const dial = categoryToDial(category)
      const audienceCategory = audienceToCategory(audience)
      const opts: Parameters<typeof searchForIvrWithDiagnostics>[0] = {
        query,
        limit,
        ...(audienceCategory !== undefined ? { category: audienceCategory } : {}),
        ...(dial ?? {}),
        ...(matters && matters.length > 0 ? { mattersTags: matters } : {}),
        ...(priceMax !== undefined ? { priceMax } : {}),
      }

      const { cards: ivrCards } = await searchForIvrWithDiagnostics(opts)
      // Re-hydrate the ranked handles into display-correct EmmaProductCards so
      // the chat keeps its card shape and avoids the voice card's
      // TTS-normalized title/tagline. The shared core has no price floor, so
      // apply price_min here after hydration.
      const hydrated = await getEmmaCardsByHandles(ivrCards.map((c) => c.handle))
      const cards = priceMin !== undefined ? hydrated.filter((c) => c.priceUsd >= priceMin) : hydrated
      return {
        content: JSON.stringify({ count: cards.length, results: cards }),
        diagnostics: { durationMs: Date.now() - start, resultCount: cards.length },
      }
    }

    if (name === 'get_product_details') {
      const handle = typeof input['handle'] === 'string' ? input['handle'] : null
      if (!handle) {
        return {
          content: JSON.stringify({ error: 'missing_handle' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }
      const detail: EmmaProductDetail | null = await getProductDetailForEmma(handle)
      if (!detail) {
        return {
          content: JSON.stringify({ error: 'not_found', handle }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start, handle },
        }
      }
      return {
        content: JSON.stringify(detail),
        diagnostics: { durationMs: Date.now() - start, handle },
      }
    }

    return {
      content: JSON.stringify({ error: 'unknown_tool', name }),
      is_error: true,
      diagnostics: { durationMs: Date.now() - start },
    }
  } catch (err) {
    return {
      content: JSON.stringify({
        error: 'tool_execution_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
      is_error: true,
      diagnostics: { durationMs: Date.now() - start },
    }
  }
}
