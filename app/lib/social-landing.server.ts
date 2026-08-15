/**
 * Server-only helpers for the `/social` bio-link landing.
 *
 * The swappable product grid on `/social` is fed by the store's own recent
 * social activity, not a hand-maintained list. A video job fans out to one
 * `social_posts` row per platform carrying `video_jobs.productHandle`, so any
 * product-featuring post that actually went out (status `posted`) inside the
 * recent window is a candidate. The daily social routine writes `social_posts`
 * and this page reads them, so the landing stays honest by construction with no
 * manual sync to drift.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts, videoJobs } from '../../db/schema'

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
    .select({ handle: videoJobs.productHandle, postedAt: socialPosts.postedAt })
    .from(socialPosts)
    .innerJoin(videoJobs, eq(socialPosts.videoJobId, videoJobs.id))
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
    const handle = row.handle?.trim()
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    handles.push(handle)
    if (handles.length >= limit) break
  }
  return handles
}
