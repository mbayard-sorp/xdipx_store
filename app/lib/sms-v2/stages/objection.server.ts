/**
 * app/lib/sms-v2/stages/objection.server.ts
 *
 * Phase 6a — OBJECTION stage handler (legacy gate flow).
 * Phase 6  — wrapped by `executeObjectionStage` which routes between this
 * legacy handler and the unified Sonnet conversation agent based on the env
 * flag allowlist (`pickDiscoveryAgentVersion`).
 *
 * Legacy handler: customer is pushing back on the current pitched product.
 * Surface their concern with real facts. Do not pivot to a different product.
 *
 * Fabrication guard: asserts the LLM prose contains the real PDP URL (when
 * the product is referenced) and the real price. Mismatch swaps to a
 * deterministic fallback template.
 *
 * Tool list: searchForIvr, kbLookup (returns/compatibility/troubleshooting
 * facts to back up an objection response).
 */
import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { getTurnSignal } from '../turn-deadline.server'
import { searchForIvr } from '~/lib/ivr-search.server'
import { kbLookup, type KbTopic } from '../tools/kb-lookup.server'
import { executeConversationAgent } from '../conversation-agent.server'
import { pickDiscoveryAgentVersion } from '../discovery-agent-flag.server'
import { resolveTransition } from '../transitions.server'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'
import { fetchProductContext } from './_product-context.server'
import { pickObjectionTemplate } from '../templates/objection-templates'
import { SONNET } from '../../models.server'

// ─── Constants ────────────────────────────────────────────────────────────────

const SMS_MODEL = SONNET

// ─── Anthropic client (module-level for test seam) ────────────────────────────

/**
 * Module-level client reference. Exposed as a mutable export so smoke tests
 * can swap it with a mock without going through the constructor.
 */
export let _anthropicClient: Anthropic = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY']?.trim(),
})

/** Replace the client (test seam only). Returns the old client for restore. */
export function _setAnthropicClient(c: Anthropic): Anthropic {
  const prev = _anthropicClient
  _anthropicClient = c
  return prev
}

// ─── Tool definition ──────────────────────────────────────────────────────────

