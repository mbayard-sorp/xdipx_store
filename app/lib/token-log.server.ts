/**
 * Central token-spend logger for every Anthropic API-key call.
 *
 * BEST-EFFORT: the entire body is wrapped in try/catch. A logging failure
 * must NEVER throw into or unwind a real API call. All call sites use
 * `void logApiTokens(...)` (fire-and-forget).
 *
 * Per-call rows land in api_token_log. The daily rollup view api_token_daily
 * (created in migration 043) is read by getDailyTokenRollup() for /admin/usage.
 */

export interface TokenLogEntry {
  feature:              string   // 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | 'reviews' | 'seo-research' | 'log-monitor' | 'video-prompt' | 'rail-gen' | 'discovery-rank' | 'contextual-tagline' | ...
  model:                string
  source:               'batch' | 'sync' | 'agent-sdk'
  inputTokens:          number
  outputTokens:         number
  cacheCreationTokens?: number
  cacheReadTokens?:     number
  requestCount?:        number   // default 1; >1 for an aggregated batch turn
  batchId?:             string
  productId?:           string
  sku?:                 string
  caller?:              string   // free-form: function / route that originated the call
}

export async function logApiTokens(entry: TokenLogEntry): Promise<void> {
  try {
    const { db } = await import('./db.server')
    const { apiTokenLog } = await import('../../db/schema')
    const { estimateCostUsd } = await import('./model-pricing.server')
    const cacheCreation = entry.cacheCreationTokens ?? 0
    const cacheRead     = entry.cacheReadTokens     ?? 0
    const cost = estimateCostUsd({
      model:               entry.model,
      source:              entry.source,
      inputTokens:         entry.inputTokens,
      outputTokens:        entry.outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens:     cacheRead,
    })
    await db.insert(apiTokenLog).values({
      feature:             entry.feature,
      model:               entry.model,
      source:              entry.source,
      batchId:             entry.batchId             ?? null,
      productId:           entry.productId           ?? null,
      sku:                 entry.sku                 ?? null,
      caller:              entry.caller              ?? null,
      inputTokens:         entry.inputTokens,
      outputTokens:        entry.outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens:     cacheRead,
      requestCount:        entry.requestCount        ?? 1,
      estCostUsd:          String(cost),
    })
  } catch (err) {
    console.error('[token-log] best-effort write failed (ignored):', err)
  }
}

// ---------------------------------------------------------------------------
// Daily rollup read for /admin/usage
// ---------------------------------------------------------------------------

export interface DailyTokenRow {
  day:                  Date
  feature:              string
  model:                string
  source:               string
  calls:                string
  input_tokens:         string
  output_tokens:        string
  cache_creation_tokens: string
  cache_read_tokens:    string
  est_cost_usd:         string
}

/**
 * Read from the api_token_daily view via raw SQL (Drizzle has no view model).
 *
 * NOTE on savings calculation: one enrichment run produces BOTH source='batch'
 * rows (outer orchestrator turns) AND source='sync' rows (nested per-tool
 * callClaude calls). Always aggregate across BOTH sources for the same feature
 * when computing headline savings. The breakdown by source is for the detail
 * table only.
 */
export async function getDailyTokenRollup(opts: { days?: number } = {}): Promise<DailyTokenRow[]> {
  const { db } = await import('./db.server')
  const { sql } = await import('drizzle-orm')
  const days = opts.days ?? 30
  const result = await db.execute(
    sql`SELECT * FROM api_token_daily
        WHERE day >= current_date - ${days}::int
        ORDER BY day DESC, est_cost_usd DESC`
  )
  return result.rows as unknown as DailyTokenRow[]
}
