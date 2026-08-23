/**
 * Scheduled social metrics sweep (Social Studio v2, Phase 6b, ticket #4916).
 *
 * Every six hours, /cron/social-metrics-sweep refreshes `metrics_json` on the
 * posted Instagram and X rows from the last SWEEP_WINDOW_DAYS so the Studio's
 * analytics view (Phase 6a) reads numbers that are hours old, not whatever the
 * social routine last captured on its own schedule. It also appends one
 * follower reading to the IG history so reach has a denominator.
 *
 * SHIPS INERT. `social_metrics_sweep_enabled` defaults off and is read fresh
 * every tick, because X bills per metrics read (roughly $0.005 a tweet on the
 * pay-per-use tier). That makes this a spend control, which is why the valve
 * and the monthly read cap are owner-only and why this file never flips them.
 *
 * The read cap is a hard monthly ceiling on X reads, counted in KV per UTC
 * month. Instagram insights are free and only bounded by the sample size. The
 * sweep is read-only against the platforms: it never posts, deletes, or edits.
 *
 * Built on the capture functions in social-engagement.server.ts so the fetch,
 * parse, and merge paths are the ones the routine already exercises; this file
 * only supplies the window repo, the valve, and the read budget.
 */
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts, socialFollowerHistory } from '../../db/schema'
import { permalinkFor } from './social-permalink.server'
import {
  captureInstagramEngagement,
  captureXEngagement,
  captureInstagramAccount,
  makeDbEngagementCaptureRepo,
  type EngagementCaptureRepo,
  type EngagementCaptureRow,
  type EngagementReportRow,
  type InstagramAccountReport,
} from './social-engagement.server'

import { X_METRICS_MAX_READS_MONTH_KEY, X_METRICS_MAX_READS_MONTH_DEFAULT } from './team-keys'
export { X_METRICS_MAX_READS_MONTH_KEY, X_METRICS_MAX_READS_MONTH_DEFAULT }

/** How far back a posted row is still worth refreshing. */
export const SWEEP_WINDOW_DAYS = 30

/** Rows per platform per sweep. Rows with no metrics yet sort first. */
export const SWEEP_SAMPLE = 24

export type SweepPlatform = 'instagram' | 'x'

export interface SweepPlatformResult {
  checked: number
  errors: number
  /** Rows whose missing `permalink` this sweep filled in (Phase 4). */
  permalinksBackfilled?: number
  /** Present when the platform was not swept at all. */
  skipped?: 'read_cap_reached' | 'threw'
  detail?: string
}

export interface SocialMetricsSweepResult {
  ranAt: string
  /** Set when nothing ran; the valve is the only reason today. */
  skipped?: 'valve_off'
  instagram?: SweepPlatformResult
  x?: SweepPlatformResult & { readsUsedMonth: number; maxReadsMonth: number }
  account?: InstagramAccountReport
}

export interface SocialMetricsSweepDeps {
  isEnabled?: () => Promise<boolean>
  xMaxReadsMonth?: () => Promise<number>
  xReadsThisMonth?: (month: string) => Promise<number>
  recordXReads?: (month: string, n: number) => Promise<void>
  instagramRepo?: EngagementCaptureRepo
  xRepo?: EngagementCaptureRepo
  captureInstagram?: typeof captureInstagramEngagement
  captureX?: typeof captureXEngagement
  captureAccount?: typeof captureInstagramAccount
  /**
   * Permalink backfill (Phase 4, ADR-013 decision 10). Lists the swept rows
   * still missing a `permalink`, resolves each, and persists what resolved.
   * Returns how many were filled, or undefined when it did not run. Defaults
   * to the live database plus `permalinkFor` for a platform whose repo was
   * not injected, and to a no-op for one that was (see the note in the
   * sweep body); optional so the pre-Phase-4 test doubles stay valid.
   */
  backfillPermalink?: (platform: SweepPlatform) => Promise<number | undefined>
  /**
   * Appends the follower reading to `social_follower_history` (migration 084)
   * alongside the KV history the capture already writes. Best-effort.
   */
  appendFollowerHistory?: (reading: FollowerHistoryRow) => Promise<void>
  now?: () => Date
}

export interface FollowerHistoryRow {
  platform: 'instagram'
  capturedAt: Date
  followers: number | null
  follows: number | null
  mediaCount: number | null
}

