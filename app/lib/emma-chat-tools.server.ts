import type Anthropic from '@anthropic-ai/sdk'
import {
  searchCatalogForEmma,
  getProductDetailForEmma,
  type EmmaProductCard,
  type EmmaProductDetail,
} from './shopify.server'

export const EMMA_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the live xdipx.com catalog. Use this BEFORE naming any xdipx product so you ' +
      'never invent SKUs. Returns up to 20 compact product cards with handle, title, ' +
      'price, available, map_restricted. Detailed taxonomy (audience_tags, mood_tags, ' +
      'matters_tags, product_type_dial, sensation_dial) lives on get_product_details — ' +
      'this endpoint is light. PRIMARY LEVER is `keyword` (matches the product title); ' +
      '`tags` and price filters are refinements.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            'Title keyword (substring match). Best lever for "find me X" queries. ' +
            'Examples: "wand", "bullet", "vibrator", "kegel", "couples ring", "lube".',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Shopify tags to AND-filter on. Common: for-him, for-her, couples, beginner, ' +
            'advanced, waterproof, app-controlled, body-safe-silicone. Use sparingly — ' +
            'tag coverage is uneven across the catalog.',
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
      'accessories, all variants and prices. Use this AFTER search_products when the ' +
      'user wants depth on a specific pick or you need to compare against a competitor.',
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
      const params: Parameters<typeof searchCatalogForEmma>[0] = { limit: 12 }
      if (typeof input['keyword']   === 'string') params.keyword  = input['keyword']
      if (Array.isArray(input['tags']))            params.tags     = input['tags'] as string[]
      if (typeof input['price_min'] === 'number') params.priceMin = input['price_min']
      if (typeof input['price_max'] === 'number') params.priceMax = input['price_max']
      if (typeof input['limit']     === 'number') params.limit    = input['limit']
      const cards: EmmaProductCard[] = await searchCatalogForEmma(params)
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
