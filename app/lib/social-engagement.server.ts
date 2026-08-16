/**
 * Instagram engagement capture (ticket #2742).
 *
 * Under autopublish (owner direction 2026-08-11) the team lost the
 * draft-review signal entirely: no `review_status` triage and no
 * `editedText` self-report, because nothing is left for the owner to review
 * or rewrite before it ships. Engagement is the replacement signal: it says
 * which ANGLE landed with real people, independent of whether the owner
 * happened to notice.
 *
 * Reuses the removal watcher's (`social-removal-watch.server.ts`) Graph API
 * conventions rather than inventing new ones: same `igRequest` /
 * `describeInstagramApiError` from `social-publish/instagram.server.ts`, same
 * token-from-env guard, same bounded per-tick sample size, same "return a
 * report, let the caller decide" shape.
 *
 * ## Persistence (migration 079)
 *
 * `social_posts.metrics_json` exists since migration 079 (owner-applied
 * 2026-08-16, ticket #3536). `captureInstagramEngagement` now merges each
 * successful fetch into that column field-level, following the
 * `recordVideoMetrics` precedent in `video-pipeline.server.ts`: fetched
 * fields overwrite, absent fields keep their previous value, nothing is ever
 * estimated. The write path lives on the repo (`persistMetrics`), so
 * read-only callers and tests can still run the sweep without a database.
 *
 * Exposed via `POST /api/team/social-post { op: 'engagement' }` for the
 * social retro; each call also refreshes the stored history.
 *
 * Saves matter more than likes here: the carousel format is explicitly built
 * for saves (per the voice charter), and capped/algorithmic distribution
 * makes reach a poor quality proxy. `rankBySaves` reflects that.
 */

import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { igRequest, describeInstagramApiError } from './social-publish/instagram.server'

export interface InstagramEngagementMetrics {
  reach?: number
  likes?: number
  comments?: number
  saved?: number
}

/** The four fields the ticket names: reach, likes, comments, saves. */
const INSIGHTS_METRICS = 'reach,likes,comments,saved'

interface InsightEntry {
  name?: string
  values?: Array<{ value?: number }>
}

/**
 * Live Graph API insights for one published Instagram media id. A pure
 * read, see module header for why nothing here is stored.
 */
export async function fetchInstagramEngagement(
  mediaId: string,
): Promise<{ ok: true; metrics: InstagramEngagementMetrics } | { ok: false; detail: string }> {
  const token = process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
  if (!token) return { ok: false, detail: 'Instagram keys are not configured' }

  const res = await igRequest(`/${mediaId}/insights`, {
    method: 'GET',
    params: { metric: INSIGHTS_METRICS },
    token,
  })
  if (!res.ok) return { ok: false, detail: describeInstagramApiError(res.error) }

  const entries = (res.data['data'] as InsightEntry[] | undefined) ?? []
  const metrics: InstagramEngagementMetrics = {}
  for (const entry of entries) {
    const value = entry.values?.[0]?.value
    if (typeof value !== 'number') continue
    if (entry.name === 'reach') metrics.reach = value
    else if (entry.name === 'likes') metrics.likes = value
    else if (entry.name === 'comments') metrics.comments = value
    else if (entry.name === 'saved') metrics.saved = value
  }
  return { ok: true, metrics }
}

export interface EngagementCaptureRow {
  id: number
  externalPostId: string | null
  postedAt: Date | null
}

export interface EngagementCaptureRepo {
  /** Newest posted Instagram rows, most-recently-posted first. */
  recentPosted: (limit: number) => Promise<EngagementCaptureRow[]>
  /**
   * Field-level merge of freshly fetched metrics into `metrics_json`
   * (migration 079); fetched fields overwrite, absent fields keep their
   * previous value, mirroring `recordVideoMetrics`. Optional so read-only
   * callers and existing test doubles stay valid.
   */
  persistMetrics?: (id: number, metrics: InstagramEngagementMetrics) => Promise<void>
}

export const dbEngagementCaptureRepo: EngagementCaptureRepo = {
  recentPosted: async (limit) => {
    return db
      .select({
        id: socialPosts.id,
        externalPostId: socialPosts.externalPostId,
        postedAt: socialPosts.postedAt,
      })
      .from(socialPosts)
      .where(and(
        eq(socialPosts.platform, 'instagram'),
        eq(socialPosts.status, 'posted'),
        isNotNull(socialPosts.externalPostId),
      ))
      .orderBy(desc(socialPosts.postedAt))
      .limit(limit)
  },
  persistMetrics: async (id, metrics) => {
    const submitted = Object.fromEntries(
      Object.entries(metrics).filter(([, v]) => v !== undefined),
    ) as Record<string, number>
    if (!Object.keys(submitted).length) return
    const [row] = await db.select({ metricsJson: socialPosts.metricsJson })
      .from(socialPosts).where(eq(socialPosts.id, id)).limit(1)
    if (!row) return
    await db.update(socialPosts)
      .set({ metricsJson: { ...(row.metricsJson ?? {}), ...submitted } })
      .where(eq(socialPosts.id, id))
  },
}

/**
 * Most recent posts checked per sweep, mirroring the removal watcher's
 * `WATCH_SAMPLE`: one Graph call each, so this is a real cost worth bounding,
 * and recent posts are where a fresh angle either landed or didn't.
 */
export const CAPTURE_SAMPLE = 8

export interface EngagementReportRow {
  postId: number
  externalPostId: string
  metrics?: InstagramEngagementMetrics
  /** Set when the fetch failed; `metrics` is absent in that case. */
  error?: string
}

export interface EngagementCaptureDeps {
  repo?: EngagementCaptureRepo
  fetchEngagement?: (mediaId: string) => ReturnType<typeof fetchInstagramEngagement>
}

/**
 * Engagement sweep over the most recently posted Instagram rows. Fetches
 * live numbers, merges them into `metrics_json` when the repo can persist
 * (see module header), and returns the report. Makes at most
 * `CAPTURE_SAMPLE` API calls.
 */
export async function captureInstagramEngagement(
  deps: EngagementCaptureDeps = {},
): Promise<EngagementReportRow[]> {
  const repo = deps.repo ?? dbEngagementCaptureRepo
  const fetchEngagement = deps.fetchEngagement ?? fetchInstagramEngagement

  const rows = await repo.recentPosted(CAPTURE_SAMPLE)
  const report: EngagementReportRow[] = []
  for (const row of rows) {
    if (!row.externalPostId) continue
    const result = await fetchEngagement(row.externalPostId)
    if (result.ok) {
      await repo.persistMetrics?.(row.id, result.metrics)
      report.push({ postId: row.id, externalPostId: row.externalPostId, metrics: result.metrics })
    } else {
      report.push({ postId: row.id, externalPostId: row.externalPostId, error: result.detail })
    }
  }
  return report
}

/**
 * Saves-first ranking for the retro. Reach and likes are shown, but the
 * charter's carousel format is built for saves, and capped distribution
 * makes reach a weak signal of quality; a row with no metrics (an error, or
 * a zero-save post) sorts last.
 */
export function rankBySaves(report: EngagementReportRow[]): EngagementReportRow[] {
  return [...report].sort((a, b) => (b.metrics?.saved ?? -1) - (a.metrics?.saved ?? -1))
}
