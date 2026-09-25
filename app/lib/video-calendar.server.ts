/**
 * Video clips on the company calendar (video program v2, Phase 2b). Every
 * routine reads GET /api/team/calendar at run start; putting approved and
 * posted clips on it is what lets social, content and email build their week
 * around the clip instead of discovering it after the fact.
 *
 * Read-only over video_episodes and social_posts; no schema change.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts, videoEpisodes, videoJobs } from '../../db/schema'
import { episodeFormat, episodeSpeaker } from './video-learn-signals'

/** Statuses a clip is on the calendar in: owner-approved through posted. */
export const CALENDAR_CLIP_STATUSES = ['approved', 'rendering', 'rendered', 'scheduled', 'posted'] as const

export const DEFAULT_CLIP_WINDOW_DAYS = 14

export interface CalendarVideoClip {
  episodeId: number
  productHandle: string | null
  title: string
  speaker: string | null
  format: string | null
  status: string
  plannedSlotAt: string | null
  postedAt?: string
  permalink?: string
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Resolves the clip window. Explicit `from`/`to` (YYYY-MM-DD, already
 * validated by the route) win; a missing side defaults to 14 days back or
 * 14 days forward from `now`. `to` is inclusive of its whole day.
 */
export function clipWindow(from: string | undefined, to: string | undefined, now = new Date()): { start: Date; endExclusive: Date } {
  const day = 86_400_000
  const startDay = from ?? isoDay(new Date(now.getTime() - DEFAULT_CLIP_WINDOW_DAYS * day))
  const endDay = to ?? isoDay(new Date(now.getTime() + DEFAULT_CLIP_WINDOW_DAYS * day))
  return {
    start: new Date(`${startDay}T00:00:00.000Z`),
    endExclusive: new Date(new Date(`${endDay}T00:00:00.000Z`).getTime() + day),
  }
}

/**
 * Clips in the window, soonest first. A clip is in the window when its
 * posted time (else its planned slot) falls inside it. An approved clip with
 * NO slot yet and not posted is always included: it is the next thing to
 * ship, and hiding it because the owner has not picked a slot would make the
 * calendar silently miss the week's clip.
 */
export async function listCalendarVideoClips(from?: string, to?: string, now = new Date()): Promise<CalendarVideoClip[]> {
  const { start, endExclusive } = clipWindow(from, to, now)
  const when = sql`coalesce(${videoEpisodes.postedAt}, ${videoEpisodes.plannedSlotAt})`
  const episodes = await db.select({
    id: videoEpisodes.id,
    productionStatus: videoEpisodes.productionStatus,
    plannedSlotAt: videoEpisodes.plannedSlotAt,
    postedAt: videoEpisodes.postedAt,
    logline: videoEpisodes.logline,
    hookText: videoEpisodes.hookText,
    siteCutJson: videoEpisodes.siteCutJson,
    scriptJson: videoEpisodes.scriptJson,
    productPlacements: videoEpisodes.productPlacements,
    videoJobId: videoEpisodes.videoJobId,
  }).from(videoEpisodes)
    .where(and(
      inArray(videoEpisodes.productionStatus, [...CALENDAR_CLIP_STATUSES]),
      or(
        and(sql`${when} >= ${start.toISOString()}`, sql`${when} < ${endExclusive.toISOString()}`),
        and(isNull(videoEpisodes.plannedSlotAt), isNull(videoEpisodes.postedAt)),
      ),
    ))
    .orderBy(sql`${when} asc nulls last`, desc(videoEpisodes.id))
    .limit(100)
  if (!episodes.length) return []

  const ids = episodes.map(e => e.id)
  const posts = await db.select({
    episodeId: socialPosts.episodeId,
    platform: socialPosts.platform,
    postedAt: socialPosts.postedAt,
    permalink: socialPosts.permalink,
  }).from(socialPosts)
    .where(and(inArray(socialPosts.episodeId, ids), eq(socialPosts.status, 'posted')))

  // The job's product handle is the fallback when an episode carries no
  // placement (a product-talk clip always renders one product).
  const jobIds = episodes.map(e => e.videoJobId).filter((id): id is number => id != null)
  const jobs = jobIds.length
    ? await db.select({ id: videoJobs.id, productHandle: videoJobs.productHandle }).from(videoJobs).where(inArray(videoJobs.id, jobIds))
    : []
  const handleByJob = new Map(jobs.map(j => [j.id, j.productHandle]))

  return episodes.map(ep => {
    const mine = posts.filter(p => p.episodeId === ep.id)
    // Instagram first: it is the primary channel for clips.
    const post = mine.find(p => p.platform === 'instagram' && p.permalink) ?? mine.find(p => p.permalink) ?? mine[0]
    const postedAt = ep.postedAt ?? post?.postedAt ?? null
    const title = ep.siteCutJson?.title?.trim() || ep.hookText?.trim() || ep.logline
    return {
      episodeId: ep.id,
      productHandle: ep.productPlacements?.[0]?.handle ?? (ep.videoJobId != null ? handleByJob.get(ep.videoJobId) ?? null : null),
      title,
      speaker: episodeSpeaker(ep.scriptJson),
      format: episodeFormat(ep.scriptJson),
      status: ep.productionStatus,
      plannedSlotAt: ep.plannedSlotAt?.toISOString() ?? null,
      ...(postedAt ? { postedAt: postedAt.toISOString() } : {}),
      ...(post?.permalink ? { permalink: post.permalink } : {}),
    }
  })
}
