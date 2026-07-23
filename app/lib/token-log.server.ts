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

/**
 * Write-through bump of the daily KV spend/image counters that back the team
 * budget gate (team.server.ts), so gate() reads a counter instead of
 * re-SUMming api_token_log on every call. Only bumps a counter that already
 * exists: a missing counter means no gate has seeded today's value yet, and
 * the seeding SUM will include the row this bump belongs to. BEST-EFFORT —
 * a lost bump undercounts for at most one re-seed window (15 min).
 */
async function bumpTeamSpendCounters(feature: string, costUsd: number, imageCount?: number): Promise<void> {
  try {
    const { teamFromFeature, teamSpendKvKey, teamImagesKvKey } = await import('./team-keys')
    const { kvGet, kvIncrBy } = await import('./kv.server')
    const day = new Date().toISOString().slice(0, 10)
    const team = teamFromFeature(feature)
    if (team) {
      const cents = Math.round(costUsd * 100)
      if (cents > 0) {
        const key = teamSpendKvKey(team, day)
        if ((await kvGet<number>(key)) != null) await kvIncrBy(key, cents)
      }
    }
    if (feature === 'homepage-images' && imageCount && imageCount > 0) {
      const key = teamImagesKvKey(day)
      if ((await kvGet<number>(key)) != null) await kvIncrBy(key, imageCount)
    }
  } catch (err) {
    console.error('[token-log] best-effort KV counter bump failed (ignored):', err)
  }
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
    await bumpTeamSpendCounters(entry.feature, cost)
  } catch (err) {
    console.error('[token-log] best-effort write failed (ignored):', err)
  }
}

// ---------------------------------------------------------------------------
// Image-generation spend logger
// ---------------------------------------------------------------------------

export interface ImageCostEntry {
  /** Feature label, e.g. 'homepage-images'. Surfaces on /admin/usage. */
  feature:    string
  /** Provider/model key from model-pricing IMAGE_RATES, e.g. 'fal/flux-dev', 'imagen'. */
  model:      string
  /** Number of images generated in this call. */
  count:      number
  caller?:    string
  productId?: string
  sku?:       string
}

/**
 * Log image-generation spend into api_token_log so it shows on /admin/usage
 * alongside token costs. Images carry no tokens, so est_cost_usd is computed
 * from the per-image IMAGE_RATES map (estimateImageCostUsd) and written
 * directly. BEST-EFFORT: never throws into the caller.
 */
export async function logImageCost(entry: ImageCostEntry): Promise<void> {
  try {
    if (!entry.count || entry.count <= 0) return
    const { db } = await import('./db.server')
    const { apiTokenLog } = await import('../../db/schema')
    const { estimateImageCostUsd } = await import('./model-pricing.server')
    const cost = estimateImageCostUsd(entry.model, entry.count)
    await db.insert(apiTokenLog).values({
      feature:             entry.feature,
      model:               entry.model,
      source:              'sync',
      batchId:             null,
      productId:           entry.productId ?? null,
      sku:                 entry.sku       ?? null,
      caller:              entry.caller    ?? null,
      inputTokens:         0,
      outputTokens:        0,
      cacheCreationTokens: 0,
      cacheReadTokens:     0,
      requestCount:        entry.count,
      estCostUsd:          String(cost),
    })
    await bumpTeamSpendCounters(entry.feature, cost, entry.count)
  } catch (err) {
    console.error('[token-log] best-effort image-cost write failed (ignored):', err)
  }
}

// ---------------------------------------------------------------------------
// Video-generation spend logger
// ---------------------------------------------------------------------------

export interface VideoCostEntry {
  /** Feature label, e.g. 'video-clip', 'video-spike'. 'video-*' attributes to the video team's budget gate. */
  feature:    string
  /** Cost key from model-pricing VIDEO_RATES, e.g. 'fal/veo3.1'. */
  model:      string
  /** Seconds of video generated in this call. */
  seconds:    number
  caller?:    string
  productId?: string
  sku?:       string
  /** Correlation id (video_jobs.job_id or an ad batch id) -> api_token_log.ref_id. */
  refId?:     string
}

