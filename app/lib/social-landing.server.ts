/**
 * Server-only helpers for the `/social` bio-link landing.
 *
 * The swappable product grid on `/social` is fed by the store's own recent
 * social activity, not a hand-maintained list. Every product-featuring post
 * that actually went out (status `posted`) inside the recent window is a
 * candidate, and there are two ways a row carries its product handle:
 *
 *   1. Video-backed posts: a video job fans out to one `social_posts` row
 *      per platform, and the handle lives on `video_jobs.productHandle`.
 *   2. Everything else (ticket #3348): the live Instagram feed is mostly
 *      manually-drafted image/carousel posts with no `video_job_id`, so the
 *      join above never sees them. Those posts still carry a handle, just
 *      not in a column, the pre-publish gate stamps it into
 *      `social_posts.feedback` (see `formatGateStamp` / `parseGateStamp` in
 *      `social-publish-approve.server.ts`), the same trick used at publish
 *      time to carry the handle from approval to the publish tick. Adding a
 *      real `featured_product_handle` column is a migration and a protected
 *      path; reading the stamp that already exists is not.
 *
 * The daily social routine writes `social_posts` and this page reads them, so
 * the landing stays honest by construction with no manual sync to drift.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts, videoJobs } from '../../db/schema'
import { parseGateStamp } from './social-publish-approve.server'

const RECENT_WINDOW_DAYS = 7

/**
 * Handles of products featured in social posts that were POSTED within the last
 * `windowDays`, most-recently-posted first, de-duplicated (one product can be
 * posted to several platforms). Returns at most `limit` handles. Existence,
 * availability, and copy are resolved by the caller against the discovery
 * index, so a handle here is a candidate, not a guarantee.
 */
export async function getRecentSocialProductHandles(
  limit: number,
  windowDays: number = RECENT_WINDOW_DAYS,
): Promise<string[]> {
  if (limit <= 0) return []
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      handle: videoJobs.productHandle,
      feedback: socialPosts.feedback,
      postedAt: socialPosts.postedAt,
    })
    .from(socialPosts)
    .leftJoin(videoJobs, eq(socialPosts.videoJobId, videoJobs.id))
    .where(
      and(
        eq(socialPosts.status, 'posted'),
        isNotNull(socialPosts.postedAt),
        gte(socialPosts.postedAt, since),
      ),
    )
    .orderBy(desc(socialPosts.postedAt))

  const seen = new Set<string>()
  const handles: string[] = []
  for (const row of rows) {
    const handle = row.handle?.trim() || parseGateStamp(row.feedback)?.productHandle?.trim() || null
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    handles.push(handle)
    if (handles.length >= limit) break
  }
  return handles
}
