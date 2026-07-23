/**
 * video_jobs state machine — enqueue + the poller-driven advance loop.
 * Mirrors batch-orchestrator.server.ts invariants exactly:
 *   - ONE pass per job per cron tick (submit-or-poll, never await generation)
 *   - zero in-flight rows -> idle negative-cache flag (30 min TTL)
 *   - enqueue deletes the idle flag to wake the poller
 *   - any throw in advance -> row marked failed so the poller never spins
 *
 * Stage flow (single-clip MVP):
 *   scene_frame -> clip -> lipsync (passthrough) -> assembly -> poster -> done
 *
 * scene_frame is the drift guard: candidate stills of the presenter WITH the
 * real product are composed for cents and gated BEFORE the dollar video spend.
 * With the video_frame_review valve ON (default) the job parks at
 * awaiting_frame_approval for the owner's pick in /admin/video-studio; that
 * status is deliberately outside the in-flight set so parked jobs cost nothing.
 *
 * All inter-tick bytes round-trip Blob — never /tmp (instance-local on Vercel).
 */

import { randomUUID } from 'node:crypto'
import { eq, inArray, desc } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { videoJobs, mediaAssets, socialPosts, type VideoScriptJson } from '../../db/schema'
import { kvSet, kvDel, KV_KEYS } from '~/lib/kv.server'
import {
  VIDEO_MODELS,
  isVideoModelId,
  composeSceneFrame,
  submitVideoRequest,
  getVideoRequestStatus,
  getVideoRequestResult,
  downloadFalAsset,
  SCENE_FRAME_COST_KEY,
  type VideoModelId,
  type QueueHandle,
} from '~/lib/fal-video.server'
import { blobPut, blobFetchToBuffer } from '~/lib/blob.server'
import { estimateVideoCostUsd, estimateImageCostUsd } from '~/lib/model-pricing.server'
import { logVideoCost, logImageCost } from '~/lib/token-log.server'
import { getEditorPhotoUrl, getApprovedCastMembers } from '~/lib/sanity.server'
import { getProductByHandle } from '~/lib/shopify.server'
import { getTeamConfig } from '~/lib/team.server'
import { VIDEO_EXTRA_KEYS, VIDEO_MAX_COST_CENTS_DEFAULT } from '~/lib/team-keys'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { extractPoster, applyWatermark, probeDurationSeconds, muxAudio } from '~/lib/video-assembly.server'
import { generateVoiceover } from '~/lib/elevenlabs.server'
import { getActiveIvrVoiceId } from '~/lib/ivr-voice.server'

const SCENE_FRAME_CANDIDATES = 3
const POLLER_IDLE_TTL_SECONDS = 30 * 60

type VideoJobRow = typeof videoJobs.$inferSelect

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export interface EnqueueVideoJobArgs {
  productHandle: string
  shopifyProductGid?: string
  /** Formula slug from the video-producer formula library (validated upstream). */
  formula: string
  /** 'none' | 'emma' | 'friend:{slug}' */
  presenter: string
  /** Script beats + per-platform captions + framePrompt/motionPrompt. */
  scriptJson: VideoScriptJson
  modelTier: VideoModelId
  durationSeconds: number
  targetPlatforms: string[]
  aiDisclosure?: boolean
  runId?: number
}

async function getMaxCostCents(): Promise<number> {
  const cfg = await getTeamConfig('video').catch(() => null)
  return cfg?.maxCostCents ?? VIDEO_MAX_COST_CENTS_DEFAULT
}

/** Estimated all-in USD for a job before it runs (frames + clip). */
export function estimateJobCostUsd(modelTier: VideoModelId, durationSeconds: number): number {
  const spec = VIDEO_MODELS[modelTier]
  const frames = estimateImageCostUsd(SCENE_FRAME_COST_KEY, SCENE_FRAME_CANDIDATES)
  const clip = estimateVideoCostUsd(spec.costKey, durationSeconds)
  return Math.round((frames + clip) * 1e5) / 1e5
}