/** The swept rows still missing a live URL, oldest first so history fills in order. */
async function rowsMissingPermalink(platform: SweepPlatform, limit: number, now: () => Date) {
  const since = new Date(now().getTime() - SWEEP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return db
    .select({ id: socialPosts.id, externalPostId: socialPosts.externalPostId })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, platform),
      eq(socialPosts.status, 'posted'),
      isNotNull(socialPosts.externalPostId),
      isNull(socialPosts.permalink),
      gte(socialPosts.postedAt, since),
    ))
    .orderBy(socialPosts.postedAt)
    .limit(limit)
}

/**
 * Fill in `permalink` on swept rows that lack one. X costs nothing (the URL is
 * arithmetic); Instagram costs one extra GET per missing row, and only for
 * rows missing it, so a row is fetched once ever. A null resolution leaves the
 * row alone for the next sweep.
 */
export async function backfillPermalinks(
  platform: SweepPlatform,
  deps: { limit?: number; now?: () => Date; resolve?: typeof permalinkFor } = {},
): Promise<number> {
  const now = deps.now ?? (() => new Date())
  const resolve = deps.resolve ?? permalinkFor
  const rows = await rowsMissingPermalink(platform, deps.limit ?? SWEEP_SAMPLE, now)
  let filled = 0
  for (const row of rows) {
    const permalink = await resolve(platform, row.externalPostId)
    if (!permalink) continue
    await db.update(socialPosts)
      .set({ permalink, updatedAt: now() })
      .where(and(eq(socialPosts.id, row.id), isNull(socialPosts.permalink)))
    filled++
  }
  return filled
}

async function dbAppendFollowerHistory(reading: FollowerHistoryRow): Promise<void> {
  await db.insert(socialFollowerHistory).values(reading)
}

/** `YYYY-MM` in UTC, the bucket the X read counter lives in. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * A capture repo scoped to the sweep window. `recentPosted` ignores the
 * caller's limit on purpose: the capture functions pass their own routine
 * sample (CAPTURE_SAMPLE), and the sweep's bound is what matters here. Rows
 * with no metrics yet come first so a fresh post gets its first numbers on
 * the next tick rather than waiting behind older rows.
 */
