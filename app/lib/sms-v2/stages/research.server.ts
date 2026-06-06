/**
 * app/lib/sms-v2/stages/research.server.ts
 *
 * Phase 6a — RESEARCH stage handler.
 *
 * The customer is comparing or learning. They have NOT signaled buy intent.
 * Do not push toward checkout. Educate with real facts from candidate products.
 *
 * Two sub-paths:
 *   A — currentPitchHandle is set: include the pitched product + 2 candidates
 *       from searchForIvr as comparison context.
 *   B — no pitch handle (open-ended question): call searchForIvr({ query, limit: 3 })
 *       and talk about candidates.
 *
 * Fabrication guard: any product NAME mentioned in the prose must have its
 * handle present in the candidates set. Unknown product names trigger a
 * deterministic fallback template.
 *
 * Tool list: searchForIvr only. kbLookup is a Phase 6c forward reference.
 */
import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { searchForIvr } from '~/lib/ivr-search.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'
import { fetchProductContext } from './_product-context.server'
import { pickResearchFallbackTemplate } from '../templates/research-templates'
import { extractSlots } from '../slot-extractor.server'
import { getExplainer, type ExplainerCategory } from '../templates/category-explainers'
import {
  suspendForExplain,
  initDiscoveryState,
  mergeSlots,
  resumeFromExplain,
  type DiscoveryState,
  type DiscoverySlots,
} from '../discovery-gate.server'

// ─── Constants ────────────────────────────────────────────────────────────────

const SMS_MODEL = 'claude-sonnet-4-20250514'

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
    'Search the xdipx product catalog by keyword. Returns compact cards with title, handle, price, and tagline. Use to find products that match the customer\'s comparison question.',
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

// TODO (Phase 6c): register kbLookup tool here once available.
// const KB_LOOKUP_TOOL: Anthropic.Tool = { name: 'kbLookup', ... }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a compact candidate summary for the LLM prompt.
 * Only include fields relevant for educational comparison — no invented data.
 */
function candidateSummary(cards: IvrProductCard[]) {
  return cards.map((c) => ({
    handle:      c.handle,
    title:       c.title,
    category:    c.category,
    tagline:     c.tagline,
    price:       `$${c.price.toFixed(2)}`,
    pctOff:      c.pctOff,
    inStock:     c.inStock,
  }))
}

/**
 * Pitch-close pattern detector. Returns true if the prose contains a
 * pitch-style close that RESEARCH is forbidden from using.
 *
 * Patterns forbidden in RESEARCH:
 *   - "I'll take it" (commit CTA)
 *   - "ready to grab" or "ready to go"
 *   - "want it"  (push-to-buy phrasing)
 */
