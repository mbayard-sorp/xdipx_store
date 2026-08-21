/**
 * Central token-spend logger for every Anthropic API-key call.
 *
 * BEST-EFFORT: the entire body is wrapped in try/catch. A logging failure
 * must NEVER throw into or unwind a real API call. All call sites use
 * `void logApiTokens(...)` (fire-and-forget).
 *
 * Per-call rows land in api_token_log. The daily rollup view api_token_daily
 * (created in migration 043) is read by getDailyTokenRollup() for /admin/usage.
 *
 * The insert is transient-fault tolerant: the row write fails roughly daily
 * with `NeonDbError: fetch failed`, a blip that clears on an immediate
 * reattempt, and those failures were swallowed silently, so spend tracking
 * quietly undercounts. `insertTokenRow` retries the write once after a short
 * delay, and a failure that survives the retry bumps a per-day KV counter
 * (recordTokenWriteFailure) the owner digest surfaces when nonzero, so the
 * gaps stop being invisible.
 */

import type { InferInsertModel } from 'drizzle-orm'

type ApiTokenLogInsert = InferInsertModel<typeof import('../../db/schema').apiTokenLog>

/** One short pause before the single reattempt of a failed row write. */
const WRITE_RETRY_DELAY_MS = 250

/** KV key for the per-UTC-day count of writes that failed even after retry. */
function tokenWriteFailureKey(utcDate: string): string {
  return `token-log:write-failures:${utcDate}`
}

/**
 * Insert one api_token_log row with a single bounded retry. The daily
 * `NeonDbError: fetch failed` is transient and clears on an immediate second
 * attempt, so one retry after a short delay recovers the common case without
 * turning this best-effort logger into a blocking call. Throws if both
 * attempts fail, so the caller's catch records the miss.
 */
async function insertTokenRow(values: ApiTokenLogInsert): Promise<void> {
  const { db } = await import('./db.server')
  const { apiTokenLog } = await import('../../db/schema')
  try {
    await db.insert(apiTokenLog).values(values)
  } catch {
    await new Promise(resolve => setTimeout(resolve, WRITE_RETRY_DELAY_MS))
    await db.insert(apiTokenLog).values(values)
  }
}

/**
 * Count one api_token_log write that failed even after its retry. Kept in KV
 * (independent of the Neon write that just failed) under a per-UTC-day key, so
 * the owner digest can report the day's silent spend-tracking gap. BEST-EFFORT:
 * kvIncrBy degrades to the in-memory fallback and never throws, and the whole
 * body is guarded so recording a miss cannot itself unwind the caller.
 */
async function recordTokenWriteFailure(): Promise<void> {
  try {
    const { kvIncrBy } = await import('./kv.server')
    const day = new Date().toISOString().slice(0, 10)
    // One small integer per UTC day. kvIncrBy is atomic but sets no expiry, so
    // the key persists; the digest reads today's and yesterday's buckets, and
    // older buckets are stale but harmless. A count that survives the retry is
    // rare, so this stays a tiny, low-cardinality set of keys.
    await kvIncrBy(tokenWriteFailureKey(day), 1)
  } catch (err) {
    console.error('[token-log] failed to record write-failure counter (ignored):', err)
  }
}

/**
 * Count of api_token_log writes that failed even after retry over the trailing
 * ~24-48h (current and previous UTC-day buckets summed), read from KV by the
 * owner digest. Zero when healthy or when KV is cold. BEST-EFFORT: never throws.
 */
export async function getTokenWriteFailureCount(): Promise<number> {
  try {
    const { kvGet } = await import('./kv.server')
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const prev = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
    const [a, b] = await Promise.all([
      kvGet<number>(tokenWriteFailureKey(today)),
      kvGet<number>(tokenWriteFailureKey(prev)),
    ])
    return (Number(a) || 0) + (Number(b) || 0)
  } catch (err) {
    console.error('[token-log] failed to read write-failure counter (ignored):', err)
    return 0
  }
}