export function makeWindowRepo(platform: SweepPlatform, limit: number, now: () => Date): EngagementCaptureRepo {
  const base = makeDbEngagementCaptureRepo(platform)
  return {
    recentPosted: async (): Promise<EngagementCaptureRow[]> => {
      if (limit <= 0) return []
      const since = new Date(now().getTime() - SWEEP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      return db
        .select({
          id: socialPosts.id,
          externalPostId: socialPosts.externalPostId,
          postedAt: socialPosts.postedAt,
        })
        .from(socialPosts)
        .where(and(
          eq(socialPosts.platform, platform),
          eq(socialPosts.status, 'posted'),
          isNotNull(socialPosts.externalPostId),
          gte(socialPosts.postedAt, since),
        ))
        .orderBy(sql`${socialPosts.metricsJson} IS NOT NULL`, desc(socialPosts.postedAt))
        .limit(limit)
    },
    ...(base.persistMetrics ? { persistMetrics: base.persistMetrics } : {}),
  }
}

async function numericSetting(key: string, fallback: number): Promise<number> {
  const { getPipelineSetting } = await import('./feed-processor.server')
  const raw = await getPipelineSetting(key)
  const n = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

async function kvReadsThisMonth(month: string): Promise<number> {
  const { kvGet, KV_KEYS } = await import('./kv.server')
  const n = await kvGet<number>(KV_KEYS.xMetricsReads(month))
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

async function kvRecordReads(month: string, n: number): Promise<void> {
  if (n <= 0) return
  const { kvIncrBy, KV_KEYS } = await import('./kv.server')
  await kvIncrBy(KV_KEYS.xMetricsReads(month), n)
}

function summarize(report: EngagementReportRow[]): SweepPlatformResult {
  return {
    checked: report.length,
    errors: report.filter(r => r.error).length,
  }
}

/**
 * One sweep. Each platform stands alone: an Instagram throw is recorded on the
 * Instagram block and X still runs, and vice versa. The account reading is
 * best-effort and never fails the sweep.
 */
export async function runSocialMetricsSweep(
  deps: SocialMetricsSweepDeps = {},
): Promise<SocialMetricsSweepResult> {
  const now = deps.now ?? (() => new Date())
  const ranAt = now().toISOString()

  const isEnabled = deps.isEnabled ?? (async () => {
    const { getValve, VALVE_KEYS } = await import('./team.server')
    return getValve(VALVE_KEYS.socialMetricsSweep)
  })
  if (!(await isEnabled())) return { ranAt, skipped: 'valve_off' }

  const captureInstagram = deps.captureInstagram ?? captureInstagramEngagement
  const captureX = deps.captureX ?? captureXEngagement
  const captureAccount = deps.captureAccount ?? captureInstagramAccount
  const xMaxReadsMonth = deps.xMaxReadsMonth
    ?? (() => numericSetting(X_METRICS_MAX_READS_MONTH_KEY, X_METRICS_MAX_READS_MONTH_DEFAULT))
  const xReadsThisMonth = deps.xReadsThisMonth ?? kvReadsThisMonth
  const recordXReads = deps.recordXReads ?? kvRecordReads
  // The Phase 4 writes default to the live database only when the caller left
  // the matching read path live too. A caller that injected a repo or an
  // account capture owns the data layer, and a default that still reached
  // Neon behind an injected double would be a test touching production.
  const backfillPermalink = deps.backfillPermalink ?? ((platform: SweepPlatform) => {
    const injected = platform === 'instagram' ? deps.instagramRepo : deps.xRepo
    return injected ? Promise.resolve(undefined) : backfillPermalinks(platform, { now })
  })
  const appendFollowerHistory = deps.appendFollowerHistory
    ?? (deps.captureAccount ? async () => {} : dbAppendFollowerHistory)

  const result: SocialMetricsSweepResult = { ranAt }

  // Permalink backfill is best-effort and never fails a platform block: the
  // numbers are the job, the URL is a convenience.
  const backfill = async (platform: SweepPlatform, block: SweepPlatformResult | undefined) => {
    if (!block || block.skipped === 'threw') return
    try {
      const n = await backfillPermalink(platform)
      if (n !== undefined) block.permalinksBackfilled = n
    } catch (err) {
      console.warn(`[social-metrics-sweep] ${platform} permalink backfill failed:`, err instanceof Error ? err.message : err)
    }
  }

  // Instagram: insights are free, so the only bound is the sample.
  try {
    const repo = deps.instagramRepo ?? makeWindowRepo('instagram', SWEEP_SAMPLE, now)
    result.instagram = summarize(await captureInstagram({ repo }))
  } catch (err) {
    result.instagram = { checked: 0, errors: 0, skipped: 'threw', detail: (err as Error).message }
  }
  await backfill('instagram', result.instagram)

  // X: metered. Reads left this month bound the sample; zero left means skip.
  const month = monthKey(now())
  const maxReads = Math.floor(await xMaxReadsMonth())
  const used = await xReadsThisMonth(month)
  const remaining = Math.max(0, maxReads - used)
  const xLimit = Math.min(SWEEP_SAMPLE, remaining)
  if (xLimit <= 0) {
    result.x = { checked: 0, errors: 0, skipped: 'read_cap_reached', readsUsedMonth: used, maxReadsMonth: maxReads }
  } else {
    try {
      const inner = deps.xRepo ?? makeWindowRepo('x', xLimit, now)
      // Count what was actually sent to X, not what came back: a tweet the
      // lookup reports gone was still a billed read.
      let sent = 0
      const counting: EngagementCaptureRepo = {
        recentPosted: async (limit) => {
          const rows = (await inner.recentPosted(limit)).filter(r => r.externalPostId).slice(0, xLimit)
          sent = rows.length
          return rows
        },
        ...(inner.persistMetrics ? { persistMetrics: inner.persistMetrics } : {}),
      }
      const report = await captureX({ repo: counting })
      await recordXReads(month, sent)
      result.x = { ...summarize(report), readsUsedMonth: used + sent, maxReadsMonth: maxReads }
    } catch (err) {
      result.x = {
        checked: 0, errors: 0, skipped: 'threw', detail: (err as Error).message,
        readsUsedMonth: used, maxReadsMonth: maxReads,
      }
    }
  }
  // X permalinks are arithmetic, not reads, so the cap does not apply; only
  // a thrown X block skips it, and then only because the block itself is gone.
  await backfill('x', result.x)

  // Follower reading: free, best-effort, isolated by contract.
  try {
    result.account = await captureAccount()
  } catch (err) {
    result.account = { error: (err as Error).message }
  }
  // The same reading, appended to the table the Studio's analytics view reads
  // (migration 084). The KV history the capture writes stays as it was.
  if (result.account.account) {
    const a = result.account.account
    try {
      await appendFollowerHistory({
        platform: 'instagram',
        capturedAt: now(),
        followers: a.followersCount ?? null,
        follows: a.followsCount ?? null,
        mediaCount: a.mediaCount ?? null,
      })
    } catch (err) {
      console.warn('[social-metrics-sweep] follower history append failed:', err instanceof Error ? err.message : err)
    }
  }

  return result
}
