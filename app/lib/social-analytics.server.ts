/**
 * Social Studio analytics reader (Phase 6a, ticket #4914).
 *
 * Read-only. Reads the posted `social_posts` rows in the window, normalises
 * each row's `metrics_json` (written by the six-hourly sweep in
 * `social-metrics-sweep.server.ts`), totals per platform, and returns the
 * follower series from `social_follower_history` (migration 084), falling
 * back to the KV history the capture wrote before that table existed. Never
 * calls a platform API and never writes.
 */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts, socialFollowerHistory } from '../../db/schema'
import { livePostUrl, isVideoPost } from '~/components/admin/social/types'
import {
  normaliseMetrics,
  interactionsOf,
  hasAnyMetric,
  captionSnippet,
  type AnalyticsPlatform,
  type AnalyticsRange,
  type AnalyticsSort,
  type NormalisedMetrics,
} from './social-analytics'
import type { FollowerReading } from './social-engagement.server'

export interface AnalyticsPost {
  id: number
  platform: string
  postedAt: string | null
  caption: string
  /** First media url, or the poster for a video. Null when the row has no media. */
  thumbUrl: string | null
  isVideo: boolean
  permalink: string | null
  metrics: NormalisedMetrics
  interactions: number
  hasMetrics: boolean
  /** The capture does not stamp a time on `metrics_json`; null until it does. */
  metricsUpdatedAt: string | null
}

export interface PlatformTotals {
  platform: AnalyticsPlatform
  posts: number
  withMetrics: number
  interactions: number
  avgPerPost: number
}

export interface FollowerPoint { at: string; followers: number }

export interface FollowerSeries {
  platform: AnalyticsPlatform
  points: FollowerPoint[]
  current: number | null
  delta: number | null
  source: 'table' | 'kv' | 'none'
}

export type EmptyCause = 'no_posts' | 'not_captured' | 'sweep_off' | null

export interface SocialAnalytics {
  range: AnalyticsRange
  platform: AnalyticsPlatform | 'all'
  sort: AnalyticsSort
  since: string
  posts: AnalyticsPost[]
  totals: PlatformTotals[]
  best: AnalyticsPost | null
  followers: FollowerSeries[]
  sweepEnabled: boolean
  emptyCause: EmptyCause
}

export interface LoadSocialAnalyticsArgs {
  days: AnalyticsRange
  platform?: AnalyticsPlatform | 'all'
  sort?: AnalyticsSort
  now?: Date
}

const PLATFORMS: AnalyticsPlatform[] = ['instagram', 'x']

function sortPosts(posts: AnalyticsPost[], sort: AnalyticsSort): AnalyticsPost[] {
  const byRecent = (a: AnalyticsPost, b: AnalyticsPost) => (b.postedAt ?? '').localeCompare(a.postedAt ?? '')
  const num = (f: (p: AnalyticsPost) => number | null) => (a: AnalyticsPost, b: AnalyticsPost) =>
    ((f(b) ?? -1) - (f(a) ?? -1)) || byRecent(a, b)
  switch (sort) {
    case 'recent':   return [...posts].sort(byRecent)
    case 'likes':    return [...posts].sort(num(p => p.metrics.likes))
    case 'comments': return [...posts].sort(num(p => p.metrics.comments))
    case 'saves':    return [...posts].sort(num(p => p.metrics.saves))
    case 'views':    return [...posts].sort(num(p => p.metrics.views ?? p.metrics.impressions))
    default:         return [...posts].sort(num(p => (p.hasMetrics ? p.interactions : null)))
  }
}