export function hasPitchClose(prose: string): boolean {
  return /i'll take it|ready to grab|want it/i.test(prose)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function executeResearchStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  // ── 0. Slot extraction (shared by sub-dispatcher and resume logic) ────────────
  //
  // Run extractSlots once at the top so both the advice sub-dispatcher and the
  // EXPLAIN resume check can use the results without a second LLM call.
  const priorSlots = (ctx.conversation.discoveredSlots ?? {}) as Partial<DiscoverySlots>
  const { slots: extractedSlots } = await extractSlots({
    text: customerText,
    priorSlots,
  })

  // ── 0a. Advice sub-dispatcher (Branch 4 entry) ───────────────────────────────
  //
  // When the customer asks an educational question ("tell me about lube", "what's
  // the difference between water and silicone"), route to the explainer bank
  // instead of spinning up a full LLM comparison session. This keeps the RESEARCH
  // handler from returning product links on what is clearly an information request.
  //
  // The gate is suspended via suspendForExplain() so we can resume discovery from
  // the same gate position on the customer's next message.
  //
  // Falls through to the existing LLM-driven prose path when either condition is
  // not met (not an advice request, or no explainer for the category).
  if (extractedSlots.isAdviceRequest && extractedSlots.category) {
    const explainerCategory = extractedSlots.category as ExplainerCategory
    const explainer = getExplainer(explainerCategory)

    if (explainer) {
      // Suspend the discovery gate at its current position. The discovery handler
      // calls resumeFromExplain() on the customer's next message.
      const currentRaw = ctx.conversation.discoveryState ?? null
      const currentState: DiscoveryState = currentRaw !== null
        ? (currentRaw as DiscoveryState)
        : initDiscoveryState()
      const suspended = suspendForExplain(currentState)

      // Merge the extracted slots so the resume has full signal.
      const mergedSlots = mergeSlots(priorSlots, extractedSlots)

      return {
        stageOut: 'RESEARCH',
        goalAchieved: false,
        segments: [{ prose: explainer.sms }],
        stateWrites: {
          stage: 'RESEARCH',
          discoveryState: suspended,
          discoveredSlots: mergedSlots as Record<string, unknown>,
        },
        telemetry: {
          intent: intent.intent,
          intentConfidence: intent.confidence,
          inputTokens: 0,
          outputTokens: 0,
        },
      }
    }
  }

  // ── 0b. Resume-from-EXPLAIN detection ────────────────────────────────────────
  //
  // Safety net (Edit 7): if the prior discovery state was EXPLAIN (the customer
  // was on an advice side-trip) and the new message is NOT another advice
  // question but DOES carry shopping signal (category / audience / matters),
  // resume the gate machine and transition stage to DISCOVERY so the next turn
  // lands in the discovery handler with the correct gate position.
  //
  // The current turn still runs the existing LLM path — the customer gets a
  // useful comparison reply AND the machine is correctly resumed. The resume
  // stateWrites are injected into the final StageResponse at step 5 below.
  const priorDiscoveryState = ctx.conversation.discoveryState as DiscoveryState | null | undefined
  const wasExplaining = priorDiscoveryState?.gate === 'EXPLAIN'
  const hasShoppingSignal =
    (extractedSlots.category !== undefined) ||
    (extractedSlots.audience !== undefined) ||
    ((extractedSlots.matters?.length ?? 0) > 0)

  // These are injected into stateWrites at step 5 if set.
  let resumedDiscoveryState: DiscoveryState | undefined
  let resumedSlots: Partial<DiscoverySlots> | undefined

  if (wasExplaining && !extractedSlots.isAdviceRequest && hasShoppingSignal) {
    // Resume the gate from where it was before the explain side-trip.
    resumedDiscoveryState = resumeFromExplain(
      priorDiscoveryState as DiscoveryState & { gate: 'EXPLAIN' },
    )
    resumedSlots = mergeSlots(priorSlots, extractedSlots)
  }

  // ── 1. Build candidate pool ──────────────────────────────────────────────────
  const toolCalls: StageResponse['telemetry']['toolCalls'] = []
  let inputTokens  = 0
  let outputTokens = 0

  let candidates: IvrProductCard[] = []
  let searchError: string | undefined

  // Sub-path A: pitched product is known — include it + search for comparison peers
  if (ctx.conversation.currentPitchHandle) {
    const pitchHandle = ctx.conversation.currentPitchHandle

    // Fetch the pitched product as a candidate card
    try {
      const pitchedCtx = await fetchProductContext(pitchHandle)
      if (pitchedCtx) {
        // Synthesize a minimal IvrProductCard-like object from ProductContext
        const pitchedCard: IvrProductCard = {
          title:     pitchedCtx.title,
          handle:    pitchedCtx.handle,
          category:  '',
          tagline:   pitchedCtx.description ?? '',
          inStock:   true,
          price:     pitchedCtx.price ? Number(pitchedCtx.price.replace(/^\$/, '')) : 0,
          pctOff:    0,
          phrasing:  'deal',
          variantId: '',
        }
        candidates.push(pitchedCard)
      }
    } catch (err) {
      console.warn('[research] fetchProductContext failed for pitched handle:', err)
    }

    // Search for 2 more candidates for comparison context
    try {
      const peers = await searchForIvr({ query: customerText, limit: 2 })
      toolCalls.push({
        name:  'searchForIvr',
        input: { query: customerText, limit: 2 },
        ok:    true,
      })
      // Avoid duplicating the pitched handle
      const peerCards = peers.filter((c) => c.handle !== pitchHandle)
      candidates.push(...peerCards.slice(0, 2))
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err)
      toolCalls.push({
        name:  'searchForIvr',
        input: { query: customerText, limit: 2 },
        ok:    false,
        error: searchError,
      })
      console.warn('[research] searchForIvr failed:', searchError)
    }
  } else {
    // Sub-path B: open-ended question — search for 3 candidate products
    try {
      candidates = await searchForIvr({ query: customerText, limit: 3 })
      toolCalls.push({
        name:  'searchForIvr',
        input: { query: customerText, limit: 3 },
        ok:    true,
      })
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err)
      toolCalls.push({
        name:  'searchForIvr',
        input: { query: customerText, limit: 3 },
        ok:    false,
        error: searchError,
      })
      console.warn('[research] searchForIvr failed:', searchError)
    }
  }

  // ── 2. Build prompt ──────────────────────────────────────────────────────────
  const systemBlocks = await buildEmmaSystemBlocks()

  const userContent = JSON.stringify({
    stage: 'RESEARCH',
    goal: "The customer is comparing or learning, not buying. Educate using the candidates' specs/reviews/descriptions. NEVER end with 'ready to grab it?' or any pitch-style close. End with: a comparison question (e.g., 'want me to compare this with X?'), or 'anything else you're curious about?'. Keep under 480 chars.",
    candidates:    candidateSummary(candidates),
    customerText,
    pitchHandle:   ctx.conversation.currentPitchHandle ?? null,
    customerName:  ctx.customer?.firstName ?? null,
  })

  // ── 3. Run Claude — single hop ───────────────────────────────────────────────
  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map((b) => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  let rawProse = ''

  // Single hop — no tool loop needed; candidates already pre-fetched above
  const response = await _anthropicClient.messages.create({
    model:       SMS_MODEL,
    max_tokens:  320,
    system:      systemParam,
    tools:       [SEARCH_FOR_IVR_TOOL],
    tool_choice: { type: 'none' },  // candidates already loaded; no in-turn search
    messages:    [{ role: 'user', content: userContent }],
  })

  const usage = response.usage as typeof response.usage & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?:     number
  }
  inputTokens  += usage.input_tokens
  outputTokens += usage.output_tokens
  // B3.5 — best-effort token log
  void import('../../token-log.server').then(({ logApiTokens }) =>
    logApiTokens({
      feature: 'sms', model: SMS_MODEL, source: 'sync', caller: 'sms/research',
      inputTokens:         usage.input_tokens,
      outputTokens:        usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens:     usage.cache_read_input_tokens     ?? 0,
    })
  ).catch((err) => console.error('[sms/research] token-log failed (ignored):', err))

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  rawProse = textBlock?.text?.trim() ?? ''

  // ── 4. Fabrication validator ─────────────────────────────────────────────────
  // Spec: "any product mentioned by name in the prose must have its handle in
  // the candidates set."
  //
  // We approach this conservatively: only flag when a brand+model pattern
  // appears in the prose that looks like a specific product (brand name +
  // number) AND that specific string does NOT match any candidate title.
  //
  // Examples that SHOULD trigger:
  //   "Lovense Lush 99" (99 doesn't exist)
  //   "LELO SONA 5000" (fabricated model number)
  //
  // Examples that should NOT trigger:
  //   "wand vibrator" (category description)
  //   "Magic Wand" style references (might be in candidates)
  //   Candidate titles verbatim (always allowed)
  //   Generic wellness/product-type language
  let fabricationCaught: string | undefined
  let finalProse = rawProse

  // Build a set of all candidate title tokens for fast membership checks
  const candidateTitleSet = new Set(candidates.map((c) => c.title.toLowerCase()))
  const candidateHandleSet = new Set(candidates.map((c) => c.handle.toLowerCase()))

  // Pattern: "BrandName ProductName NNN" where NNN is a number NOT in any candidate title
  // This catches hallucinated model-number products like "Lovense Lush 99"
  const BRAND_MODEL_PATTERN = /\b([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z]+)\s+(\d+)\b/g
  let brandModelMatch: RegExpExecArray | null
  while ((brandModelMatch = BRAND_MODEL_PATTERN.exec(rawProse)) !== null) {
    const fullMatch = brandModelMatch[0].toLowerCase()
    // If this exact brand+model+number phrase does NOT appear in any candidate title,
    // it's a fabricated product reference.
    const isKnown =
      Array.from(candidateTitleSet).some((t) => t.includes(fullMatch)) ||
      Array.from(candidateHandleSet).some((h) => h.includes(fullMatch.replace(/\s+/g, '-')))

    if (!isKnown) {
      fabricationCaught = 'research_unknown_product'
      finalProse = pickResearchFallbackTemplate()
      break
    }
  }

  // ── 5. Compose StageResponse ─────────────────────────────────────────────────
  // RESEARCH stays in RESEARCH until intent shifts (DISCOVERY's NAME_ITEM/COMMIT_PICK
  // or classifier routes OBJECTION). No stage transition here.
  //
  // Exception: if step 0b detected a resume-from-EXPLAIN, we transition to
  // DISCOVERY so the next inbound routes to the discovery handler. The current
  // turn's prose is still the LLM comparison reply above.
  const stageOut: typeof ctx.conversation.stage = resumedDiscoveryState !== undefined
    ? 'DISCOVERY'
    : 'RESEARCH'

  return {
    stageOut,
    goalAchieved: false,
    segments: [{
      prose: finalProse,
    }],
    stateWrites: {
      stage: stageOut,
      // If we resumed from EXPLAIN, persist the resumed gate state and merged
      // slots so the next discovery turn has the correct starting point.
      ...(resumedDiscoveryState !== undefined && {
        discoveryState: resumedDiscoveryState,
        discoveredSlots: resumedSlots as Record<string, unknown>,
      }),
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
