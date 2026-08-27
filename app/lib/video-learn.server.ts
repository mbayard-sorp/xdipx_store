/**
 * Learn-mode attribution for the video program (ticket #5718): Instagram
 * numbers joined back to episode, series, formula, hook pattern, cast, and
 * placement role, so the writers room learns from data instead of vibes.
 *
 * ## The honest limits, binding on every consumer
 *
 * Instagram insights are PER-MEDIA. There is no per-second retention curve in
 * the free Graph API, so `avgPctViewed` (avg watch time over runtime) measures
 * THE HOOK, meaning scene 0, and nothing else with any specificity. Every
 * other scene is episode-level only: patterns emerge as correlations ACROSS
 * many episodes, never as per-episode scene attribution. Do not upgrade a
 * correlation into a claim.
 *
 * Rollups use MEDIANS, not means (one viral episode makes every mean
 * meaningless at 2/week), carry an explicit `n`, and flag `underpowered` below
 * MIN_EPISODES_FOR_SIGNAL. The UI renders no rollups at all below 5 posted
 * episodes and never a percentage for n under 3.
 */
import { desc, inArray, isNotNull } from 'drizzle-orm'
import { db } from './db.server'
import { videoEpisodes, videoJobs, videoSeries, socialPosts } from '../../db/schema'

export const MIN_EPISODES_FOR_SIGNAL = 5

export interface EpisodePerformance {
  episodeId: number
  seriesSlug: string | null
  label: string
  logline: string
  formula: string
  hookPattern: string | null
  hookText: string | null
  arcPosition: string
  castSlugs: string[]
  productHandles: string[]
  placementRoles: string[]
  modelTier: string | null
  costUsd: number | null
  postedAt: string | null
  runtimeSeconds: number | null
  reach: number | null
  saves: number | null
  comments: number | null
  plays: number | null
  avgWatchTimeMs: number | null
  /** avgWatchTimeMs / runtimeMs. THE hook signal; null when either side is missing. */
  avgPctViewed: number | null
  /** True when the sweep has not landed numbers yet: render "not yet swept", never 0. */
  unswept: boolean
}

