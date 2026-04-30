/**
 * app/lib/sms-v2/stages/post-purchase.server.ts
 *
 * Phase 6b — POST_PURCHASE stage handler.
 *
 * Non-selling stage: the customer already owns the product. Goal is to solve
 * their problem. NEVER pitch another product. NEVER suggest accessories.
 * NEVER use "while I have you."
 *
 * If the LLM output contains dollar signs, PDP URLs, or product handles,
 * the fabrication validator fires and swaps to a safe fallback template.
 *
 * Tools (per tools-by-stage.server.ts):
 *   - lookupReturningCustomer (via orderStatusLookup internal resolution)
 *   - orderStatusLookup
 * NOTE: kbLookup (Phase 6c) is NOT injected here yet — left as a TODO.
 */

import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { resolveTransition } from '../transitions.server'
import { orderStatusLookup, OrderNotFoundError, type OrderStatus } from '../tools/order-status.server'
import { GENERIC_POST_PURCHASE_FALLBACK } from '../templates/post-purchase-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ─── Constants ─────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 220

// Patterns that indicate the LLM is trying to sell something
// ($ price, /products/ or /collections/ URL, or a handle-shaped slug)
const SALES_ATTEMPT_PATTERN = /(\$\d|\/products\/[a-z0-9-]+|\/collections\/[a-z0-9-]+)/i

// ─── Tool definitions ────────────────────────────────────────────────────────

// NOTE: The two SMS-v2 tools (lookupReturningCustomer, orderStatusLookup) are
// not wired into the tool registry here because POST_PURCHASE calls them
// directly in TypeScript rather than delegating to the LLM to invoke them.
// The LLM call is prose-only; tool calls happen before the LLM.

// ─── Anthropic client (module-level, swappable for tests) ────────────────────

export let _anthropicClient: Anthropic = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY']?.trim(),
})

/** Replace the Anthropic client (test seam only). Returns the previous client. */
export function _setAnthropicClient(c: Anthropic): Anthropic {
  const prev = _anthropicClient
  _anthropicClient = c
  return prev
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function generatePostPurchaseProse(opts: {
  customerText: string
  lastOrder: OrderStatus | null
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const systemBlocks = await buildEmmaSystemBlocks()

  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map((b) => ({
    type:   'text' as const,
    text:   b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  const goal =
    'The customer owns the product. Solve their problem. NEVER pitch another product, ' +
    'NEVER suggest accessories, NEVER use "while I have you". ' +
    'If you cannot help, give the support email (hello@xdipx.com) and end. ' +
    'Keep under 480 chars. No em-dashes. No dollar signs. No product URLs.'

  const userPayload = {
    stage:       'POST_PURCHASE',
    goal,
    lastOrder:   opts.lastOrder
      ? {
          orderName:   opts.lastOrder.orderName,
          status:      opts.lastOrder.status,
          carrier:     opts.lastOrder.carrier,
          trackingUrl: opts.lastOrder.trackingUrl,
        }
      : null,
    // TODO Phase 6c: inject kbLookup results here (returns policy, care guide)
    customerText: opts.customerText,
  }

  const msg = await _anthropicClient.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    system:     systemParam,
    messages:   [{ role: 'user', content: JSON.stringify(userPayload, null, 2) }],
  })

  const usage = msg.usage as typeof msg.usage & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }

  const block = msg.content[0]
  const text  = block?.type === 'text' ? block.text.trim() : ''

  return {
    text,
    inputTokens:  usage.input_tokens,
    outputTokens: usage.output_tokens,
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function executePostPurchaseStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const toolCalls: StageResponse['telemetry']['toolCalls'] = []
  let orderResult: OrderStatus | null = null

  // Step 1: Try orderStatusLookup to know what they bought
  try {
    orderResult = await orderStatusLookup({
      phone:       ctx.conversation.phone,
      ...(ctx.customer?.gid != null ? { customerGid: ctx.customer.gid } : {}),
    })
    toolCalls.push({
      name:  'orderStatusLookup',
      input: { phone: ctx.conversation.phone, customerGid: ctx.customer?.gid },
      ok:    true,
    })
  } catch (err) {
    toolCalls.push({
      name:  'orderStatusLookup',
      input: { phone: ctx.conversation.phone, customerGid: ctx.customer?.gid },
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    })
    if (!(err instanceof OrderNotFoundError)) {
      console.error('[sms-v2/post-purchase] orderStatusLookup unexpected error', err)
    }
    // Continue without order context — the LLM can still help with care/cleaning questions
  }

  // Step 2: LLM call for prose
  let prose: string
  let inputTokens  = 0
  let outputTokens = 0
  let fabricationCaught: string | undefined

  try {
    const result = await generatePostPurchaseProse({
      customerText,
      lastOrder: orderResult,
    })
    inputTokens  = result.inputTokens
    outputTokens = result.outputTokens

    // Step 3: Fabrication validator — assert no sales content leaked in
    if (SALES_ATTEMPT_PATTERN.test(result.text)) {
      fabricationCaught = 'post_purchase_sales_attempt'
      prose = GENERIC_POST_PURCHASE_FALLBACK
    } else {
      prose = result.text
    }
  } catch (err) {
    console.error('[sms-v2/post-purchase] LLM call failed', err)
    prose = GENERIC_POST_PURCHASE_FALLBACK
    fabricationCaught = 'post_purchase_llm_error'
  }

  return {
    stageOut:     resolveTransition('POST_PURCHASE', 'POST_PURCHASE'),
    goalAchieved: false,
    segments:     [{ prose }],
    stateWrites:  { stage: 'POST_PURCHASE' },
    telemetry: {
      intent:           intent.intent,
      intentConfidence: intent.confidence,
      inputTokens,
      outputTokens,
      toolCalls,
      ...(fabricationCaught ? { fabricationCaught } : {}),
    },
  }
}
