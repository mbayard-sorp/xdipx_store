/**
 * app/lib/sms-v2/summary.server.ts
 *
 * Phase 0 — Haiku-based rolling conversation summarizer.
 *
 * Generates a 1-2 sentence prose summary of the SMS/IVR/web conversation so
 * far, written from the concierge's perspective. The summary is injected into
 * the next turn's system prompt via the <known_about_customer> block so the
 * agent retains context beyond the HISTORY_LIMIT window (Failure 1 from the
 * plan: history truncation causes forgetting).
 *
 * The call is designed to be fired-and-forgotten AFTER the reply ships to
 * Twilio. It MUST NOT be awaited before the reply is returned. See the
 * call site in conversation-agent.server.ts for the required comment.
 *
 * Design decisions:
 *   - Model: claude-haiku-4-5-20251001 (same as slot-extractor, cheap, fast)
 *   - Input: the last N HistoryTurn pairs + optional priorSummary as anchor
 *   - Output: plain English, max 200 characters, no em-dashes (voice memory)
 *   - On any error: returns priorSummary unchanged (graceful degradation)
 *   - Test injectable via _setSummaryAnthropicClient (same pattern as
 *     slot-extractor.server.ts:56-58)
 *
 * Architect condition #4 (binding): the prompt here contains ZERO em-dashes.
 * Audited below — do not introduce them in future edits.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { HistoryTurn } from './conversation-history.server'
import { logApiTokens } from '../token-log.server'

// ---------------------------------------------------------------------------
// Model constant — copy from slot-extractor.server.ts, never guess the string
// ---------------------------------------------------------------------------

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// ---------------------------------------------------------------------------
// How many history turns to feed the summarizer.
// Enough to capture the current pitch + a few prior context turns.
// Too many and we blow Haiku's context for no benefit.
// ---------------------------------------------------------------------------

const SUMMARY_HISTORY_SLICE = 6

// ---------------------------------------------------------------------------
// Injectable Anthropic client (test isolation)
// ---------------------------------------------------------------------------

let _anthropic = new Anthropic({
  apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim(),
})

/**
 * Swap out the Anthropic client in tests to prevent real API calls.
 * Mirrors slot-extractor.server.ts:56-58.
 */
export function _setSummaryAnthropicClient(client: Anthropic): void {
  _anthropic = client
}

// ---------------------------------------------------------------------------
// Summarizer prompt
//
// BINDING CONSTRAINT: zero em-dashes (project memory: Emma voice never uses
// em-dashes). The prompt drives Haiku output which then goes into the system
// prompt. A stray em-dash from Haiku would violate the hard rule in
// CONVERSATION_RULES_CORE. We prevent this by banning them in the prompt.
//
// Prompt is deliberately minimal: Haiku should not invent facts.
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `You summarize a sexual-wellness shopping conversation for a concierge assistant.

RULES:
- Write 1-2 sentences only. Maximum 200 characters total.
- Only include facts the customer explicitly stated. Do not infer or elaborate.
- Do not describe emotional states, hesitations, or psychological characterizations for the customer or anyone they mention. State only concrete facts: what they want, budget constraints, product type, who it is for.
- If a product was pitched, name it by its handle (e.g. "lovense-domi-2"), not by marketing copy.
- Write in third person about the customer ("Customer is shopping for...").
- No em-dashes. Use commas, periods, or hyphens in compound words.
- If there is not enough context for a meaningful summary, return an empty string.
- Return only the summary text, no preamble, no quotes around it.`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a 1-2 sentence rolling summary of the conversation.
 *
 * @param turns - Recent history turns (will be sliced to SUMMARY_HISTORY_SLICE).
 * @param priorSummary - The previous turn's summary, used as an anchor. Null on first call.
 * @returns The new summary string. On any error, returns priorSummary (or empty string).
 */
export async function generateConversationSummary(
  turns: HistoryTurn[],
  priorSummary: string | null,
): Promise<string> {
  // Take only the most recent slice so the prompt stays tight.
  const recentTurns = turns.slice(-SUMMARY_HISTORY_SLICE)

  if (recentTurns.length === 0 && !priorSummary) {
    // Nothing to summarize yet.
    return ''
  }

  // Build the user message that Haiku will summarize.
  const historyText = recentTurns
    .map((t) => `${t.role === 'user' ? 'Customer' : 'Emma'}: ${t.text}`)
    .join('\n')

  const userMessage = [
    priorSummary ? `Previous summary (use as anchor, can be refined):\n${priorSummary}` : null,
    recentTurns.length > 0 ? `Recent conversation:\n${historyText}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  if (!userMessage.trim()) {
    return priorSummary ?? ''
  }

  try {
    const res = await _anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 120,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

    const _u = res.usage as {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    void logApiTokens({
      feature: 'sms',
      model: HAIKU_MODEL,
      source: 'sync',
      inputTokens: _u.input_tokens,
      outputTokens: _u.output_tokens,
      cacheCreationTokens: _u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: _u.cache_read_input_tokens ?? 0,
      caller: 'generateConversationSummary',
    })

    const textBlock = res.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    )
    const raw = (textBlock?.text ?? '').trim()

    // Guard: never return an empty summary when we had a prior one.
    // Haiku occasionally returns empty on very short inputs.
    if (!raw) return priorSummary ?? ''

    // Hard cap at 300 chars in case Haiku ignores the 200-char instruction.
    // The instruction says 200; we leave a 50% buffer before truncating.
    return raw.length > 300 ? raw.slice(0, 297) + '...' : raw
  } catch (err) {
    // Non-fatal: return the prior summary so the agent still has context.
    console.warn('[summary] generateConversationSummary failed (non-fatal), returning prior', err)
    return priorSummary ?? ''
  }
}
