import type Anthropic from '@anthropic-ai/sdk'
import {
  searchCatalogForEmma,
  getProductDetailForEmma,
  type EmmaProductCard,
  type EmmaProductDetail,
} from './shopify.server'
import type { DiscoveryVocab } from './discovery.server'
import { BUDGET_MIN, BUDGET_MAX } from '~/types/discovery'

// ---------------------------------------------------------------------------
// Admin tool bundle (original two product-knowledge tools)
// ---------------------------------------------------------------------------

export const EMMA_ADMIN_TOOLS: Anthropic.Tool[] = [
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

// ---------------------------------------------------------------------------
// Discovery-specific tool definitions (propose_chips, set_budget)
// ---------------------------------------------------------------------------

const PROPOSE_CHIPS_TOOL: Anthropic.Tool = {
  name: 'propose_chips',
  description:
    'Propose toggling one or more discovery filter chips. The client will surface them ' +
    'as a small inline action card inside your message bubble. The shopper decides ' +
    'whether to apply. Use this to suggest mood, audience, or "what matters" filters ' +
    'that match what the shopper just told you. Only propose chip values from the ' +
    'injected vocabulary list — never invent new values.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: '1 short sentence in Emma voice explaining why you are suggesting these chips.',
      },
      chips: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            group: {
              type: 'string',
              enum: ['mood', 'audience', 'matters'],
            },
            value: { type: 'string' },
            action: {
              type: 'string',
              enum: ['add', 'remove'],
            },
          },
          required: ['group', 'value', 'action'],
        },
        maxItems: 6,
        description: 'Chips to propose. Maximum 6.',
      },
    },
    required: ['reason', 'chips'],
  },
}

const SET_BUDGET_TOOL: Anthropic.Tool = {
  name: 'set_budget',
  description:
    `Propose a budget (in USD) for the shopper's discovery session. ` +
    `Accepted range: ${BUDGET_MIN}–${BUDGET_MAX}. ` +
    'Use this when the shopper mentions a price range or says something like "under $50" or "splurge".',
  input_schema: {
    type: 'object',
    properties: {
      budget: {
        type: 'number',
        description: `Budget in USD. Clamped to ${BUDGET_MIN}–${BUDGET_MAX}.`,
        minimum: BUDGET_MIN,
        maximum: BUDGET_MAX,
      },
    },
    required: ['budget'],
  },
}

// ---------------------------------------------------------------------------
// Tool bundles
// ---------------------------------------------------------------------------

/**
 * Admin chat bundle: the original two product-knowledge tools.
 * Alias kept so `emma-chat.server.ts` imports still work.
 */
export const EMMA_CHAT_TOOLS = EMMA_ADMIN_TOOLS

/**
 * Discovery chat bundle: product-knowledge tools + chip-proposal tools.
 */
export const EMMA_DISCOVERY_TOOLS: Anthropic.Tool[] = [
  ...EMMA_ADMIN_TOOLS,
  PROPOSE_CHIPS_TOOL,
  SET_BUDGET_TOOL,
]

// ---------------------------------------------------------------------------
// Execution result type
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Chip proposal validation
// ---------------------------------------------------------------------------

export interface ValidatedChip {
  group: 'mood' | 'audience' | 'matters'
  value: string
  action: 'add' | 'remove'
}

/**
 * Validate a propose_chips input against the live vocabulary.
 * Returns accepted chips only; rejects any chip whose value is not in the vocab.
 * Pure — no side effects.
 */
export function validateProposeChips(
  input: Record<string, unknown>,
  vocab: DiscoveryVocab,
): { ok: true; validated: ValidatedChip[] } | { ok: false; reason: string } {
  const reason = typeof input['reason'] === 'string' ? input['reason'].trim() : ''
  if (!reason) return { ok: false, reason: 'reason is required' }

  const rawChips = Array.isArray(input['chips']) ? input['chips'] : []
  if (rawChips.length === 0) return { ok: false, reason: 'chips array is empty' }
  if (rawChips.length > 6) return { ok: false, reason: 'chips array exceeds max of 6' }

  const vocabMap: Record<string, Set<string>> = {
    mood:     new Set(vocab.moods.map(v => v.toLowerCase())),
    audience: new Set(vocab.audiences.map(v => v.toLowerCase())),
    matters:  new Set(vocab.matters.map(v => v.toLowerCase())),
  }

  const validated: ValidatedChip[] = []
  const rejected: string[] = []

  for (const chip of rawChips) {
    if (!chip || typeof chip !== 'object') {
      rejected.push('non-object chip')
      continue
    }
    const c = chip as Record<string, unknown>
    const group = c['group']
    const value = typeof c['value'] === 'string' ? c['value'].trim() : ''
    const action = c['action']

    if (group !== 'mood' && group !== 'audience' && group !== 'matters') {
      rejected.push(`unknown group "${group}"`)
      continue
    }
    if (action !== 'add' && action !== 'remove') {
      rejected.push(`unknown action "${action}"`)
      continue
    }
    if (!value) {
      rejected.push('empty value')
      continue
    }
    const allowed = vocabMap[group]
    if (!allowed || !allowed.has(value.toLowerCase())) {
      rejected.push(`"${value}" not in ${group} vocabulary`)
      continue
    }
    validated.push({ group, value, action })
  }

  if (validated.length === 0) {
    return { ok: false, reason: `All chips rejected: ${rejected.join('; ')}` }
  }

  return { ok: true, validated }
}

// ---------------------------------------------------------------------------
// executeEmmaChatTool — handles all tool names (admin + discovery)
// Vocab is optional; if omitted, discovery tools return an error (safe default).
// ---------------------------------------------------------------------------

export async function executeEmmaChatTool(
  name: string,
  input: Record<string, unknown>,
  vocab?: DiscoveryVocab,
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

    if (name === 'propose_chips') {
      if (!vocab) {
        return {
          content: JSON.stringify({ error: 'vocab_not_available' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }
      const result = validateProposeChips(input, vocab)
      return {
        content: JSON.stringify(result),
        diagnostics: { durationMs: Date.now() - start },
      }
    }

    if (name === 'set_budget') {
      const raw = input['budget']
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return {
          content: JSON.stringify({ error: 'budget_must_be_number' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }
      const clamped = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.round(raw)))
      return {
        content: JSON.stringify({ ok: true, budget: clamped }),
        diagnostics: { durationMs: Date.now() - start },
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
