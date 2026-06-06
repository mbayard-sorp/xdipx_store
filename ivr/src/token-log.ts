/**
 * ivr/src/token-log.ts
 *
 * Minimal best-effort token-spend logger for the IVR package. The IVR process
 * lives in a separate Express server and cannot import from app/. This module
 * writes directly to Neon (which ivr/ already depends on via
 * @neondatabase/serverless) using a minimal inline INSERT rather than sharing
 * app/lib/token-log.server.ts.
 *
 * Spec B3.8 option A: direct Neon insert, no new HTTP surface, no shared secret.
 *
 * BEST-EFFORT: the entire body is wrapped in try/catch. A logging failure must
 * NEVER throw into or unwind a real IVR API call. All call sites use
 * `void logIvrTokens(...)` (fire-and-forget).
 */
import { neon } from '@neondatabase/serverless'

// IVR uses a single fixed model; keep the rate table minimal.
const IVR_MODEL = 'claude-haiku-4-5-20251001'
// Haiku pricing per 1M tokens (sync, full price)
const IVR_INPUT_RATE  = 1   // $1 / 1M input tokens
const IVR_OUTPUT_RATE = 5   // $5 / 1M output tokens

function estimateIvrCost(opts: {
  inputTokens:         number
  outputTokens:        number
  cacheCreationTokens: number
  cacheReadTokens:     number
}): number {
  const perTok = (rate: number) => rate / 1_000_000
  const cost =
    opts.inputTokens         * perTok(IVR_INPUT_RATE) +
    opts.outputTokens        * perTok(IVR_OUTPUT_RATE) +
    opts.cacheCreationTokens * perTok(IVR_INPUT_RATE * 1.25) +
    opts.cacheReadTokens     * perTok(IVR_INPUT_RATE * 0.10)
  return Math.round(cost * 1e5) / 1e5
}

export async function logIvrTokens(opts: {
  inputTokens:          number
  outputTokens:         number
  cacheCreationTokens?: number
  cacheReadTokens?:     number
  caller?:              string
}): Promise<void> {
  try {
    const dbUrl = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL']
    if (!dbUrl) return // no DB configured in this environment
    const sql = neon(dbUrl)
    const cacheCreation = opts.cacheCreationTokens ?? 0
    const cacheRead     = opts.cacheReadTokens     ?? 0
    const cost = estimateIvrCost({
      inputTokens:         opts.inputTokens,
      outputTokens:        opts.outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens:     cacheRead,
    })
    await sql`
      INSERT INTO api_token_log
        (feature, model, source, caller,
         input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
         request_count, est_cost_usd)
      VALUES
        ('ivr', ${IVR_MODEL}, 'sync', ${opts.caller ?? 'ivr/claude'},
         ${opts.inputTokens}, ${opts.outputTokens}, ${cacheCreation}, ${cacheRead},
         1, ${String(cost)})
    `
  } catch (err) {
    console.error('[ivr/token-log] best-effort write failed (ignored):', err)
  }
}
