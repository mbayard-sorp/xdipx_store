/**
 * app/lib/sms-v2/stages/presentation.server.ts
 *
 * Phase 4 — PRESENTATION stage handler (legacy gate flow).
 * Phase 6 — wrapped by `executePresentationStage` which routes between this
 * legacy handler and the unified Sonnet conversation agent based on the env
 * flag allowlist (`pickDiscoveryAgentVersion`).
 *
 * Legacy handler: pitches one specific product. LLM writes the prose; server
 * supplies all facts (price, name, URL, image). Fabrication guard asserts the
 * output contains the real PDP URL and price before delivering.
 *
 * Tool list: searchForIvr only. kbLookup is a Phase 6c forward reference —
 * prompt structure is ready but the tool is not registered here yet.
 */
import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { getTurnSignal } from '../turn-deadline.server'
import { searchForIvr } from '~/lib/ivr-search.server'
import { executeConversationAgent } from '../conversation-agent.server'
import { pickDiscoveryAgentVersion } from '../discovery-agent-flag.server'
import { resolveTransition } from '../transitions.server'
import type { EmmaContext, IntentResult, StageResponse, ProductRef } from '../types.server'
import { fetchProductContext } from './_product-context.server'
import { pickFitCloser, type FitCloserContext } from '../templates/fit-closer-bank'
import { SONNET } from '../../models.server'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

// Sonnet 4.6 model — per spec
const SMS_MODEL = SONNET

