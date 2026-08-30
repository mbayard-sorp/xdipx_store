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

/**
 * Width of api_token_log.sku (db/schema.ts: varchar('sku', { length: 32 })).
 * Image/video callers pass Shopify product HANDLES as sku, and handles
 * routinely exceed 32 chars (e.g. `sliquid-naturals-satin-personal-moisturizer`
 * is 42), so an unclamped value throws `value too long for type character
 * varying(32)` and the best-effort wrapper swallows the whole write — losing
 * both the ledger row and the budget-gate counter bump (#5051). Clamp instead,
 * matching the existing slice-to-column-width pattern used for model/caller/ref
 * in logGenerationBlock. A truncated sku is a lossy label, never lost spend.
 */
const SKU_MAX_LEN = 32

/** Clamp a nullable sku to the api_token_log.sku column width. */
function clampSku(sku: string | null | undefined): string | null {
  return sku ? sku.slice(0, SKU_MAX_LEN) : null
}

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
  // Clamp sku to its column width here, the single choke point for every cost
  // logger, so a long product handle can never overflow varchar(32) and throw
  // the whole write away (#5051).
  const safe: ApiTokenLogInsert = { ...values, sku: clampSku(values.sku) }
  try {
    await db.insert(apiTokenLog).values(safe)
  } catch {
    await new Promise(resolve => setTimeout(resolve, WRITE_RETRY_DELAY_MS))
    await db.insert(apiTokenLog).values(safe)
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
 *
 * `caller` (ticket #5429): an owner-initiated preview/regenerate still bumps
 * the DOLLAR counter (it is real spend) but never the IMAGE counter, mirroring
 * `getTodayImageCount`'s SQL exclusion so the two stay in agreement between
 * reseed windows instead of only converging once every 15 minutes.
 */
async function bumpTeamSpendCounters(
  feature: string,
  costUsd: number,
  imageCount?: number,
  caller?: string | null,
): Promise<void> {
  try {
    const { teamFromFeature, imageTeamFromFeature, teamSpendKvKey, teamImagesKvKey, OWNER_IMAGE_CALLERS } =
      await import('./team-keys')
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
    const isOwnerCaller = !!caller && (OWNER_IMAGE_CALLERS as readonly string[]).includes(caller)
    if (imageTeam && imageCount && imageCount > 0 && !isOwnerCaller) {
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
    // Bump the budget-gate counters before and independently of the ledger
    // insert, so a row-write failure below cannot also drop this spend from the
    // gate (#5051). Both are best-effort.
    await bumpTeamSpendCounters(entry.feature, cost)
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
    // Bump the budget-gate counters BEFORE and independently of the ledger
    // insert. The KV counter and the Neon row fail independently, so a
    // row-write failure below must never also drop this spend from the gate the
    // store relies on to cap runaway spend (#5051). Both are best-effort.
    await bumpTeamSpendCounters(entry.feature, cost, entry.count, entry.caller)
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
      sku:                 clampSku(entry.sku),
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
  /**
   * A REAL metered cost that replaces the per-second estimate, e.g. RunPod's
   * computeRunpodActualCostUsd(executionMs) once a job completes. Omit for
   * every provider that only ever has an estimate (fal): estimateVideoCostUsd
   * still runs in that case exactly as before.
   */
  actualCostUsd?: number
}

/**
 * Log video-generation spend into api_token_log so it shows on /admin/usage
 * alongside token and image costs. Priced per second of output from VIDEO_RATES
 * (estimateVideoCostUsd), unless the caller passes a metered actualCostUsd.
 * BEST-EFFORT: never throws into the caller.
 */
export async function logVideoCost(entry: VideoCostEntry): Promise<void> {
  try {
    if (!entry.seconds || entry.seconds <= 0) return
    const { estimateVideoCostUsd } = await import('./model-pricing.server')
    const cost = entry.actualCostUsd ?? estimateVideoCostUsd(entry.model, entry.seconds)
    // Bump the budget-gate counters before and independently of the ledger
    // insert, so a row-write failure below cannot also drop this spend from the
    // gate (#5051). Both are best-effort.
    await bumpTeamSpendCounters(entry.feature, cost)
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
  } catch (err) {
    console.error('[token-log] best-effort video-cost write failed (ignored):', err)
    await recordTokenWriteFailure()
  }
}

// ---------------------------------------------------------------------------
// Out-of-band RunPod pod (GPU) spend logger
// ---------------------------------------------------------------------------

/**
 * Feature label for GPU spend on standalone RunPod PODS created outside the
 * video_jobs pipeline: one-time model bootstraps and the S2V graph bake-offs
 * driven straight against the RunPod REST API rather than through
 * POST /api/team/video-job (ticket #6320).
 *
 * Deliberately NOT prefixed `video-`. This spend must be RECORDED next to the
 * pipeline's video spend, but it must NOT count against video_team_daily_cents:
 * a bake-off or bootstrap refused by the daily gate is worse than one that is
 * merely visible (the store's chosen "record only, do not gate" default, see
 * docs/store-team/video-worker-runpod.md). Because the prefix is not a TeamId,
 * teamFromFeature() returns null (bumpTeamSpendCounters no-ops) and
 * getTodaySpendCents's `feature LIKE 'video-%'` window never sums it, so
 * recording-without-gating falls out of the naming convention with no edit to
 * the protected spend-control code, the same trick MEDIA_BLOCK_FEATURE uses.
 */
export const RUNPOD_POD_FEATURE = 'bakeoff-gpu'

export interface RunpodPodCostEntry {
  /** RunPod pod id, e.g. 'y33zcw0e9cl8ql'. Lands in ref_id. */
  podId:      string
  /** GPU-seconds of pod uptime this row accounts for. Lands in request_count. */
  gpuSeconds: number
  /** Metered USD cost for those GPU-seconds (rate * uptime). */
  costUsd:    number
  /** GPU model string, e.g. 'NVIDIA GeForce RTX 4090'. Lands in caller. */
  gpu?:       string
}

/**
 * Record incremental GPU spend for one out-of-band RunPod pod into
 * api_token_log, so a day that spent real bake-off/bootstrap money on the Pods
 * product no longer reads $0 on the Video tab and /admin/usage. Does NOT bump
 * any team budget counter (record-only, see RUNPOD_POD_FEATURE). BEST-EFFORT:
 * never throws into the caller. The pod-watch cron must keep filing its
 * stray-pod blocker regardless of a logging failure.
 */
export async function logRunpodPodCost(entry: RunpodPodCostEntry): Promise<void> {
  try {
    if (!entry.costUsd || entry.costUsd <= 0) return
    await insertTokenRow({
      feature:             RUNPOD_POD_FEATURE,
      model:               'runpod-pod',
      source:              'sync',
      batchId:             null,
      productId:           null,
      sku:                 null,
      caller:              entry.gpu ? entry.gpu.slice(0, 96) : null,
      refId:               entry.podId.slice(0, 64),
      inputTokens:         0,
      outputTokens:        0,
      cacheCreationTokens: 0,
      cacheReadTokens:     0,
      requestCount:        Math.max(1, Math.round(entry.gpuSeconds)),
      estCostUsd:          String(entry.costUsd),
    })
  } catch (err) {
    console.error('[token-log] best-effort runpod pod-cost write failed (ignored):', err)
    await recordTokenWriteFailure()
  }
}

/**
 * Today's out-of-band RunPod pod spend (UTC), in cents, summed from
 * api_token_log under RUNPOD_POD_FEATURE. This is record-only GPU spend the
 * Video tab shows beside the gated pipeline figure (ticket #6320). Returns 0
 * when there is none, or on any read error (best-effort, never throws).
 */
export async function getTodayRunpodPodSpendCents(): Promise<number> {
  try {
    const { db } = await import('./db.server')
    const { sql } = await import('drizzle-orm')
    const result = await db.execute(
      sql`SELECT COALESCE(SUM(est_cost_usd), 0) AS usd
          FROM api_token_log
          WHERE ts >= current_date AND feature = ${RUNPOD_POD_FEATURE}`
    )
    const usd = Number((result.rows[0] as { usd?: string | number } | undefined)?.usd ?? 0)
    return Number.isFinite(usd) ? Math.round(usd * 100) : 0
  } catch (err) {
    console.error('[token-log] best-effort runpod pod-spend read failed (ignored):', err)
    return 0
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