export interface TokenLogEntry {
  feature:              string   // 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | 'reviews' | 'seo-research' | 'log-monitor' | 'video-prompt' | 'rail-gen' | 'discovery-rank' | 'contextual-tagline' | ...
  model:                string
  /** 'batch' | 'sync' are API-key billed. Max-subscription callers use one of
   *  MAX_SUBSCRIPTION_SOURCES and cost zero. Typed as string because the union
   *  was never enforced at runtime: /api/homepage-team/spend cast to it, so
   *  real rows already carry 'anthropic-max', 'max-subscription',
   *  'cloud-routine' and one 'social-drafts'. Narrow types that lie are worse
   *  than wide types that do not. */
  source:               string
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
    const { teamFromFeature, imageTeamFromFeature, teamSpendKvKey, teamImagesKvKey } = await import('./team-keys')
    const { kvGet, kvIncrBy } = await import('./kv.server')
    const day = new Date().toISOString().slice(0, 10)
    // teamFromFeature includes FEATURE_TEAM_OVERRIDES, so 'notebook-images'
    // bumps the content spend counter instead of silently no-opping (#581).
    const team = teamFromFeature(feature)
    if (team) {
      const cents = Math.round(costUsd * 100)
      if (cents > 0) {
        const key = teamSpendKvKey(team, day)
        if ((await kvGet<number>(key)) != null) await kvIncrBy(key, cents)
      }
    }
    // Image counter is per team (was hardcoded to 'homepage-images', which
    // made every other team's image cap decorative — #3678/#3390).
    const imageTeam = imageTeamFromFeature(feature)
    if (imageTeam && imageCount && imageCount > 0) {
      const key = teamImagesKvKey(imageTeam, day)
      if ((await kvGet<number>(key)) != null) await kvIncrBy(key, imageCount)
    }
  } catch (err) {
    console.error('[token-log] best-effort KV counter bump failed (ignored):', err)
  }
}

