/**
 * app/lib/sms-v2/stages/discovery.server.ts
 *
 * Phase 5 — DISCOVERY stage handler.
 *
 * Open-ended exploration, qualifying questions, vibe matching.
 * LLM picks among templated SPIN questions; it does NOT free-generate prose.
 *
 * Two paths:
 *   Path A — typical turn: LLM picks a SPIN question id and writes a 1-sentence
 *             acknowledgment. Server renders the prose from the SPIN bank template.
 *   Path B — NAME_ITEM intent: customer explicitly named a product type.
 *             Run searchForIvr, set currentPitchHandle, transition to PRESENTATION.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { searchForIvr } from '~/lib/ivr-search.server'
import { resolveTransition } from '../transitions.server'
import { SPIN_BANK } from '../templates/discovery-spin-bank'
import { executePresentationStage } from './presentation.server'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 200

// ─── Zod schema for structured LLM output ────────────────────────────────────

const LlmPickSchema = z.object({
  acknowledgment: z.string().min(1).max(300),
  spinId: z.string().min(1),
})

type LlmPick = z.infer<typeof LlmPickSchema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Module-level client reference. Exposed as a mutable export so smoke tests
 * can swap it with a mock without going through the constructor.
 */
export let _anthropicClient: Anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

/** Replace the client (test seam only). Returns the old client for restore. */
export function _setAnthropicClient(c: Anthropic): Anthropic {
  const prev = _anthropicClient
  _anthropicClient = c
  return prev
}

/** Pick a random question from a given dimension as a fallback. */
function fallbackSpinQuestion(dimension: 'situation' | 'problem' = 'situation') {
  const pool = SPIN_BANK.filter((q) => q.dimension === dimension)
  // Safe cast: SPIN_BANK always has situation questions
  return pool[Math.floor(Math.random() * pool.length)]!
}

/** Find a SPIN question by id. Returns undefined if not found. */
function findSpinById(id: string) {
  return SPIN_BANK.find((q) => q.id === id)
}

/**
 * Strip common LLM wrapping (markdown fences, "json" prefix) and parse JSON.
 * Returns the raw object or throws on parse failure.
 */
function parseJsonLenient(raw: string): unknown {
  let s = raw.trim()
  // Strip ```json ... ``` or ``` ... ``` fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(s)
}

// ─── Path A: LLM-driven SPIN pick ────────────────────────────────────────────

async function runSpinPick(
  ctx: EmmaContext,
  customerText: string,
): Promise<{ pick: LlmPick; inputTokens: number; outputTokens: number; fabricationCaught?: string }> {
  const systemBlocks = await buildEmmaSystemBlocks()

  // Build a compact SPIN bank manifest for the LLM (no prose — prose is server-rendered)
  const spinManifest = SPIN_BANK.map((q) => ({
    id: q.id,
    dimension: q.dimension,
    // Render prose with no slots so the LLM can read the question flavor
    preview: q.prose({}),
  }))

  const userPayload = {
    stage: 'DISCOVERY',
    goal:
      "Reply in Emma voice. Acknowledge what they said in 1 short sentence (warm, not salesy, no em-dashes). Then pick exactly ONE question from the SPIN bank that fits best given what they said. Output ONLY a JSON object with no markdown fences: { \"acknowledgment\": \"...\", \"spinId\": \"...\" }. No free-text questions. No product pitches. No prices. No product names or handles.",
    customerText,
    customerFirstName: ctx.customer?.firstName ?? null,
    todaysPick: ctx.todaysPick
      ? { title: ctx.todaysPick.title, handle: ctx.todaysPick.handle }
      : null,
    recentTurns: [], // Phase 5: empty — populated in Phase 6+
    spinBank: spinManifest,
  }

  // System blocks use cache_control for prompt caching
  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map((b) => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  const msg = await _anthropicClient.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemParam,
    messages: [{ role: 'user', content: JSON.stringify(userPayload, null, 2) }],
  })

  const usage = msg.usage as typeof msg.usage & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens

  const block = msg.content[0]
  const rawText = block?.type === 'text' ? block.text : ''

  // Attempt Zod-validated parse
  let parsed: unknown
  let fabricationCaught: string | undefined

  try {
    parsed = parseJsonLenient(rawText)
    const validated = LlmPickSchema.parse(parsed)

    // Extra: verify spinId exists in SPIN_BANK
    if (!findSpinById(validated.spinId)) {
      fabricationCaught = `Unknown spinId "${validated.spinId}" — falling back to random situation question`
      return { pick: buildFallbackPick(customerText), inputTokens, outputTokens, fabricationCaught }
    }

    return { pick: validated, inputTokens, outputTokens }
  } catch (err) {
    fabricationCaught = `LLM output failed validation: ${err instanceof Error ? err.message : String(err)}. Raw: ${rawText.slice(0, 120)}`
    return { pick: buildFallbackPick(customerText), inputTokens, outputTokens, fabricationCaught }
  }
}