// Tool definition for searchForIvr (IVR-tuned search, compact cards).
// kbLookup is listed for future Phase 6c wiring; not registered here.
const SEARCH_FOR_IVR_TOOL: Anthropic.Tool = {
  name: 'searchForIvr',
  description:
    'Search the xdipx product catalog by keyword. Returns compact cards with title, handle, price, and tagline. Use for follow-up questions like "is there a different color?" or "do you have something quieter?"',
  input_schema: {
    type: 'object',
    properties: {
      query:    { type: 'string',  description: 'Free-text search query.' },
      limit:    { type: 'number',  description: 'Max results, 1–5. Default 3.' },
      category: { type: 'string',  description: 'Optional: for-him, for-her, or couples.' },
      priceMax: { type: 'number',  description: 'Optional max price in dollars.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

/** NAME_ITEM regex slot — extracts a product handle mention from the customer text. */
function extractHandleSlot(intent: IntentResult): string | null {
  return intent.slots?.['handle'] ?? intent.slots?.['product'] ?? null
}

// ---------------------------------------------------------------------------
// Main handler — flag-aware dispatch (Phase 6)
// ---------------------------------------------------------------------------

/**
 * PRESENTATION entry point. Picks between the legacy LLM-with-anchored-prompt
 * handler (executePresentationStageGate) and the Phase 6 Sonnet conversation
 * agent (executeConversationAgent) based on the env-flag allowlist.
 *
 * Default: 'v2-gate' → no behavior change in production. The agent only runs
 * when the env flag is flipped or the caller is on the allowlist. Same flag
 * that governs the discovery agent — Phase 6 expanded the agent's scope to
 * cover PRESENTATION + OBJECTION uniformly.
 */
export async function executePresentationStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const version = pickDiscoveryAgentVersion(ctx.conversation.phone)
  if (version === 'v2-agent') {
    return executeConversationAgent({ ctx, intent, customerText, stage: 'PRESENTATION' })
  }
  return executePresentationStageGate(ctx, intent, customerText)
}

/**
 * Legacy gate-style PRESENTATION handler — Sonnet-anchored on
 * currentPitchHandle. Kept as the fallback path when the conversation agent
 * isn't enabled. Replaced by executeConversationAgent in Phase 6 cleanup.
 */
async function executePresentationStageGate(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  // ── 1. Resolve focus handle ──────────────────────────────────────────────
  const slotHandle   = extractHandleSlot(intent)
  const focusHandle  =
    ctx.conversation.currentPitchHandle ||
    slotHandle ||
    ctx.todaysPick?.handle ||
    null

  if (!focusHandle) {
    // No product to pitch — route to DISCOVERY
    return {
      stageOut:     'DISCOVERY',
      goalAchieved: false,
      segments: [{
        prose: "Tell me a little more about what you're after. Mood, vibe, or budget — any of those work.",
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

  // ── 2. Fetch product context ─────────────────────────────────────────────
  const productCtx = await fetchProductContext(focusHandle)

  if (!productCtx) {
    // Handle didn't resolve — fall back to DISCOVERY
    return {
      stageOut:     'DISCOVERY',
      goalAchieved: false,
      segments: [{
        prose: "Hmm, I'm having a moment. Tell me more about what you're looking for and I'll find something good.",
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

  // ── 3. Build prompt for Sonnet ───────────────────────────────────────────
  const systemBlocks = await buildEmmaSystemBlocks()

  // Structured user content block — spec § 3
  const userContent = JSON.stringify({
    stage:             'PRESENTATION',
    goal:              'Pitch this specific product. Be concrete: name, what makes it click, price + PDP URL. End with one CTA: "I\'ll take it ♥" or "Tell me more". Do not invent specs or reviews — only use what\'s in product.reviews or product.description. Keep under 480 chars total.',
    costLastRule:      'HARD CONSTRAINT: the closing sentence of your reply MUST be a fit-confirming question, not a price. Mid-reply price is fine. Never end on a number. BAD: "The Lovense Osci 3 is great, $129 right now, want it?" GOOD: "This is the one I\'d pick for what you described, Lovense Osci 3 (xdipx.com/products/lovense-osci-3). It\'s $129. Does that feel like the one?"',
    product: {
      handle:      productCtx.handle,
      title:       productCtx.title,
      price:       productCtx.price,
      pdpUrl:      productCtx.pdpUrl,
      imageUrl:    productCtx.imageUrl,
      description: productCtx.description,
      reviews:     productCtx.reviews,
      specs:       productCtx.manufacturerSpecs,
    },
    customerText,
    conversationStage: ctx.conversation.stage,
  })

  // ── 4. Run Claude with tool use ──────────────────────────────────────────
  // System param formatted for Anthropic SDK with cache_control
  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map((b) => ({
    type:  'text' as const,
    text:  b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  const toolCalls: StageResponse['telemetry']['toolCalls'] = []
  let inputTokens  = 0
  let outputTokens = 0

  // Initial turn
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ]

  let rawProse = ''
  let hops = 0
  const MAX_HOPS = 2

  while (hops <= MAX_HOPS) {
    const response = await client.messages.create({
      model:      SMS_MODEL,
      max_tokens: 320,
      system:     systemParam,
      tools:      [SEARCH_FOR_IVR_TOOL],
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
        feature: 'sms', model: SMS_MODEL, source: 'sync', caller: 'sms/presentation',
        inputTokens:         usage.input_tokens,
        outputTokens:        usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens:     usage.cache_read_input_tokens     ?? 0,
      })
    ).catch((err) => console.error('[sms/presentation] token-log failed (ignored):', err))

    if (response.stop_reason === 'tool_use') {
      // Process tool calls
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
          } else {
            toolResult = { error: `Unknown tool: ${tb.name}` }
            toolOk = false
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

      // Append assistant turn + tool results and loop
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ]
      hops++
      continue
    }

    // stop_reason === 'end_turn' (or max_tokens)
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    rawProse = textBlock?.text?.trim() ?? ''
    break
  }

  // ── 5. Fabrication validator ─────────────────────────────────────────────
  // Assert the output contains the real PDP URL and the real price.
  // Price check is normalized: $49.99 and $50.00 → LLMs often drop ".00" cents
  // (e.g. "$139" for "$139.00") which is a valid formatting choice, not
  // fabrication. We catch actual price swaps (wrong number) not formatting.
  let fabricationCaught: string | undefined
  let finalProse = rawProse

  const hasPdpUrl = !!(productCtx.pdpUrl && rawProse.includes(productCtx.pdpUrl))

  // Price check: match the canonical form OR the cents-stripped form
  let hasPrice = false
  if (productCtx.price) {
    // Strip currency symbol and normalize
    const priceNum = productCtx.price.replace(/^\$/, '').trim()
    // cents-stripped form: "$139.00" → "$139"
    const stripped = priceNum.replace(/\.00$/, '')
    hasPrice = rawProse.includes(productCtx.price) ||
               rawProse.includes(`$${stripped}`)   ||
               rawProse.includes(stripped)
  } else {
    // No price in context — can't check, treat as OK
    hasPrice = true
  }

  if (!hasPdpUrl || !hasPrice) {
    fabricationCaught = 'pdp_url_or_price_mismatch'
    // Swap in deterministic fallback from the fit-closer bank (8 contextual
    // variants, all cost-last compliant). Context is derived from discovered slots.
    const slots = (ctx.conversation.discoveredSlots ?? {}) as Record<string, unknown>
    const fitCtx = selectFitCloserContext(
      focusHandle,
      ctx.conversation.currentPitchHandle,
      slots,
    )
    const closerFn = pickFitCloser(fitCtx)
    finalProse = closerFn({
      name:   productCtx.title,
      price:  productCtx.price ?? '',
      pdpUrl: productCtx.pdpUrl,
    })
  }

  // ── 6. Compose StageResponse ─────────────────────────────────────────────
  const productCard: ProductRef = {
    handle:   productCtx.handle,
    title:    productCtx.title,
    price:    productCtx.price,
    imageUrl: productCtx.imageUrl,
    pdpUrl:   productCtx.pdpUrl,
  }

  return {
    stageOut:     resolveTransition(ctx.conversation.stage, 'PRESENTATION'),
    goalAchieved: true,
    segments: [{
      prose:       finalProse,
      productCard,
      cta: { kind: 'pdp', url: productCtx.pdpUrl },
    }],
    stateWrites: {
      stage:              resolveTransition(ctx.conversation.stage, 'PRESENTATION'),
      currentPitchHandle: focusHandle,
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

// ---------------------------------------------------------------------------
// FitCloser context selection
// ---------------------------------------------------------------------------

/**
 * Choose a FitCloserContext based on discovered slots and conversation state.
 *
 * Priority order:
 *   1. Single pitched product (handle matches currentPitchHandle) → 'single-strong-match'
 *   2. Budget concern in slots (priceMax set) → 'single-budget-sensitive'
 *   3. First-timer experience → 'first-timer-needs-reassurance'
 *   4. Default → 'single-strong-match'
 */
function selectFitCloserContext(
  focusHandle: string,
  currentPitchHandle: string | null,
  slots: Record<string, unknown>,
): FitCloserContext {
  const hasBudgetConcern = typeof slots['priceMax'] === 'number'
  const isFirstTimer = slots['experience'] === 'first-time'

  if (isFirstTimer) return 'first-timer-needs-reassurance'
  if (hasBudgetConcern) return 'single-budget-sensitive'
  // Named product from NAME_ITEM intent or existing pitch
  if (focusHandle && (currentPitchHandle === focusHandle || currentPitchHandle)) {
    return 'single-strong-match'
  }
  return 'single-strong-match'
}