export async function enqueueVideoJob(args: EnqueueVideoJobArgs): Promise<{ jobId: string; estCostUsd: number }> {
  if (!isVideoModelId(args.modelTier)) throw new Error(`Unknown model tier: ${args.modelTier}`)
  const spec = VIDEO_MODELS[args.modelTier]
  if (!spec.allowedDurations.includes(args.durationSeconds)) {
    throw new Error(`${args.modelTier} does not support ${args.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
  }

  // Hard per-video ceiling: refuse over-budget jobs BEFORE any spend, so a
  // model-tier misconfig cannot drain the daily budget one loop at a time.
  const estCostUsd = estimateJobCostUsd(args.modelTier, args.durationSeconds)
  const maxCents = await getMaxCostCents()
  if (estCostUsd * 100 > maxCents) {
    throw new Error(`Estimated cost $${estCostUsd.toFixed(2)} exceeds the per-video ceiling of $${(maxCents / 100).toFixed(2)} (video_team_max_cost_cents)`)
  }

  const jobId = randomUUID()
  await db.insert(videoJobs).values({
    jobId,
    productHandle: args.productHandle,
    shopifyProductGid: args.shopifyProductGid ?? null,
    formula: args.formula,
    presenter: args.presenter,
    scriptJson: args.scriptJson,
    aiDisclosure: args.aiDisclosure ?? true,
    modelTier: args.modelTier,
    targetPlatforms: args.targetPlatforms,
    runId: args.runId ?? null,
  })

  await kvDel(KV_KEYS.videoPollerIdle)
  console.log(`[video-pipeline] enqueued job ${jobId} product=${args.productHandle} formula=${args.formula} tier=${args.modelTier}`)
  return { jobId, estCostUsd }
}

// ─── Advance loop (called by /cron/video-job-poller) ─────────────────────────

export interface AdvanceVideoResult {
  advanced: number
  done: number
  failed: number
  parked: number
}

export async function advanceInflightVideoJobs(opts: { maxJobs?: number } = {}): Promise<AdvanceVideoResult> {
  const maxJobs = opts.maxJobs ?? 5
  const rows = await db
    .select()
    .from(videoJobs)
    .where(inArray(videoJobs.status, ['queued', 'running', 'awaiting_provider', 'applying']))
    .orderBy(videoJobs.updatedAt)
    .limit(maxJobs)

  const result: AdvanceVideoResult = { advanced: 0, done: 0, failed: 0, parked: 0 }

  if (rows.length === 0) {
    await kvSet(KV_KEYS.videoPollerIdle, Date.now(), POLLER_IDLE_TTL_SECONDS)
    return result
  }

  for (const job of rows) {
    try {
      const outcome = await advanceJob(job)
      result.advanced++
      if (outcome === 'done') result.done++
      if (outcome === 'parked') result.parked++
    } catch (err) {
      console.error(`[video-pipeline] advanceJob ${job.jobId} threw:`, err)
      await db
        .update(videoJobs)
        .set({ status: 'failed', stage: 'failed', error: String(err), updatedAt: new Date() })
        .where(eq(videoJobs.jobId, job.jobId))
      result.failed++
    }
  }

  return result
}

type AdvanceOutcome = 'progressed' | 'waiting' | 'parked' | 'done'

async function touch(job: VideoJobRow, set: Partial<typeof videoJobs.$inferInsert>): Promise<void> {
  await db.update(videoJobs).set({ ...set, updatedAt: new Date() }).where(eq(videoJobs.id, job.id))
}

async function advanceJob(job: VideoJobRow): Promise<AdvanceOutcome> {
  switch (job.stage) {
    case 'scene_frame': return advanceSceneFrame(job)
    case 'clip':        return advanceClip(job)
    case 'lipsync':     return advanceLipsync(job)
    case 'assembly':    return advanceAssembly(job)
    case 'poster':      return advancePoster(job)
    default:
      throw new Error(`Unknown stage ${job.stage}`)
  }
}

// ─── Stage: scene_frame ──────────────────────────────────────────────────────

async function resolvePresenterPhotoUrl(presenter: string): Promise<string | null> {
  if (presenter === 'none') return null
  if (presenter === 'emma') {
    const url = await getEditorPhotoUrl()
    if (!url) throw new Error('Emma canonical photo not found in Sanity (singleton.editor)')
    return url
  }
  if (presenter.startsWith('friend:')) {
    const slug = presenter.slice('friend:'.length)
    const cast = await getApprovedCastMembers()
    const member = cast.find(m => m.slug === slug)
    // Fail fast — never silently substitute Emma for an unapproved character.
    if (!member) throw new Error(`Cast member '${slug}' not found or not approved for use (castMember.approvedForUse)`)
    return member.photoUrl
  }
  throw new Error(`Unknown presenter '${presenter}' (expected none | emma | friend:{slug})`)
}

async function resolveProductImageUrl(handle: string): Promise<string> {
  const product = await getProductByHandle(handle)
  const url = product?.images?.[0]?.url
  if (!url) throw new Error(`Product '${handle}' has no image to reference (hard gate: real photography required)`)
  return url
}

async function frameReviewEnabled(): Promise<boolean> {
  const v = await getPipelineSetting(VIDEO_EXTRA_KEYS.frameReview).catch(() => null)
  return v !== 'false' // defaults ON
}

async function advanceSceneFrame(job: VideoJobRow): Promise<AdvanceOutcome> {
  const script = job.scriptJson
  const framePrompt = typeof script['framePrompt'] === 'string' ? script['framePrompt'] as string : null
  if (!framePrompt) throw new Error('scriptJson.framePrompt is required for the scene_frame stage')

  const presenterUrl = await resolvePresenterPhotoUrl(job.presenter)
  const productUrl = await resolveProductImageUrl(job.productHandle)

  const { urls, costKey } = await composeSceneFrame({
    prompt: framePrompt,
    presenterImageUrl: presenterUrl ?? productUrl,
    productImageUrl: productUrl,
    count: SCENE_FRAME_CANDIDATES,
  })

  // Persist candidates to Blob promptly (fal URLs are ~24h ephemeral).
  const assetIds: number[] = []
  for (let i = 0; i < urls.length; i++) {
    const buf = await downloadFalAsset(urls[i]!)
    const { url } = await blobPut(`video/${job.jobId}/frame-${i}.jpg`, buf, { contentType: 'image/jpeg' })
    const [row] = await db.insert(mediaAssets).values({
      kind: 'image',
      purpose: 'scene_frame',
      blobUrl: url,
      contentType: 'image/jpeg',
      sourceModel: costKey,
      costUsd: String(estimateImageCostUsd(costKey, 1)),
      videoJobId: job.id,
    }).returning({ id: mediaAssets.id })
    if (row) assetIds.push(row.id)
  }
  if (!assetIds.length) throw new Error('Scene-frame composition produced no candidates')

  void logImageCost({
    feature: 'video-frames',
    model: costKey,
    count: assetIds.length,
    caller: 'video-pipeline',
    sku: job.productHandle,
    refId: job.jobId,
  })
  const frameCost = estimateImageCostUsd(costKey, assetIds.length)
  const newCost = Number(job.costUsd) + frameCost

  // Default auto-choice is the first candidate. The owner's frame-review gate
  // (default ON) is the real QA; when the valve is off this seam is where a
  // vision-model likeness check can slot in later without reshaping the flow.
  const chosen = assetIds[0]!

  if (await frameReviewEnabled()) {
    await touch(job, {
      status: 'awaiting_frame_approval',
      sceneFrameAssetId: chosen,
      costUsd: String(newCost),
    })
    return 'parked'
  }

  await touch(job, {
    stage: 'clip',
    status: 'queued',
    sceneFrameAssetId: chosen,
    costUsd: String(newCost),
  })
  return 'progressed'
}

// ─── Stage: clip ─────────────────────────────────────────────────────────────

async function advanceClip(job: VideoJobRow): Promise<AdvanceOutcome> {
  const handles = job.providerRequestIds
  const existing = handles['clip']

  if (!existing) {
    // Submit. Ceiling re-check first: frame retries may have accrued cost.
    const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
    if (!spec) throw new Error(`Unknown model tier ${job.modelTier}`)
    const script = job.scriptJson
    const motionPrompt = typeof script['motionPrompt'] === 'string' ? script['motionPrompt'] as string : null
    const durationSeconds = typeof script['durationSeconds'] === 'number' ? script['durationSeconds'] as number : spec.allowedDurations[0]!
    if (!motionPrompt) throw new Error('scriptJson.motionPrompt is required for the clip stage')
    if (!job.sceneFrameAssetId) throw new Error('No approved scene frame to animate')

    const clipCost = estimateVideoCostUsd(spec.costKey, durationSeconds)
    const maxCents = await getMaxCostCents()
    if ((Number(job.costUsd) + clipCost) * 100 > maxCents) {
      throw new Error(`Accrued + clip cost would exceed the per-video ceiling ($${(maxCents / 100).toFixed(2)})`)
    }

    const [frame] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.sceneFrameAssetId)).limit(1)
    if (!frame) throw new Error('Approved scene-frame asset not found')

    const handle = await submitVideoRequest(job.modelTier as VideoModelId, {
      prompt: motionPrompt,
      imageUrl: frame.blobUrl,
      durationSeconds,
      aspect: '9:16',
    })

    void logVideoCost({
      feature: 'video-clip',
      model: spec.costKey,
      seconds: durationSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
    })

    await touch(job, {
      status: 'awaiting_provider',
      providerRequestIds: { ...handles, clip: handle },
      costUsd: String(Number(job.costUsd) + clipCost),
    })
    return 'progressed'
  }

  // Poll.
  const { status } = await getVideoRequestStatus(existing as QueueHandle)
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
    await touch(job, {}) // heartbeat so ordering stays fair
    return 'waiting'
  }
  if (status === 'FAILED') throw new Error('fal video generation failed')

  const result = await getVideoRequestResult(existing as QueueHandle)
  const buf = await downloadFalAsset(result.videoUrl)
  const { url } = await blobPut(`video/${job.jobId}/clip.mp4`, buf, { contentType: 'video/mp4' })
  await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'clip',
    blobUrl: url,
    contentType: 'video/mp4',
    sourceModel: VIDEO_MODELS[job.modelTier as VideoModelId]?.costKey ?? job.modelTier,
    videoJobId: job.id,
  })
  await touch(job, { stage: 'lipsync', status: 'queued' })
  return 'progressed'
}

// ─── Stage: lipsync ──────────────────────────────────────────────────────────

/** Rough speech rate for cost estimation: ~15 chars of script per spoken second. */
const TTS_CHARS_PER_SECOND = 15
const TTS_COST_KEY = 'elevenlabs/tts'

async function advanceLipsync(job: VideoJobRow): Promise<AdvanceOutcome> {
  // Premium tiers (Veo, Seedance) generate their own audio; muxing over them
  // would stomp it. Silent tiers (Kling) get an ElevenLabs voiceover in the
  // active IVR voice (the owner's pick in /admin/voice-and-sms) muxed here.
  // Scripts must frame these as b-roll/product shots: there is no lip sync,
  // so an on-camera speaking presenter would read as dubbed. sync-lipsync is
  // the designed fast-follow and slots in as a submit/poll pair like advanceClip.
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  const voiceover = typeof job.scriptJson['voiceover'] === 'string' ? (job.scriptJson['voiceover'] as string).trim() : ''
  if (spec?.nativeAudio || !voiceover) {
    await touch(job, { stage: 'assembly', status: 'queued' })
    return 'progressed'
  }

  const clip = await latestAssetByPurpose(job.id, 'clip')
  if (!clip) throw new Error('No clip asset to voice over')
  const clipBuf = await blobFetchToBuffer(clip.blobUrl)

  const voiceId = await getActiveIvrVoiceId()
  const audio = await generateVoiceover({ text: voiceover, ...(voiceId ? { voiceId } : {}) })
  const voiced = await muxAudio(clipBuf, audio)

  const { url } = await blobPut(`video/${job.jobId}/clip-vo.mp4`, voiced, { contentType: 'video/mp4' })
  // Same purpose as the silent clip: assembly picks the newest 'clip' asset.
  await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'clip',
    blobUrl: url,
    contentType: 'video/mp4',
    sourceModel: TTS_COST_KEY,
    videoJobId: job.id,
  })

  const speechSeconds = Math.ceil(voiceover.length / TTS_CHARS_PER_SECOND)
  void logVideoCost({
    feature: 'video-tts',
    model: TTS_COST_KEY,
    seconds: speechSeconds,
    caller: 'video-pipeline',
    sku: job.productHandle,
    refId: job.jobId,
  })

  await touch(job, {
    stage: 'assembly',
    status: 'queued',
    costUsd: String(Number(job.costUsd) + estimateVideoCostUsd(TTS_COST_KEY, speechSeconds)),
  })
  return 'progressed'
}

// ─── Stage: assembly ─────────────────────────────────────────────────────────

async function latestAssetByPurpose(jobRowId: number, purpose: string): Promise<{ id: number; blobUrl: string } | null> {
  const rows = await db
    .select({ id: mediaAssets.id, blobUrl: mediaAssets.blobUrl, purpose: mediaAssets.purpose, createdAt: mediaAssets.createdAt })
    .from(mediaAssets)
    .where(eq(mediaAssets.videoJobId, jobRowId))
    .orderBy(desc(mediaAssets.createdAt))
  const hit = rows.find(r => r.purpose === purpose)
  return hit ? { id: hit.id, blobUrl: hit.blobUrl } : null
}

async function advanceAssembly(job: VideoJobRow): Promise<AdvanceOutcome> {
  const clip = await latestAssetByPurpose(job.id, 'clip')
  if (!clip) throw new Error('No clip asset to assemble')
  const raw = await blobFetchToBuffer(clip.blobUrl)
  const watermarked = await applyWatermark(raw)
  const { url } = await blobPut(`video/${job.jobId}/final.mp4`, watermarked, { contentType: 'video/mp4' })
  const [finalRow] = await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'final',
    blobUrl: url,
    contentType: 'video/mp4',
    videoJobId: job.id,
  }).returning({ id: mediaAssets.id })
  await touch(job, { stage: 'poster', status: 'queued', finalAssetId: finalRow?.id ?? null })
  return 'progressed'
}

// ─── Stage: poster ───────────────────────────────────────────────────────────

async function advancePoster(job: VideoJobRow): Promise<AdvanceOutcome> {
  if (!job.finalAssetId) throw new Error('No final asset for poster extraction')
  const [finalAsset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.finalAssetId)).limit(1)
  if (!finalAsset) throw new Error('Final asset row missing')

  const video = await blobFetchToBuffer(finalAsset.blobUrl)
  const poster = await extractPoster(video, 1)
  const duration = await probeDurationSeconds(video)
  const { url } = await blobPut(`video/${job.jobId}/poster.jpg`, poster, { contentType: 'image/jpeg' })
  const [posterRow] = await db.insert(mediaAssets).values({
    kind: 'image',
    purpose: 'poster',
    blobUrl: url,
    contentType: 'image/jpeg',
    videoJobId: job.id,
  }).returning({ id: mediaAssets.id })

  if (duration > 0) {
    await db.update(mediaAssets).set({ durationSeconds: String(duration) }).where(eq(mediaAssets.id, finalAsset.id))
  }
  await touch(job, {
    stage: 'done',
    status: 'done',
    posterAssetId: posterRow?.id ?? null,
    completedAt: new Date(),
  })
  console.log(`[video-pipeline] job ${job.jobId} complete (${duration.toFixed(1)}s, $${Number(job.costUsd).toFixed(2)})`)
  return 'done'
}

// ─── Owner actions (Video Studio) ────────────────────────────────────────────

/** Approve a candidate frame: job resumes at the clip stage next tick. */
export async function approveSceneFrame(jobRowId: number, frameAssetId: number): Promise<void> {
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, frameAssetId)).limit(1)
  if (!asset || asset.videoJobId !== jobRowId || asset.purpose !== 'scene_frame') {
    throw new Error('Frame does not belong to this job')
  }
  await db.update(videoJobs)
    .set({ sceneFrameAssetId: frameAssetId, stage: 'clip', status: 'queued', updatedAt: new Date() })
    .where(eq(videoJobs.id, jobRowId))
  await kvDel(KV_KEYS.videoPollerIdle)
}

/** Regenerate frame candidates with owner feedback folded into the prompt. */
export async function retrySceneFrames(jobRowId: number, feedback: string): Promise<void> {
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
  if (!job) throw new Error('Job not found')
  const script: VideoScriptJson = { ...job.scriptJson }
  const prior = Array.isArray(script.frameFeedback) ? script.frameFeedback : []
  script.frameFeedback = [...prior, feedback]
  const basePrompt = typeof script['framePrompt'] === 'string' ? script['framePrompt'] as string : ''
  script['framePrompt'] = feedback ? `${basePrompt} ${feedback}`.trim() : basePrompt
  await db.update(videoJobs)
    .set({ scriptJson: script, stage: 'scene_frame', status: 'queued', sceneFrameAssetId: null, updatedAt: new Date() })
    .where(eq(videoJobs.id, jobRowId))
  await kvDel(KV_KEYS.videoPollerIdle)
}

/** Terminal owner rejection. */
export async function rejectVideoJob(jobRowId: number, reason: string): Promise<void> {
  await db.update(videoJobs)
    .set({ status: 'failed', stage: 'failed', error: `Rejected by owner: ${reason || 'no reason given'}`, updatedAt: new Date() })
    .where(eq(videoJobs.id, jobRowId))
}

/** Re-run a finished/failed job as a NEW job with owner feedback appended. */
export async function regenerateVideoJob(jobRowId: number, feedback: string): Promise<{ jobId: string; estCostUsd: number }> {
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
  if (!job) throw new Error('Job not found')
  const script: VideoScriptJson = { ...job.scriptJson }
  const prior = Array.isArray(script.regenFeedback) ? script.regenFeedback : []
  if (feedback) script.regenFeedback = [...prior, feedback]
  const durationSeconds = typeof script['durationSeconds'] === 'number'
    ? script['durationSeconds'] as number
    : VIDEO_MODELS[job.modelTier as VideoModelId]?.allowedDurations[0] ?? 5
  return enqueueVideoJob({
    productHandle: job.productHandle,
    ...(job.shopifyProductGid ? { shopifyProductGid: job.shopifyProductGid } : {}),
    formula: job.formula,
    presenter: job.presenter,
    scriptJson: script,
    modelTier: job.modelTier as VideoModelId,
    durationSeconds,
    targetPlatforms: job.targetPlatforms,
    aiDisclosure: job.aiDisclosure,
    ...(job.runId != null ? { runId: job.runId } : {}),
  })
}

// ─── One-approval-fans-out (Video Studio approve action) ─────────────────────

/**
 * Fan a finished, owner-approved video out to one social_posts row per target
 * platform. Rows land status='draft' + reviewStatus='approved': the Video
 * Studio approval IS the editorial review; the Social Studio Approved tab is
 * the posting surface (copy caption / download / stubbed Post now), not a
 * second review queue. Nothing here posts anywhere.
 */
export async function fanOutVideoToSocialDrafts(jobRowId: number, reviewedBy: string): Promise<number[]> {
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
  if (!job) throw new Error('Job not found')
  if (job.stage !== 'done') throw new Error('Job is not finished')
  const finalAsset = job.finalAssetId
    ? (await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.finalAssetId)).limit(1))[0]
    : undefined
  if (!finalAsset) throw new Error('No final video asset')
  const posterAsset = job.posterAssetId
    ? (await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.posterAssetId)).limit(1))[0]
    : undefined

  const captions = (job.scriptJson.captions ?? {}) as Record<string, string>
  const fallbackCaption = [job.scriptJson.hook, job.scriptJson.cta].filter(Boolean).join(' ')

  const ids: number[] = []
  for (const platform of job.targetPlatforms) {
    const caption = captions[platform] ?? captions['default'] ?? fallbackCaption
    if (!caption) continue
    const [row] = await db.insert(socialPosts).values({
      platform,
      postType: platform === 'youtube' ? 'video_short' : 'video_reel',
      tweetText: caption,
      mediaUrls: [finalAsset.blobUrl],
      posterUrl: posterAsset?.blobUrl ?? null,
      videoJobId: job.id,
      status: 'draft',
      createdBy: 'agent',
      reviewStatus: 'approved',
      reviewedBy,
      reviewedAt: new Date(),
    }).returning({ id: socialPosts.id })
    if (row) ids.push(row.id)
  }
  return ids
}

/** Merge an owner metrics self-report for one platform into metrics_json. */
export async function recordVideoMetrics(
  jobRowId: number,
  platform: string,
  metrics: Record<string, number>,
): Promise<void> {
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
  if (!job) throw new Error('Job not found')
  const merged = { ...(job.metricsJson ?? {}), [platform]: metrics }
  await db.update(videoJobs).set({ metricsJson: merged, updatedAt: new Date() }).where(eq(videoJobs.id, jobRowId))
}

// ─── Reads (Video Studio + team API) ─────────────────────────────────────────

export interface VideoJobWithAssets {
  job: VideoJobRow
  frames: { id: number; blobUrl: string }[]
  finalUrl: string | null
  posterUrl: string | null
}

export async function listVideoJobs(limit = 40): Promise<VideoJobWithAssets[]> {
  const jobs = await db.select().from(videoJobs).orderBy(desc(videoJobs.createdAt)).limit(limit)
  if (!jobs.length) return []
  const jobIds = jobs.map(j => j.id)
  const assets = await db
    .select({ id: mediaAssets.id, blobUrl: mediaAssets.blobUrl, purpose: mediaAssets.purpose, videoJobId: mediaAssets.videoJobId })
    .from(mediaAssets)
    .where(inArray(mediaAssets.videoJobId, jobIds))
  return jobs.map(job => {
    const own = assets.filter(a => a.videoJobId === job.id)
    const finalAsset = own.find(a => a.id === job.finalAssetId) ?? null
    const posterAsset = own.find(a => a.id === job.posterAssetId) ?? null
    return {
      job,
      frames: own.filter(a => a.purpose === 'scene_frame').map(a => ({ id: a.id, blobUrl: a.blobUrl })),
      finalUrl: finalAsset?.blobUrl ?? null,
      posterUrl: posterAsset?.blobUrl ?? null,
    }
  })
}

/** True while any job is in a state the admin page should live-poll for. */
export function hasActiveVideoJobs(rows: VideoJobWithAssets[]): boolean {
  return rows.some(r => ['queued', 'running', 'awaiting_provider', 'applying'].includes(r.job.status))
}