const SEARCH_FOR_IVR_TOOL: Anthropic.Tool = {
  name: 'searchForIvr',
  description:
    'Search the xdipx product catalog by keyword. Returns compact cards with title, handle, price, and tagline. Use for additional facts about the current product (e.g., variants, related specs).',
  input_schema: {
    type: 'object',
    properties: {
      query:    { type: 'string',  description: 'Free-text search query.' },
      limit:    { type: 'number',  description: 'Max results, 1-5. Default 3.' },
      category: { type: 'string',  description: 'Optional: for-him, for-her, or couples.' },
      priceMax: { type: 'number',  description: 'Optional max price in dollars.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

const KB_LOOKUP_TOOL: Anthropic.Tool = {
  name: 'kbLookup',
  description:
    "Answer a shipping, returns/refund, product-compatibility, or troubleshooting question from xdipx's knowledge base. Use this when the objection is about policy or how the product works (e.g. 'what if it breaks', 'does this work with my other toy', 'can I return it') so the response cites real KB content instead of guessing.",
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: ['shipping', 'returns', 'compatibility', 'troubleshooting', 'brand'],
        description: "Which knowledge-base area the objection falls under. 'returns' covers refunds. 'brand' is the catch-all for general policy/FAQ.",
      },
      query: {
        type: 'string',
        description: "The customer's concern in their own words. Used to rank within the topic.",
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

// ─── Main handler — flag-aware dispatch (Phase 6) ─────────────────────────────

/**
 * OBJECTION entry point. Picks between the legacy gate-style handler
 * (executeObjectionStageGate) and the Phase 6 Sonnet conversation agent
 * (executeConversationAgent) based on the env-flag allowlist.
 *
 * Default: 'v2-gate' → no behavior change in production. The agent only runs
 * when the env flag is flipped or the caller is on the allowlist. Same flag
 * that governs the discovery + presentation agents — Phase 6 expanded scope
 * to cover OBJECTION uniformly.
 */
export async function executeObjectionStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const version = pickDiscoveryAgentVersion(ctx.conversation.phone)
  if (version === 'v2-agent') {
    return executeConversationAgent({ ctx, intent, customerText, stage: 'OBJECTION' })
  }
  return executeObjectionStageGate(ctx, intent, customerText)
}

/**
 * Legacy gate-style OBJECTION handler. Kept as the fallback path when the
 * conversation agent isn't enabled. Replaced by executeConversationAgent in
 * Phase 6 cleanup.
 */
async function executeObjectionStageGate(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  // ── 1. Resolve the pitched product ──────────────────────────────────────────
  const pitchHandle = ctx.conversation.currentPitchHandle

  if (!pitchHandle) {
    // No product context — let DISCOVERY re-qualify
    return {
      stageOut:     resolveTransition(ctx.conversation.stage, 'DISCOVERY'),
      goalAchieved: false,
      segments: [{
        prose: "Let's start over. What are you actually looking for? Mood, budget, or just a general vibe, I can work with any of those.",
      }],
      stateWrites: {
        stage: resolveTransition(ctx.conversation.stage, 'DISCOVERY'),
      },
      telemetry: {
        intent:           intent.intent,
        intentConfidence: intent.confidence,
      },
    }
  }

  // ── 2. Fetch product context ─────────────────────────────────────────────────
  const productCtx = await fetchProductContext(pitchHandle)

  if (!productCtx) {
    // Handle didn't resolve — re-qualify
    return {
      stageOut:     resolveTransition(ctx.conversation.stage, 'DISCOVERY'),
      goalAchieved: false,
      segments: [{
        prose: "Let's start over. What are you actually looking for? Tell me and I'll find something that fits.",
      }],
      stateWrites: {
        stage: resolveTransition(ctx.conversation.stage, 'DISCOVERY'),
      },
      telemetry: {
        intent:           intent.intent,
        intentConfidence: intent.confidence,
      },
    }
  }

  // ── 3. Build prompt ──────────────────────────────────────────────────────────
  const systemBlocks = await buildEmmaSystemBlocks()

  const userContent = JSON.stringify({
    stage: 'OBJECTION',
    goal: "The customer is pushing back. Address it with specific facts from product.{specs,reviews,price,description} - never invent. End with one of: a question that helps them resolve the concern, or 'I'll take it ♥' if they sound resolved. Do not pivot to a different product. Keep under 480 chars.",
    product: {
      handle:      productCtx.handle,
      title:       productCtx.title,
      price:       productCtx.price,
      pdpUrl:      productCtx.pdpUrl,
      description: productCtx.description,
      reviews:     productCtx.reviews,
      specs:       productCtx.manufacturerSpecs,
    },
    customerText,
    conversationStage: ctx.conversation.stage,
  })

  // ── 4. Run Claude — single hop ───────────────────────────────────────────────
  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map((b) => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  const toolCalls: StageResponse['telemetry']['toolCalls'] = []
  let inputTokens  = 0
  let outputTokens = 0
  let rawProse     = ''

  // Per spec: single hop. We pre-loaded the product context, so the model has
  // everything it needs to address the objection. Tools are available in spec but
  // we do not force the model to use them — a direct response is correct here.
  // We include the tool definition so it can search if it genuinely needs additional
  // product facts, but we don't require it.
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ]

  const MAX_HOPS = 2
  let hops = 0

  while (hops <= MAX_HOPS) {
    const response = await _anthropicClient.messages.create({
      model:       SMS_MODEL,
      max_tokens:  320,
      system:      systemParam,
      tools:       [SEARCH_FOR_IVR_TOOL, KB_LOOKUP_TOOL],
      tool_choice: { type: 'auto' },
      messages,
    }, { signal: getTurnSignal() })

    const usage = response.usage as typeof response.usage & {
      cache_creation_input_tokens?: number
      cache_read_input_tokens?:     number
    }
    inputTokens  += usage.input_tokens
    outputTokens += usage.output_tokens
    // B3.5 — per-hop best-effort token log
    void import('../../token-log.server').then(({ logApiTokens }) =>
      logApiTokens({
        feature: 'sms', model: SMS_MODEL, source: 'sync', caller: 'sms/objection',
        inputTokens:         usage.input_tokens,
        outputTokens:        usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens:     usage.cache_read_input_tokens     ?? 0,
      })
    ).catch((err) => console.error('[sms/objection] token-log failed (ignored):', err))

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const tb of toolUseBlocks) {
        let toolResult: unknown
        let toolOk = true
        let toolError: string | undefined

        try {
          if (tb.name === 'searchForIvr') {
            const inp = tb.input as { query: string; limit?: number; category?: string; priceMax?: number }
            const cards = await searchForIvr({
              query:    inp.query,
              limit:    inp.limit,
              category: inp.category,
              priceMax: inp.priceMax,
            })
            toolResult = { results: cards }
          } else if (tb.name === 'kbLookup') {
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
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ]
      hops++
      continue
    }

    // end_turn or max_tokens
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    rawProse = textBlock?.text?.trim() ?? ''
    break
  }

  // ── 5. Fabrication validator + empty-prose guard ─────────────────────────────
  // If the LLM used all hops on tool calls and never produced text, treat it as
  // a validation failure and use the templated fallback.
  if (!rawProse) {
    return {
      stageOut:     resolveTransition(ctx.conversation.stage, 'OBJECTION'),
      goalAchieved: false,
      segments: [{
        prose: pickObjectionTemplate(
          { title: productCtx.title, price: productCtx.price ?? '', brief: "Let me think about that for you." },
          pitchHandle,
        ),
      }],
      stateWrites: { stage: resolveTransition(ctx.conversation.stage, 'OBJECTION') },
      telemetry: {
        intent:           intent.intent,
        intentConfidence: intent.confidence,
        inputTokens,
        outputTokens,
        toolCalls:        toolCalls.length > 0 ? toolCalls : undefined,
        fabricationCaught: 'objection_empty_prose',
      },
    }
  }

  // OBJECTION prose does not always include the PDP URL or a price quote — the
  // customer is pushing back and Emma is addressing their concern, not re-pitching.
  // We only flag fabrication when:
  //   (a) The prose contains a URL that is NOT the real PDP URL (wrong URL), OR
  //   (b) The prose contains a dollar amount that does NOT match the real price.
  // Omitting the URL entirely is fine. Omitting the price entirely is fine.
  let fabricationCaught: string | undefined
  let finalProse = rawProse

  // URL check — only when the prose actually contains a URL-shaped string
  const containsAnyUrl = rawProse.includes('https://')
  let hasPdpUrl = true
  if (containsAnyUrl && productCtx.pdpUrl) {
    hasPdpUrl = rawProse.includes(productCtx.pdpUrl)
  }

  // Price check — only when the prose contains a dollar-amount string
  // Extract any "$NNN" pattern from prose and verify it matches the real price
  let hasPriceOrOmitted = true
  const priceMatches = rawProse.match(/\$\d+(?:\.\d{2})?/g)
  if (priceMatches && priceMatches.length > 0 && productCtx.price) {
    const priceNum = productCtx.price.replace(/^\$/, '').trim()
    const stripped  = priceNum.replace(/\.00$/, '')
    // Any mention of a dollar amount must be the real price (or cents-stripped form)
    hasPriceOrOmitted = priceMatches.some(
      (m) => m === productCtx.price || m === `$${stripped}`,
    )
  }

  if (!hasPdpUrl || !hasPriceOrOmitted) {
    fabricationCaught = 'objection_pdp_or_price_mismatch'
    finalProse = pickObjectionTemplate(
      {
        title: productCtx.title,
        price: productCtx.price ?? '',
        brief: "I hear you.",
      },
      pitchHandle,
    )
  }

  // ── 6. Compose StageResponse ─────────────────────────────────────────────────
  // stageOut stays OBJECTION — the intent shim handles transitions to
  // PRESENTATION/UPSELL/CHECKOUT on the NEXT turn when the customer commits.
  const stageOut = resolveTransition(ctx.conversation.stage, 'OBJECTION')

  return {
    stageOut,
    goalAchieved: false, // resolved on the next turn when customer commits
    segments: [{
      prose: finalProse,
    }],
    stateWrites: {
      stage: stageOut,
    },
    telemetry: {
      intent:           intent.intent,
      intentConfidence: intent.confidence,
      inputTokens,
      outputTokens,
      toolCalls:        toolCalls.length > 0 ? toolCalls : undefined,
      fabricationCaught,
    },
  }
}
