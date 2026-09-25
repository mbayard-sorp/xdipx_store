/**
 * Provider request id lookups for the video pipeline (ticket #11552).
 *
 * Every Atlas/fal/Wavespeed call the pipeline makes leaves a handle on
 * video_jobs.provider_request_ids (one per stage key: clip, clip_b, scene_0,
 * lipsync, ...) and, since migration 105, the request id on the media_assets
 * row it produced. These helpers turn a pasted request id back into the job,
 * episode, stage, tier and assets, and shape the handles for display.
 */
import { eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { videoJobs, mediaAssets, videoEpisodes } from '../../db/schema'
import { withoutRehostAttempts } from '~/lib/video-pipeline.server'

type Handles = typeof videoJobs.$inferSelect['providerRequestIds']

/** Request ids are hex/uuid-like. Anything else cannot be a handle and is refused before SQL. */
export const PROVIDER_REQUEST_ID_RE = /^[A-Za-z0-9_-]{6,64}$/

export interface ProviderHandleView {
  stage: string
  provider: string
  requestId: string
}

/** Provider name from a handle's status URL host. */
export function providerFromUrl(url: string | undefined): string {
  if (!url) return 'unknown'
  if (/atlascloud/i.test(url)) return 'atlas'
  if (/wavespeed/i.test(url)) return 'wavespeed'
  if (/fal\.(run|ai|media)/i.test(url)) return 'fal'
  return 'unknown'
}

/**
 * providerRequestIds as the team API and Video Studio expose them: the
 * re-host bookkeeping key removed (withoutRehostAttempts), and any other
 * non-handle value (assembly_attempts) dropped too.
 */
export function publicProviderRequestIds(handles: Handles | null | undefined): Record<string, { requestId: string; statusUrl: string; responseUrl: string }> {
  const clean = withoutRehostAttempts((handles ?? {}) as Handles) as Record<string, unknown>
  const out: Record<string, { requestId: string; statusUrl: string; responseUrl: string }> = {}
  for (const [k, v] of Object.entries(clean)) {
    if (v && typeof v === 'object' && typeof (v as { requestId?: unknown }).requestId === 'string') {
      out[k] = v as { requestId: string; statusUrl: string; responseUrl: string }
    }
  }
  return out
}

/** The handles as a flat, ordered list for display. */
export function providerHandleList(handles: Handles | null | undefined): ProviderHandleView[] {
  return Object.entries(publicProviderRequestIds(handles))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, h]) => ({ stage, provider: providerFromUrl(h.statusUrl), requestId: h.requestId }))
}

export interface ResolvedProviderRequest {
  jobRowId: number
  jobId: string
  episodeId: number | null
  /** The handle key (clip, scene_0, lipsync, ...) or, for a frame, the asset purpose. */
  stage: string
  /** The job's current stage machine position. */
  jobStage: string
  status: string
  tier: string
  provider: string
  assets: { id: number; purpose: string; blobUrl: string; sourceModel: string | null; providerRequestId: string | null; createdAt: Date }[]
}

/**
 * Resolve a provider request id to the job(s) that made it. Matches the job
 * handles (GIN-indexed jsonpath) and media_assets.provider_request_id
 * (btree), so scene frames, whose per-candidate ids never sat on the job
 * handles, resolve too. Returns [] when nothing matches.
 */
