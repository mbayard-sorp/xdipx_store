/**
 * Learn-mode attribution for the video program (ticket #5718, reworked for
 * Phase 2b of the video program v2 plan): posted-clip numbers joined back to
 * the episode, grouped by `speaker` and `format`, plus per-batch process
 * signals from the owner's own review behaviour.
 *
 * ## Primary metric: reach, not saves
 *
 * The season's job is acquisition, so the primary number is Instagram
 * `reach` from the linked social_posts row, falling back to X `impressions`
 * when there is no measured IG post. The two are never summed. Saves stay on
 * the row as a secondary signal. `arcPosition` is gone: The Group Chat is
 * shelved and a standalone product-talk clip has no arc.
 *
 * ## The honest limits, binding on every consumer
 *
 * Instagram insights are PER-MEDIA. There is no per-second retention curve in
 * the free Graph API, so `avgPctViewed` measures THE HOOK and nothing else
 * with any specificity. Patterns emerge as correlations ACROSS many clips,
 * never as per-clip attribution. Do not upgrade a correlation into a claim.
 *
 * Rollups use MEDIANS (one viral clip makes every mean meaningless at 1 to 3
 * a week), carry an explicit `n`, and flag `underpowered` below
 * MIN_EPISODES_FOR_SIGNAL.
 */
import { and, desc, inArray, isNotNull, notInArray } from 'drizzle-orm'
import { db } from './db.server'
import { videoEpisodes, videoJobs, videoScriptEdits, socialPosts } from '../../db/schema'
import { ROOM_EDITORS } from './video-episodes'
import {
  MIN_EPISODES_FOR_SIGNAL,
  UNSPECIFIED,
  computeBatchSignals,
  episodeFormat,
  episodeSpeaker,
  learnFlags,
  median,
  primaryReachOf,
  type BatchEpisodeInput,
  type BatchSignals,
  type LearnFlag,
} from './video-learn-signals'

export { MIN_EPISODES_FOR_SIGNAL }

export interface EpisodePerformance {
  episodeId: number
  label: string
  logline: string
  hookText: string | null
  speaker: string
  format: string
  productHandles: string[]
  modelTier: string | null
  costUsd: number | null
  postedAt: string | null
  runtimeSeconds: number | null
  /** IG reach, else X impressions. The number rollups sort on. */
  primaryReach: number | null
  primaryReachSource: 'ig_reach' | 'x_impressions' | null
  reach: number | null
  impressions: number | null
  saves: number | null
  comments: number | null
  plays: number | null
  avgWatchTimeMs: number | null
  /** avgWatchTimeMs / runtimeMs. THE hook signal; null when either side is missing. */
  avgPctViewed: number | null
  /** True when no linked post carries any numbers yet: render "not yet swept", never 0. */
  unswept: boolean
}