/** Build a deterministic fallback pick without calling the LLM. */
function buildFallbackPick(customerText: string): LlmPick {
  const q = fallbackSpinQuestion('situation')
  // Simple warm acknowledgment that works for any opener
  const short = customerText.trim().slice(0, 30)
  const ack = short.length > 5
    ? `Got you, let me make sure I point you in the right direction.`
    : `Hey, glad you're here.`
  return { acknowledgment: ack, spinId: q.id }
}

// ─── Path B: NAME_ITEM → candidate search + transition to PRESENTATION ────────

async function runNameItemPath(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse | null> {
  // Search for a matching product handle. Prefer the extracted slot (just the
  // category noun like "plug") over the full customer text — passing the
  // whole sentence dilutes the signal and search returns wrong products
  // (e.g., "I'm looking for a plug for my boyfriend" returned a cock ring
  // because the search was matching "boyfriend" / "looking" noise instead
  // of the actual category).
  const searchQuery = intent.slots?.['item'] ?? customerText
  let candidates: Awaited<ReturnType<typeof searchForIvr>> = []
  let toolCallOk = true
  let toolError: string | undefined

  try {
    candidates = await searchForIvr({ query: searchQuery, limit: 1 })
  } catch (err) {
    toolCallOk = false
    toolError = err instanceof Error ? err.message : String(err)
    console.warn('[discovery] searchForIvr failed', toolError)
  }

  const candidate = candidates[0]

  if (!candidate) {
    // No result — fall back to Path A with a bridge acknowledgment
    return null
  }

  // Inline-execute PRESENTATION so the customer sees the actual pitch in ONE
  // turn. Previously this returned a "give me a sec" bridge and required the
  // customer to send another message to trigger PRESENTATION on the next turn —
  // confusing for real users (they'd think Emma was hung). The customer sends
  // "show me a wand" once and gets the actual MMS pitch in one reply.
  const searchToolCall = {
    name: 'searchForIvr',
    input: { query: searchQuery, limit: 1 },
    ok: toolCallOk,
    ...(toolError ? { error: toolError } : {}),
  } as const

  const patchedCtx: EmmaContext = {
    ...ctx,
    conversation: {
      ...ctx.conversation,
      currentPitchHandle: candidate.handle,
    },
  }

  try {
    const presentationResp = await executePresentationStage(patchedCtx, intent, customerText)
    return {
      ...presentationResp,
      // Force the resolved candidate handle into state writes (defensive — PRESENTATION
      // already does this, but guarantees we persist the choice even if its
      // fabrication-fallback path skipped it).
      stateWrites: {
        ...presentationResp.stateWrites,
        currentPitchHandle: candidate.handle,
      },
      // Prepend the searchForIvr tool call so the telemetry trail shows
      // "DISCOVERY found candidate → PRESENTATION pitched it" in order.
      telemetry: {
        ...presentationResp.telemetry,
        toolCalls: [
          searchToolCall,
          ...(presentationResp.telemetry.toolCalls ?? []),
        ],
      },
    }
  } catch (err) {
    // PRESENTATION failed inline — fall back to the old two-turn bridge so
    // the conversation still progresses. State is still set so the next turn
    // will run PRESENTATION normally.
    console.error('[discovery] inline PRESENTATION failed — falling back to two-turn bridge', err)
    return {
      stageOut: resolveTransition('DISCOVERY', 'PRESENTATION'),
      goalAchieved: false,
      segments: [
        {
          prose: `Oh, I've got something for you. Give me just a sec.`,
        },
      ],
      stateWrites: {
        stage: 'PRESENTATION',
        currentPitchHandle: candidate.handle,
      },
      telemetry: {
        intent: 'NAME_ITEM',
        intentConfidence: intent.confidence,
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: [searchToolCall],
      },
    }
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function executeDiscoveryStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  // ── Path B: explicit product-type request ──────────────────────────────────
  if (intent.intent === 'NAME_ITEM') {
    const nameItemResult = await runNameItemPath(ctx, intent, customerText)
    if (nameItemResult) return nameItemResult
    // Fall through to Path A if no candidate found
  }

  // ── Path A: SPIN question pick via LLM ────────────────────────────────────
  const { pick, inputTokens, outputTokens, fabricationCaught } = await runSpinPick(
    ctx,
    customerText,
  )

  const spinQuestion = findSpinById(pick.spinId) ?? fallbackSpinQuestion('situation')

  const slots = {
    firstName: ctx.customer?.firstName,
    todaysPickTitle: ctx.todaysPick?.title,
  }

  const questionProse = spinQuestion.prose(slots)
  const fullProse = `${pick.acknowledgment}\n\n${questionProse}`

  return {
    stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
    goalAchieved: false,
    segments: [
      {
        prose: fullProse,
      },
    ],
    stateWrites: {
      stage: 'DISCOVERY',
    },
    telemetry: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      inputTokens,
      outputTokens,
      ...(fabricationCaught ? { fabricationCaught } : {}),
    },
  }
}