async function followerSeriesFor(platform: AnalyticsPlatform, since: Date): Promise<FollowerSeries> {
  const rows = await db
    .select({ at: socialFollowerHistory.capturedAt, followers: socialFollowerHistory.followers })
    .from(socialFollowerHistory)
    .where(and(eq(socialFollowerHistory.platform, platform), gte(socialFollowerHistory.capturedAt, since)))
    .orderBy(asc(socialFollowerHistory.capturedAt))

  let points: FollowerPoint[] = rows
    .filter(r => r.followers != null)
    .map(r => ({ at: r.at.toISOString(), followers: r.followers as number }))
  let source: FollowerSeries['source'] = points.length ? 'table' : 'none'

  // Before migration 084 the capture wrote the Instagram history to KV only.
  if (!points.length && platform === 'instagram') {
    try {
      const { kvGet, KV_KEYS } = await import('./kv.server')
      const prior = (await kvGet<FollowerReading[]>(KV_KEYS.socialFollowerHistory)) ?? []
      points = prior
        .filter(r => typeof r.followersCount === 'number' && new Date(r.ts).getTime() >= since.getTime())
        .map(r => ({ at: r.ts, followers: r.followersCount as number }))
      if (points.length) source = 'kv'
    } catch {
      // KV is a fallback, not a dependency; an unreachable KV is an empty series.
    }
  }

  const first = points[0]?.followers ?? null
  const current = points[points.length - 1]?.followers ?? null
  return {
    platform,
    points,
    current,
    delta: first != null && current != null ? current - first : null,
    source,
  }
}

export async function loadSocialAnalytics(args: LoadSocialAnalyticsArgs): Promise<SocialAnalytics> {
  const now = args.now ?? new Date()
  const platform = args.platform ?? 'all'
  const sort = args.sort ?? 'best'
  const since = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000)
  const wanted = platform === 'all' ? PLATFORMS : [platform]

  const [rows, sweepEnabled, followers] = await Promise.all([
    db
      .select({
        id: socialPosts.id,
        platform: socialPosts.platform,
        externalPostId: socialPosts.externalPostId,
        tweetText: socialPosts.tweetText,
        editedText: socialPosts.editedText,
        mediaUrls: socialPosts.mediaUrls,
        posterUrl: socialPosts.posterUrl,
        videoJobId: socialPosts.videoJobId,
        postedAt: socialPosts.postedAt,
        permalink: socialPosts.permalink,
        metricsJson: socialPosts.metricsJson,
      })
      .from(socialPosts)
      .where(and(
        eq(socialPosts.status, 'posted'),
        inArray(socialPosts.platform, wanted),
        gte(socialPosts.postedAt, since),
      ))
      .orderBy(desc(socialPosts.postedAt)),
    (async () => {
      const { getValve, VALVE_KEYS } = await import('./team.server')
      return getValve(VALVE_KEYS.socialMetricsSweep).catch(() => false)
    })(),
    Promise.all(wanted.map(p => followerSeriesFor(p, since))),
  ])

  const posts: AnalyticsPost[] = rows.map(r => {
    const metrics = normaliseMetrics(r.platform, r.metricsJson)
    const video = isVideoPost({ videoJobId: r.videoJobId, mediaUrls: r.mediaUrls })
    return {
      id: r.id,
      platform: r.platform,
      postedAt: r.postedAt ? r.postedAt.toISOString() : null,
      caption: captionSnippet(r.editedText?.trim() || r.tweetText),
      thumbUrl: (video ? r.posterUrl : null) ?? r.mediaUrls?.[0] ?? r.posterUrl ?? null,
      isVideo: video,
      permalink: livePostUrl({
        platform: r.platform,
        externalPostId: r.externalPostId,
        status: 'posted',
        permalink: r.permalink,
      }),
      metrics,
      interactions: interactionsOf(metrics, r.metricsJson),
      hasMetrics: hasAnyMetric(metrics),
      metricsUpdatedAt: null,
    }
  })

  const totals: PlatformTotals[] = wanted.map(p => {
    const mine = posts.filter(x => x.platform === p)
    const measured = mine.filter(x => x.hasMetrics)
    const interactions = measured.reduce((s, x) => s + x.interactions, 0)
    return {
      platform: p,
      posts: mine.length,
      withMetrics: measured.length,
      interactions,
      avgPerPost: measured.length ? Math.round((interactions / measured.length) * 10) / 10 : 0,
    }
  })

  const sorted = sortPosts(posts, sort)
  const best = [...posts].filter(x => x.hasMetrics).sort((a, b) => b.interactions - a.interactions)[0] ?? null

  let emptyCause: EmptyCause = null
  if (!posts.length) emptyCause = 'no_posts'
  else if (!posts.some(x => x.hasMetrics)) emptyCause = sweepEnabled ? 'not_captured' : 'sweep_off'

  return {
    range: args.days,
    platform,
    sort,
    since: since.toISOString(),
    posts: sorted,
    totals,
    best,
    followers,
    sweepEnabled,
    emptyCause,
  }
}