/** One row per episode with a posted IG or X post, newest first. */
export async function listEpisodePerformance(opts: { limit?: number } = {}): Promise<EpisodePerformance[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 200)
  const episodes = await db.select().from(videoEpisodes)
    .where(isNotNull(videoEpisodes.videoJobId))
    .orderBy(desc(videoEpisodes.seasonNumber), desc(videoEpisodes.episodeNumber))
    .limit(limit)
  if (!episodes.length) return []

  const jobIds = episodes.map(e => e.videoJobId).filter((id): id is number => id != null)
  const jobs = jobIds.length ? await db.select().from(videoJobs).where(inArray(videoJobs.id, jobIds)) : []
  const jobById = new Map(jobs.map(j => [j.id, j]))

  const posts = await db.select({
    episodeId: socialPosts.episodeId,
    platform: socialPosts.platform,
    status: socialPosts.status,
    postedAt: socialPosts.postedAt,
    metricsJson: socialPosts.metricsJson,
  }).from(socialPosts).where(inArray(socialPosts.episodeId, episodes.map(e => e.id)))

  const out: EpisodePerformance[] = []
  for (const ep of episodes) {
    const mine = posts.filter(p => p.episodeId === ep.id && p.status === 'posted')
    const igPost = mine.find(p => p.platform === 'instagram')
    const xPost = mine.find(p => p.platform === 'x')
    if (!igPost && !xPost) continue
    const ig = igPost?.metricsJson ?? null
    const x = xPost?.metricsJson ?? null
    const { value: primaryReach, source: primaryReachSource } = primaryReachOf(ig, x)
    const job = ep.videoJobId != null ? jobById.get(ep.videoJobId) : undefined
    const scenes = job?.scenesJson ?? []
    const runtimeSeconds = scenes.length
      ? scenes.reduce((sum, sc) => sum + (typeof sc.durationSeconds === 'number' ? sc.durationSeconds : 0), 0)
      : (typeof job?.scriptJson?.['durationSeconds'] === 'number' ? job.scriptJson['durationSeconds'] as number : null)
    const num = (m: Record<string, number> | null, k: string): number | null =>
      m && typeof m[k] === 'number' ? m[k] : null
    const avgWatchTimeMs = num(ig, 'avgWatchTimeMs')
    const postedAt = ep.postedAt ?? igPost?.postedAt ?? xPost?.postedAt ?? null
    out.push({
      episodeId: ep.id,
      label: `S${ep.seasonNumber}E${ep.episodeNumber}`,
      logline: ep.logline,
      hookText: ep.hookText,
      speaker: episodeSpeaker(ep.scriptJson) ?? UNSPECIFIED,
      format: episodeFormat(ep.scriptJson) ?? UNSPECIFIED,
      productHandles: (ep.productPlacements ?? []).map(pl => pl.handle),
      modelTier: ep.modelTier,
      costUsd: ep.actualCostUsd != null ? Number(ep.actualCostUsd) : ep.estCostUsd != null ? Number(ep.estCostUsd) : null,
      postedAt: postedAt?.toISOString() ?? null,
      runtimeSeconds,
      primaryReach,
      primaryReachSource,
      reach: num(ig, 'reach'),
      impressions: num(x, 'impressions'),
      saves: num(ig, 'saved') ?? num(x, 'bookmarks'),
      comments: num(ig, 'comments') ?? num(x, 'replies'),
      plays: num(ig, 'plays'),
      avgWatchTimeMs,
      avgPctViewed: avgWatchTimeMs != null && runtimeSeconds ? Math.round((avgWatchTimeMs / (runtimeSeconds * 1000)) * 1000) / 10 : null,
      unswept: Object.keys(ig ?? {}).length === 0 && Object.keys(x ?? {}).length === 0,
    })
  }
  return out
}

export type LearnDimension = 'speaker' | 'format' | 'product'
export const LEARN_DIMENSIONS: readonly LearnDimension[] = ['speaker', 'format', 'product']

export interface DimensionRollup {
  dimension: LearnDimension
  value: string
  n: number
  medianPrimaryReach: number | null
  medianSaves: number | null
  medianAvgPctViewed: number | null
  /** Below MIN_EPISODES_FOR_SIGNAL: shown, but flagged too small to act on. */
  underpowered: boolean
}

/**
 * Pure rollup: group measured clips by one dimension, medians only, sorted by
 * median reach. 'product' is multi-valued: a clip with two handles counts in
 * both product groups.
 */
export function rollupByDimension(rows: EpisodePerformance[], dimension: LearnDimension): DimensionRollup[] {
  const groups = new Map<string, EpisodePerformance[]>()
  for (const row of rows) {
    if (row.unswept) continue
    const keys = dimension === 'product' ? row.productHandles : [row[dimension]]
    for (const key of keys) {
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
      medianPrimaryReach: median(g.map(r => r.primaryReach ?? NaN)),
      medianSaves: median(g.map(r => r.saves ?? NaN)),
      medianAvgPctViewed: median(g.map(r => r.avgPctViewed ?? NaN)),
      underpowered: g.length < MIN_EPISODES_FOR_SIGNAL,
    }))
    .sort((a, b) => (b.medianPrimaryReach ?? -1) - (a.medianPrimaryReach ?? -1))
}

