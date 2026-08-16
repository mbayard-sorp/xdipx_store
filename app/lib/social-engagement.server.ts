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
 * ## Why this only reports and never writes
 *
 * `social_posts` has no engagement column. The precedent this should follow
 * once one exists is `video_jobs.metricsJson` + `recordVideoMetrics` in
 * `video-pipeline.server.ts`: a per-platform JSON merge, submitted fields only
 * overwrite, nothing is ever estimated. Adding that column
 * (`social_posts.metrics_json jsonb`) is a migration, and `db/migrations/**`
 * plus `db/schema.ts` are protected paths, so this module cannot write it.
 *
 * So `captureInstagramEngagement` below is a pure read: it fetches live
 * numbers for recently-posted rows and returns them. Nothing here persists.
 * The moment the deferred migration lands, the missing half is one line per
 * row: `db.update(socialPosts).set({ metricsJson: merged }).where(...)`,
 * merged the same way `recordVideoMetrics` merges, see that function for the
 * exact shape to copy.
 *
 * Exposed read-only today via `POST /api/team/social-post { op: 'engagement' }`
 * so the social retro can read real numbers now rather than wait on the
 * migration to be worth building at all.
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
 * Read-only engagement sweep over the most recently posted Instagram rows.
 * Fetches live numbers; persists nothing (see module header). Safe to call
 * on demand, it makes at most `CAPTURE_SAMPLE` API calls and never writes.
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
    report.push(
      result.ok
        ? { postId: row.id, externalPostId: row.externalPostId, metrics: result.metrics }
        : { postId: row.id, externalPostId: row.externalPostId, error: result.detail },
    )
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
