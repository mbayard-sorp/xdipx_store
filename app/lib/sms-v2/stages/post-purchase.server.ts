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
 * Tools:
 *   - lookupReturningCustomer (via orderStatusLookup internal resolution)
 *   - orderStatusLookup
 *   - kbLookup — returns/care/troubleshooting facts, offered to the LLM as a
 *     single bounded hop (see generatePostPurchaseProse). Never searchForIvr:
 *     this stage never pitches another product.
 */

import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { getTurnSignal } from '../turn-deadline.server'
import { resolveTransition } from '../transitions.server'
import { orderStatusLookup, OrderNotFoundError, type OrderStatus } from '../tools/order-status.server'
import { kbLookup, type KbTopic } from '../tools/kb-lookup.server'
import { GENERIC_POST_PURCHASE_FALLBACK } from '../templates/post-purchase-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'
import { SONNET } from '../../models.server'

// ─── Constants ─────────────────────────────────────────────────────────────

const MODEL = SONNET
const MAX_TOKENS = 220

// Patterns that indicate the LLM is trying to sell something
// ($ price, /products/ or /collections/ URL, or a handle-shaped slug)
const SALES_ATTEMPT_PATTERN = /(\$\d|\/products\/[a-z0-9-]+|\/collections\/[a-z0-9-]+)/i

// ─── Tool definitions ────────────────────────────────────────────────────────

// NOTE: lookupReturningCustomer / orderStatusLookup are not wired into the
// tool registry — POST_PURCHASE calls them directly in TypeScript before the
// LLM runs (Step 1 below). kbLookup is the one tool actually offered to the
// LLM, for returns/care/troubleshooting questions it can't answer from the
// order context alone.

const KB_LOOKUP_TOOL: Anthropic.Tool = {
  name: 'kbLookup',
  description:
    "Answer a returns/refund, care/cleaning, or troubleshooting question from xdipx's knowledge base. Use this for 'how do I clean it', 'it stopped charging', 'can I return it' and similar post-purchase questions so the answer cites real KB content instead of guessing. Never use this to look up a different product to sell.",
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: ['shipping', 'returns', 'compatibility', 'troubleshooting', 'brand'],
        description: "Which knowledge-base area the question falls under. 'returns' covers refunds. 'brand' is the catch-all for general policy/FAQ.",
      },
      query: {
        type: 'string',
        description: "The customer's question in their own words. Used to rank within the topic.",
      },
      productCategory: {
        type: 'string',
        description: "Optional product category to scope compatibility/troubleshooting answers (e.g. 'vibrator', 'lube').",
      },
    },
    required: ['topic'],
    additionalProperties: false,
  },
}

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
}): Promise<{
  text: string
  inputTokens: number
  outputTokens: number
  toolCalls: StageResponse['telemetry']['toolCalls']
}> {
  const systemBlocks = await buildEmmaSystemBlocks()

  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map((b) => ({
    type:   'text' as const,
    text:   b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  const goal =
    'The customer owns the product. Solve their problem. NEVER pitch another product, ' +
    'NEVER suggest accessories, NEVER use "while I have you". ' +
    'If a returns, care, or troubleshooting question needs a real policy answer, call kbLookup once before replying. ' +
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
    customerText: opts.customerText,
  }

  let inputTokens  = 0
  let outputTokens = 0
  let text = ''
  const toolCalls: StageResponse['telemetry']['toolCalls'] = []

  // One bounded hop: the model may call kbLookup once for a returns/care/
  // troubleshooting fact, then must answer in text. Never offers a product
  // search tool — this stage never pitches.
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: JSON.stringify(userPayload, null, 2) },
  ]
  const MAX_HOPS = 1
  let hops = 0

  while (hops <= MAX_HOPS) {
    const msg = await _anthropicClient.messages.create({
      model:       MODEL,
      max_tokens:  MAX_TOKENS,
      system:      systemParam,
      tools:       [KB_LOOKUP_TOOL],
      tool_choice: hops < MAX_HOPS ? { type: 'auto' } : { type: 'none' },
      messages,
    }, { signal: getTurnSignal() })

    const usage = msg.usage as typeof msg.usage & {
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    inputTokens  += usage.input_tokens
    outputTokens += usage.output_tokens

    // B3.5 — best-effort token log
    void import('../../token-log.server').then(({ logApiTokens }) =>
      logApiTokens({
        feature: 'sms', model: MODEL, source: 'sync', caller: 'sms/post-purchase',
        inputTokens:         usage.input_tokens,
        outputTokens:        usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens:     usage.cache_read_input_tokens     ?? 0,
      })
    ).catch((err) => console.error('[sms/post-purchase] token-log failed (ignored):', err))

    if (msg.stop_reason === 'tool_use') {
      const toolUseBlocks = msg.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const tb of toolUseBlocks) {
        let toolResult: unknown
        let toolOk = true
        let toolError: string | undefined

        try {
          if (tb.name === 'kbLookup') {
            const inp = tb.input as { topic: KbTopic; query?: string; productCategory?: string }
            const kb = await kbLookup({
              topic:           inp.topic,
              ...(inp.query ? { query: inp.query } : {}),
              ...(inp.productCategory ? { productCategory: inp.productCategory } : {}),
            })
            toolResult = kb
              ? { quickAnswer: kb.quickAnswer, sourceTitle: kb.sourceTitle, ...(kb.bodyExcerpt ? { bodyExcerpt: kb.bodyExcerpt } : {}) }
              : { error: 'not_found', message: `No knowledge-base entry matched ${inp.topic}.` }
          } else {
            toolResult = { error: `Unknown tool: ${tb.name}` }
            toolOk    = false
            toolError = `Unknown tool: ${tb.name}`
          }
        } catch (err) {
          toolOk    = false
          toolError = err instanceof Error ? err.message : String(err)
          toolResult = { error: toolError }
        }

        toolCalls.push({ name: tb.name, input: tb.input, ok: toolOk, error: toolError })
        toolResults.push({
          type:        'tool_result',
          tool_use_id: tb.id,
          content:     JSON.stringify(toolResult),
        })
      }

      messages = [
        ...messages,
        { role: 'assistant', content: msg.content },
        { role: 'user',      content: toolResults },
      ]
      hops++
      continue
    }

    const block = msg.content[0]
    text = block?.type === 'text' ? block.text.trim() : ''
    break
  }

  return { text, inputTokens, outputTokens, toolCalls }
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
    if (result.toolCalls?.length) toolCalls.push(...result.toolCalls)

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