/**
 * Log video-generation spend into api_token_log so it shows on /admin/usage
 * alongside token and image costs. Priced per second of output from VIDEO_RATES
 * (estimateVideoCostUsd). BEST-EFFORT: never throws into the caller.
 */
export async function logVideoCost(entry: VideoCostEntry): Promise<void> {
  try {
    if (!entry.seconds || entry.seconds <= 0) return
    const { db } = await import('./db.server')
    const { apiTokenLog } = await import('../../db/schema')
    const { estimateVideoCostUsd } = await import('./model-pricing.server')
    const cost = estimateVideoCostUsd(entry.model, entry.seconds)
    await db.insert(apiTokenLog).values({
      feature:             entry.feature,
      model:               entry.model,
      source:              'sync',
      batchId:             null,
      productId:           entry.productId ?? null,
      sku:                 entry.sku       ?? null,
      caller:              entry.caller    ?? null,
      refId:               entry.refId     ?? null,
      inputTokens:         0,
      outputTokens:        0,
      cacheCreationTokens: 0,
      cacheReadTokens:     0,
      requestCount:        1,
      estCostUsd:          String(cost),
    })
    await bumpTeamSpendCounters(entry.feature, cost)
  } catch (err) {
    console.error('[token-log] best-effort video-cost write failed (ignored):', err)
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

// ---------------------------------------------------------------------------
// Drill-down: per-call detail for one (day, feature[, model, source]) bucket
// ---------------------------------------------------------------------------

/**
 * One attribution group within a daily-rollup bucket. Raw api_token_log rows
 * are grouped by (caller, sku, product_id, batch_id) so the /admin/usage
 * drill-down can answer "what did this spend actually do, and on what SKUs."
 *
 * For source='batch' rows the per-SKU split is unavailable (one logged row
 * aggregates a whole batch turn), so job_type / job_sku_list are surfaced from
 * batch_jobs (joined on batch_id) to at least show which SKUs the job touched.
 * All numeric columns arrive as strings from SUM()/DECIMAL — caller parses.
 */
export interface TokenCallDetailRow {
  caller:                string | null
  sku:                   string | null
  product_id:            string | null
  batch_id:              string | null
  job_type:              string | null
  job_sku_list:          string[] | null
  row_count:             string
  calls:                 string
  input_tokens:          string
  output_tokens:         string
  cache_creation_tokens: string
  cache_read_tokens:     string
  est_cost_usd:          string
  first_ts:              string
  last_ts:               string
}

export async function getTokenCallDetail(opts: {
  day:     string            // ISO date 'YYYY-MM-DD'
  feature: string
  model?:  string | null
  source?: string | null
}): Promise<TokenCallDetailRow[]> {
  const { db } = await import('./db.server')
  const { sql } = await import('drizzle-orm')
  const model  = opts.model  ?? null
  const source = opts.source ?? null
  const result = await db.execute(
    sql`
      WITH grouped AS (
        SELECT
          caller, sku, product_id, batch_id,
          COUNT(*)                   AS row_count,
          SUM(request_count)         AS calls,
          SUM(input_tokens)          AS input_tokens,
          SUM(output_tokens)         AS output_tokens,
          SUM(cache_creation_tokens) AS cache_creation_tokens,
          SUM(cache_read_tokens)     AS cache_read_tokens,
          SUM(est_cost_usd)          AS est_cost_usd,
          MIN(ts)                    AS first_ts,
          MAX(ts)                    AS last_ts
        FROM api_token_log
        WHERE date_trunc('day', ts)::date = ${opts.day}::date
          AND feature = ${opts.feature}
          AND (${model}::text  IS NULL OR model  = ${model})
          AND (${source}::text IS NULL OR source = ${source})
        GROUP BY caller, sku, product_id, batch_id
      )
      SELECT g.*, bj.job_type, bj.sku_list AS job_sku_list
      FROM grouped g
      LEFT JOIN LATERAL (
        SELECT job_type, sku_list
        FROM batch_jobs
        WHERE g.batch_id IS NOT NULL
          AND (current_batch_id = g.batch_id OR batch_ids::jsonb ? g.batch_id)
        LIMIT 1
      ) bj ON TRUE
      ORDER BY est_cost_usd DESC
    `
  )
  return result.rows as unknown as TokenCallDetailRow[]
}