export async function resolveProviderRequestId(requestId: string): Promise<ResolvedProviderRequest[]> {
  const rid = requestId.trim()
  if (!PROVIDER_REQUEST_ID_RE.test(rid)) return []
  const jsonPath = `$.* ? (@.requestId == "${rid}")`

  const [jobsByHandle, assetHits] = await Promise.all([
    db.select().from(videoJobs).where(sql`${videoJobs.providerRequestIds} @? ${jsonPath}::jsonpath`).limit(10),
    db.select({ videoJobId: mediaAssets.videoJobId, purpose: mediaAssets.purpose })
      .from(mediaAssets)
      .where(eq(mediaAssets.providerRequestId, rid))
      .limit(20),
  ])

  const handleJobIds = new Set(jobsByHandle.map(j => j.id))
  const extraIds = [...new Set(assetHits.map(a => a.videoJobId).filter((id): id is number => id != null && !handleJobIds.has(id)))]
  const extraJobs = extraIds.length ? await db.select().from(videoJobs).where(inArray(videoJobs.id, extraIds)) : []
  const jobs = [...jobsByHandle, ...extraJobs]
  if (!jobs.length) return []

  const jobIds = jobs.map(j => j.id)
  const [episodes, assets] = await Promise.all([
    db.select({ id: videoEpisodes.id, videoJobId: videoEpisodes.videoJobId }).from(videoEpisodes).where(inArray(videoEpisodes.videoJobId, jobIds)),
    db.select({
      id: mediaAssets.id,
      purpose: mediaAssets.purpose,
      blobUrl: mediaAssets.blobUrl,
      sourceModel: mediaAssets.sourceModel,
      providerRequestId: mediaAssets.providerRequestId,
      createdAt: mediaAssets.createdAt,
      videoJobId: mediaAssets.videoJobId,
    }).from(mediaAssets).where(or(eq(mediaAssets.providerRequestId, rid), inArray(mediaAssets.videoJobId, jobIds))),
  ])

  return jobs.map(job => {
    const handles = publicProviderRequestIds(job.providerRequestIds)
    const hit = Object.entries(handles).find(([, h]) => h.requestId === rid)
    const assetHit = assetHits.find(a => a.videoJobId === job.id)
    const own = assets.filter(a => a.videoJobId === job.id)
    // The assets made by this request. Pre-backfill rows carry no id yet, so
    // they are returned only through the job match, never guessed at.
    const matched = own.filter(a => a.providerRequestId === rid)
    return {
      jobRowId: job.id,
      jobId: job.jobId,
      episodeId: episodes.find(e => e.videoJobId === job.id)?.id ?? null,
      stage: hit?.[0] ?? assetHit?.purpose ?? 'unknown',
      jobStage: job.stage,
      status: job.status,
      tier: job.modelTier,
      provider: hit ? providerFromUrl(hit[1].statusUrl) : 'unknown',
      assets: matched.map(({ videoJobId: _j, ...a }) => a),
    }
  })
}

// ─── Backfill planning (scripts/backfill-video-asset-request-ids.ts) ─────────

/** Vercel Blob appends a random suffix (addRandomSuffix: true); the stem stays fixed. */
const BLOB_SUFFIX = '(?:-[A-Za-z0-9]{20,})?'

/**
 * The blob filename stem each stage handle's output was written under by
 * video-pipeline.server.ts: clip.mp4 (single clip and avatar part 0),
 * clip_b.mp4 (avatar parts), scene-<idx>-clip.mp4, clip-ls.mp4 (lipsync).
 * Null for a key whose output has no fixed filename.
 */
export function blobStemForStage(stage: string): string | null {
  if (stage === 'clip' || /^clip_[a-z]$/.test(stage)) return stage
  const scene = /^scene_(\d+)$/.exec(stage)
  if (scene) return `scene-${scene[1]}-clip`
  if (stage === 'lipsync') return 'clip-ls'
  return null
}

export interface BackfillAsset { id: number; blobUrl: string; providerRequestId: string | null }
export interface BackfillWrite { assetId: number; stage: string; requestId: string }
export interface BackfillPlan { writes: BackfillWrite[]; ambiguous: string[]; unmatched: string[]; alreadySet: number }

/**
 * Pair each stage handle with the one asset its output was re-hosted to, by
 * blob filename. Exactly one match is a write (when the column is still
 * empty); zero is unmatched; more than one is ambiguous and skipped.
 */
export function planBackfillForJob(jobId: string, handles: Handles | null | undefined, assets: BackfillAsset[]): BackfillPlan {
  const plan: BackfillPlan = { writes: [], ambiguous: [], unmatched: [], alreadySet: 0 }
  const escJob = jobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const [stage, h] of Object.entries(publicProviderRequestIds(handles))) {
    const stem = blobStemForStage(stage)
    if (!stem) continue
    const re = new RegExp(`/video/${escJob}/${stem}${BLOB_SUFFIX}\\.mp4$`)
    const hits = assets.filter(a => re.test(a.blobUrl))
    if (hits.length === 0) { plan.unmatched.push(stage); continue }
    if (hits.length > 1) { plan.ambiguous.push(stage); continue }
    const hit = hits[0]!
    if (hit.providerRequestId) { plan.alreadySet++; continue }
    plan.writes.push({ assetId: hit.id, stage, requestId: h.requestId.slice(0, 64) })
  }
  return plan
}