export async function logApiTokens(entry: TokenLogEntry): Promise<void> {
  try {
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
    await insertTokenRow({
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
    await recordTokenWriteFailure()
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
  /** Correlation id (video_jobs.job_id, ad batch id) -> api_token_log.ref_id. */
  refId?:     string
  /**
   * Provider request id for the generation that produced this image (fal's
   * `x-fal-request-id`), written to the existing api_token_log.request_id
   * column so an owner can resolve a fal request id to its spend row directly
   * instead of decoding a UUIDv7 timestamp. Globally unique per fal call, so it
   * never collides with the IVR idempotency keys that also live in this column.
   * Pair it with a file-identifying `refId` (per candidate) so the id resolves
   * to one image, not a batch.
   */
  requestId?: string
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
    const { estimateImageCostUsd } = await import('./model-pricing.server')
    const cost = estimateImageCostUsd(entry.model, entry.count)
    await insertTokenRow({
      feature:             entry.feature,
      model:               entry.model,
      source:              'sync',
      batchId:             null,
      productId:           entry.productId ?? null,
      sku:                 entry.sku       ?? null,
      caller:              entry.caller    ?? null,
      refId:               entry.refId     ?? null,
      requestId:           entry.requestId ?? null,
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
    await recordTokenWriteFailure()
  }
}

// ---------------------------------------------------------------------------
// Generation-block telemetry
// ---------------------------------------------------------------------------

/** Feature label every block row carries. `media` is not a TeamId, so
 *  teamFromFeature() returns null and no budget counter is ever bumped. */
export const MEDIA_BLOCK_FEATURE = 'media-blocks'

export interface GenerationBlockEntry {
  /** Provider/model that refused, e.g. 'fal-ai/nano-banana/edit', 'imagen'. */
  model:      string
  /** Why it failed, and which input it objected to. */
  reason:     string
  surface?:   string | null
  /** Images that were asked for and not produced. Surfaces as `calls`. */
  count?:     number
  /** Originating function or route. */
  caller?:    string
  /** The feature the blocked call belonged to, e.g. 'video-frames'. */
  ofFeature?: string
  productId?: string
  sku?:       string
}

/**
 * Record a generation that a provider refused or failed to serve.
 *
 * Written as a ZERO-COST row in api_token_log under feature 'media-blocks'.
 * That is deliberate and it is a compromise: a dedicated blocks table would be
 * the clean design, but it needs a migration and db/schema.ts plus
 * db/migrations are protected paths. Reusing the spend log means the existing
 * api_token_daily view and /admin/usage pick these up with no new plumbing,
 * and est_cost_usd = 0 keeps them out of every spend total.
 *
 * The reason/surface pair rides in ref_id (see encodeBlockRef).
 *
 * BEST-EFFORT: never throws into the caller. Also emits a structured
 * console.warn so log-monitor can see blocks without a DB round trip.
 */
export async function logGenerationBlock(entry: GenerationBlockEntry): Promise<void> {
  const count = Math.max(1, entry.count ?? 1)
  console.warn(
    `[media-block] model=${entry.model} reason=${entry.reason} surface=${entry.surface ?? '-'} ` +
    `count=${count} caller=${entry.caller ?? '-'} feature=${entry.ofFeature ?? '-'} sku=${entry.sku ?? '-'}`,
  )
  try {
    const { db } = await import('./db.server')
    const { apiTokenLog } = await import('../../db/schema')
    const { encodeBlockRef } = await import('./media-block')
    await db.insert(apiTokenLog).values({
      feature:             MEDIA_BLOCK_FEATURE,
      // Model ids are longer than the 64-char column for some endpoints.
      model:               entry.model.slice(0, 64),
      source:              'sync',
      batchId:             null,
      productId:           entry.productId ?? null,
      sku:                 entry.sku       ?? null,
      caller:              (entry.ofFeature ? `${entry.ofFeature}:${entry.caller ?? '-'}` : entry.caller ?? null)?.slice(0, 96) ?? null,
      refId:               encodeBlockRef({
        reason:  entry.reason as never,
        surface: (entry.surface ?? null) as never,
      }).slice(0, 64),
      inputTokens:         0,
      outputTokens:        0,
      cacheCreationTokens: 0,
      cacheReadTokens:     0,
      requestCount:        count,
      estCostUsd:          '0',
    })
  } catch (err) {
    console.error('[token-log] best-effort block write failed (ignored):', err)
  }
}

export interface MediaBlockRow {
  day:     string
  model:   string
  reason:  string
  surface: string | null
  caller:  string | null
  blocked: string
}

/**
 * Blocked generations by day, model, and reason. Answers the question the
 * bake-off could only answer by hand: which models are refusing this catalog,
 * how often, and on the prompt or the image.
 */
export async function getMediaBlockRollup(opts: { days?: number } = {}): Promise<MediaBlockRow[]> {
  const { db } = await import('./db.server')
  const { sql } = await import('drizzle-orm')
  const days = opts.days ?? 30
  const result = await db.execute(
    sql`SELECT date_trunc('day', ts)::date::text AS day,
               model,
               split_part(ref_id, '/', 1) AS reason,
               NULLIF(split_part(ref_id, '/', 2), '-') AS surface,
               caller,
               SUM(request_count) AS blocked
        FROM api_token_log
        WHERE feature = ${MEDIA_BLOCK_FEATURE}
          AND ts >= current_date - ${days}::int
        GROUP BY 1, 2, 3, 4, 5
        ORDER BY day DESC, blocked DESC`
  )
  return result.rows as unknown as MediaBlockRow[]
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
    const { estimateVideoCostUsd } = await import('./model-pricing.server')
    const cost = estimateVideoCostUsd(entry.model, entry.seconds)
    await insertTokenRow({
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
    await recordTokenWriteFailure()
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