/**
 * Per-batch process signals for the latest `batches` pitch batches (default
 * 8), oldest first, plus the threshold flags. Reads episodes by batch, their
 * spoken-field owner edits, and the frame re-roll count of every job each
 * episode rendered through (current and prior retakes).
 */
export async function listBatchSignals(opts: { batches?: number } = {}): Promise<{ batches: BatchSignals[]; flags: LearnFlag[] }> {
  const keep = Math.min(Math.max(1, opts.batches ?? 8), 26)
  const episodes = await db.select({
    id: videoEpisodes.id,
    batchId: videoEpisodes.batchId,
    createdAt: videoEpisodes.createdAt,
    approvedAt: videoEpisodes.approvedAt,
    reviewNotesJson: videoEpisodes.reviewNotesJson,
    scriptJson: videoEpisodes.scriptJson,
    videoJobId: videoEpisodes.videoJobId,
    priorJobIdsJson: videoEpisodes.priorJobIdsJson,
  }).from(videoEpisodes)
    .where(isNotNull(videoEpisodes.batchId))
    .orderBy(desc(videoEpisodes.createdAt))
    .limit(200)

  // Assumption: the newest 200 batched episodes cover the kept batches. At
  // 5 clips a batch that is 40 batches, well past the 26-batch ceiling; if
  // batches ever grow past ~7 clips, a kept batch near the tail could be
  // read partially and this cap must rise (or select batch ids first).
  const batchOrder: string[] = []
  for (const e of episodes) if (e.batchId && !batchOrder.includes(e.batchId)) batchOrder.push(e.batchId)
  const kept = new Set(batchOrder.slice(0, keep))
  const eps = episodes.filter(e => e.batchId != null && kept.has(e.batchId))
  if (!eps.length) return { batches: [], flags: learnFlags([]) }

  const epIds = eps.map(e => e.id)
  // The owner edit ratio measures the OWNER's hand on the script: the
  // video-room's own episode-revise writes are excluded here, and again in
  // episodeEditStats (belt and braces, and what the tests can observe).
  const edits = await db.select({
    episodeId: videoScriptEdits.episodeId,
    field: videoScriptEdits.field,
    before: videoScriptEdits.before,
    after: videoScriptEdits.after,
    editedBy: videoScriptEdits.editedBy,
    createdAt: videoScriptEdits.createdAt,
  }).from(videoScriptEdits).where(and(
    inArray(videoScriptEdits.episodeId, epIds),
    notInArray(videoScriptEdits.editedBy, [...ROOM_EDITORS]),
  ))

  const jobIdsOf = (e: (typeof eps)[number]): number[] => [
    ...(Array.isArray(e.priorJobIdsJson) ? e.priorJobIdsJson : []),
    ...(e.videoJobId != null ? [e.videoJobId] : []),
  ]
  const allJobIds = [...new Set(eps.flatMap(jobIdsOf))]
  const jobs = allJobIds.length
    ? await db.select({ id: videoJobs.id, scriptJson: videoJobs.scriptJson }).from(videoJobs).where(inArray(videoJobs.id, allJobIds))
    : []
  const retriesByJob = new Map(jobs.map(j => [j.id, Array.isArray(j.scriptJson?.frameFeedback) ? j.scriptJson.frameFeedback.length : 0]))

  const inputs: BatchEpisodeInput[] = eps.map(e => ({
    episodeId: e.id,
    batchId: e.batchId!,
    createdAt: e.createdAt,
    approvedAt: e.approvedAt,
    reviewNotes: e.reviewNotesJson ?? null,
    scriptJson: e.scriptJson ?? null,
    edits: edits.filter(x => x.episodeId === e.id),
    jobFrameRetries: jobIdsOf(e).map(id => retriesByJob.get(id)).filter((n): n is number => n != null),
  }))
  const batches = computeBatchSignals(inputs)
  return { batches, flags: learnFlags(batches) }
}