/** One row per episode that has an Instagram post, newest first. */
export async function listEpisodePerformance(opts: { limit?: number } = {}): Promise<EpisodePerformance[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 200)
  const episodes = await db.select().from(videoEpisodes)
    .where(isNotNull(videoEpisodes.videoJobId))
    .orderBy(desc(videoEpisodes.seasonNumber), desc(videoEpisodes.episodeNumber))
    .limit(limit)
  if (!episodes.length) return []

  const seriesRows = await db.select().from(videoSeries)
    .where(inArray(videoSeries.id, [...new Set(episodes.map(e => e.seriesId))]))
  const seriesById = new Map(seriesRows.map(s => [s.id, s.slug]))

  const jobIds = episodes.map(e => e.videoJobId).filter((id): id is number => id != null)
  const jobs = jobIds.length ? await db.select().from(videoJobs).where(inArray(videoJobs.id, jobIds)) : []
  const jobById = new Map(jobs.map(j => [j.id, j]))

  const episodeIds = episodes.map(e => e.id)
  const posts = await db.select({
    episodeId: socialPosts.episodeId,
    videoJobId: socialPosts.videoJobId,
    platform: socialPosts.platform,
    status: socialPosts.status,
    postedAt: socialPosts.postedAt,
    metricsJson: socialPosts.metricsJson,
  }).from(socialPosts).where(inArray(socialPosts.episodeId, episodeIds))

  const out: EpisodePerformance[] = []
  for (const ep of episodes) {
    const igPost = posts.find(p => p.episodeId === ep.id && p.platform === 'instagram' && p.status === 'posted')
    if (!igPost) continue
    const job = ep.videoJobId != null ? jobById.get(ep.videoJobId) : undefined
    const m = igPost.metricsJson ?? {}
    // Runtime from the job's scenes (the sum) or the final asset duration is
    // not joined here; scenes are the deterministic source at this layer.
    const scenes = job?.scenesJson ?? []
    const runtimeSeconds = scenes.length
      ? scenes.reduce((sum, sc) => sum + (typeof sc.durationSeconds === 'number' ? sc.durationSeconds : 0), 0)
      : (typeof job?.scriptJson?.['durationSeconds'] === 'number' ? job.scriptJson['durationSeconds'] as number : null)
    const avgWatchTimeMs = typeof m['avgWatchTimeMs'] === 'number' ? m['avgWatchTimeMs'] : null
    const unswept = Object.keys(m).length === 0
    out.push({
      episodeId: ep.id,
      seriesSlug: seriesById.get(ep.seriesId) ?? null,
      label: `S${ep.seasonNumber}E${ep.episodeNumber}`,
      logline: ep.logline,
      formula: ep.formula,
      hookPattern: ep.hookPattern,
      hookText: ep.hookText,
      arcPosition: ep.arcPosition,
      castSlugs: ep.castSlugs ?? [],
      productHandles: (ep.productPlacements ?? []).map(pl => pl.handle),
      placementRoles: (ep.productPlacements ?? []).map(pl => pl.role),
      modelTier: ep.modelTier,
      costUsd: ep.actualCostUsd != null ? Number(ep.actualCostUsd) : ep.estCostUsd != null ? Number(ep.estCostUsd) : null,
      postedAt: igPost.postedAt?.toISOString() ?? null,
      runtimeSeconds,
      reach: typeof m['reach'] === 'number' ? m['reach'] : null,
      saves: typeof m['saved'] === 'number' ? m['saved'] : null,
      comments: typeof m['comments'] === 'number' ? m['comments'] : null,
      plays: typeof m['plays'] === 'number' ? m['plays'] : null,
      avgWatchTimeMs,
      avgPctViewed: avgWatchTimeMs != null && runtimeSeconds ? Math.round((avgWatchTimeMs / (runtimeSeconds * 1000)) * 1000) / 10 : null,
      unswept,
    })
  }
  return out
}

export type LearnDimension = 'formula' | 'hookPattern' | 'castSlug' | 'productHandle' | 'placementRole' | 'arcPosition'

export interface DimensionRollup {
  dimension: LearnDimension
  value: string
  n: number
  medianSaves: number | null
  medianReach: number | null
  medianAvgPctViewed: number | null
  /** Below MIN_EPISODES_FOR_SIGNAL: shown, but flagged too small to act on. */
  underpowered: boolean
}

function median(values: number[]): number | null {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2
}

/** Pure rollup: group measured episodes by one dimension, medians only. */
export function rollupByDimension(rows: EpisodePerformance[], dimension: LearnDimension): DimensionRollup[] {
  const groups = new Map<string, EpisodePerformance[]>()
  const keysOf = (r: EpisodePerformance): string[] => {
    switch (dimension) {
      case 'formula': return [r.formula]
      case 'hookPattern': return r.hookPattern ? [r.hookPattern] : []
      case 'castSlug': return r.castSlugs
      case 'productHandle': return r.productHandles
      case 'placementRole': return r.placementRoles
      case 'arcPosition': return [r.arcPosition]
    }
  }
  for (const row of rows) {
    if (row.unswept) continue
    for (const key of keysOf(row)) {
      const g = groups.get(key) ?? []
      g.push(row)
      groups.set(key, g)
    }
  }
  return [...groups.entries()]
    .map(([value, g]): DimensionRollup => ({
      dimension,
      value,
      n: g.length,
      medianSaves: median(g.map(r => r.saves ?? NaN)),
      medianReach: median(g.map(r => r.reach ?? NaN)),
      medianAvgPctViewed: median(g.map(r => r.avgPctViewed ?? NaN)),
      underpowered: g.length < MIN_EPISODES_FOR_SIGNAL,
    }))
    .sort((a, b) => (b.medianSaves ?? -1) - (a.medianSaves ?? -1))
}
