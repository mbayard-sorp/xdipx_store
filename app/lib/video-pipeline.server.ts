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
import { eq, and, inArray, desc, isNotNull, ne, sql } from 'drizzle-orm'
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
  uploadToFalStorage,
  SCENE_FRAME_COST_KEY,
  SCENE_PLATE_COST_KEY,
  type VideoModelId,
  type VideoModelSpec,
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
import { concatWithAudio, runPostPass } from '~/lib/video-postpass.server'
import {
  TTS_CHARS_PER_SECOND,
  OMNIHUMAN_MAX_RENDER_SECONDS,
  AVATAR_MAX_SPEECH_SECONDS,
  estimateAvatarSpeechSeconds,
  splitPresenterLine,
  captionPhrases,
} from '~/lib/avatar-script'
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

/**
 * Estimated all-in USD for a job before it runs. Non-avatar: frames + clip.
 * Avatar (audio-driven): clip priced from derived speech seconds + TTS, and
 * frames are free when an approved scene frame is being reused.
 */
export function estimateJobCostUsd(
  modelTier: VideoModelId,
  durationSeconds: number,
  opts: { speechSeconds?: number; reuseFrame?: boolean } = {},
): number {
  const spec = VIDEO_MODELS[modelTier]
  // Frame cost is the stage-1 product plate plus the stage-2 candidates.
  // Talking-head jobs skip the plate, so this over-estimates them slightly; that
  // is the safe direction for a pre-flight ceiling check.
  const frames = opts.reuseFrame
    ? 0
    : estimateImageCostUsd(SCENE_PLATE_COST_KEY, 1)
      + estimateImageCostUsd(SCENE_FRAME_COST_KEY, SCENE_FRAME_CANDIDATES)
  if (spec.audioDriven) {
    const seconds = opts.speechSeconds ?? durationSeconds
    const clip = estimateVideoCostUsd(spec.costKey, seconds)
    const tts = estimateVideoCostUsd(TTS_COST_KEY, seconds)
    return Math.round((frames + clip + tts) * 1e5) / 1e5
  }
  const clip = estimateVideoCostUsd(spec.costKey, durationSeconds)
  return Math.round((frames + clip) * 1e5) / 1e5
}

export async function enqueueVideoJob(args: EnqueueVideoJobArgs): Promise<{ jobId: string; estCostUsd: number }> {
  if (!isVideoModelId(args.modelTier)) throw new Error(`Unknown model tier: ${args.modelTier}`)
  const spec = VIDEO_MODELS[args.modelTier]
  const script = args.scriptJson
  const reuseFrame = typeof script.reuseFrameAssetId === 'number'
  let speechSeconds = 0
  if (spec.audioDriven) {
    // Avatar tier: duration derives from the presenterLine's speech length,
    // not the allowed-duration list. The 35s speech cap is the approved budget
    // knob (per-video ceiling stays at 600 cents). Estimated at the
    // conservative avatar rate so near-cap scripts cannot pass enqueue and
    // then die on the real-audio guard after TTS spend.
    const line = typeof script.presenterLine === 'string' ? script.presenterLine.trim() : ''
    if (!line) throw new Error('scriptJson.presenterLine is required for the avatar tier')
    speechSeconds = estimateAvatarSpeechSeconds(line)
    if (speechSeconds > AVATAR_MAX_SPEECH_SECONDS) {
      throw new Error(`presenterLine estimates ${speechSeconds}s of speech, over the ${AVATAR_MAX_SPEECH_SECONDS}s avatar cap. Trim the script.`)
    }
  } else if (!spec.allowedDurations.includes(args.durationSeconds)) {
    throw new Error(`${args.modelTier} does not support ${args.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
  }

  // Hard per-video ceiling: refuse over-budget jobs BEFORE any spend, so a
  // model-tier misconfig cannot drain the daily budget one loop at a time.
  const estCostUsd = estimateJobCostUsd(args.modelTier, args.durationSeconds, {
    ...(spec.audioDriven ? { speechSeconds } : {}),
    reuseFrame,
  })
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

/** Stages past the frame gate: a frame carried here counts as owner-approved. */
const FRAME_APPROVED_STAGES = ['clip', 'lipsync', 'assembly', 'poster', 'done']

/**
 * Latest reusable scene frame for a scene + presenter: the most recent job with
 * the same scriptJson.sceneSlug, the SAME presenter, a chosen frame, and a
 * stage past the frame gate (the existing approval semantics).
 */
export async function findReusableSceneFrame(sceneSlug: string, presenter: string, excludeJobRowId?: number): Promise<number | null> {
  const [row] = await db
    .select({ frameId: videoJobs.sceneFrameAssetId })
    .from(videoJobs)
    .where(and(
      sql`${videoJobs.scriptJson}->>'sceneSlug' = ${sceneSlug}`,
      eq(videoJobs.presenter, presenter),
      isNotNull(videoJobs.sceneFrameAssetId),
      inArray(videoJobs.stage, FRAME_APPROVED_STAGES),
      ...(excludeJobRowId != null ? [ne(videoJobs.id, excludeJobRowId)] : []),
    ))
    .orderBy(desc(videoJobs.createdAt))
    .limit(1)
  return row?.frameId ?? null
}

async function advanceSceneFrame(job: VideoJobRow): Promise<AdvanceOutcome> {
  const script = job.scriptJson
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  const talkingHead = script['talkingHead'] === true
  // Frame reuse is an avatar/talking-head mechanic only: b-roll frames are
  // product-composed per job and never carry an identity to preserve.
  const reusableJob = talkingHead || !!spec?.audioDriven
  const reuseId = typeof script['reuseFrameAssetId'] === 'number' ? script['reuseFrameAssetId'] as number : null

  // Scene-frame REUSE (talking-head rule): an already-approved frame is used
  // as-is, no recomposition (identity drift) and no re-approval parking (no
  // new pixels to review). "Approved" = some job with the SAME presenter
  // carried the frame past the approval gate into clip generation or beyond.
  if (reuseId != null) {
    if (!reusableJob) {
      throw new Error('reuseFrameAssetId applies only to avatar/talking-head jobs')
    }
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, reuseId)).limit(1)
    if (!asset || asset.purpose !== 'scene_frame') {
      throw new Error(`reuseFrameAssetId ${reuseId} does not reference a scene-frame asset`)
    }
    const [approvedBy] = await db
      .select({ id: videoJobs.id })
      .from(videoJobs)
      .where(and(
        eq(videoJobs.sceneFrameAssetId, reuseId),
        eq(videoJobs.presenter, job.presenter),
        inArray(videoJobs.stage, FRAME_APPROVED_STAGES),
      ))
      .limit(1)
    if (!approvedBy) {
      throw new Error(`reuseFrameAssetId ${reuseId} has never been approved for presenter '${job.presenter}' (no matching job carried it past the frame gate)`)
    }
    await touch(job, { stage: 'clip', status: 'queued', sceneFrameAssetId: reuseId })
    return 'progressed'
  }

  // Scene-keyed automatic reuse: same scene + same presenter means the approved
  // frame is picked up without the agent knowing any asset id. First use of a
  // new scene falls through and composes as usual.
  const sceneSlug = typeof script['sceneSlug'] === 'string' ? script['sceneSlug'] as string : null
  if (reusableJob && sceneSlug) {
    const frameId = await findReusableSceneFrame(sceneSlug, job.presenter, job.id)
    if (frameId != null) {
      await touch(job, { stage: 'clip', status: 'queued', sceneFrameAssetId: frameId })
      return 'progressed'
    }
  }

  const framePrompt = typeof script['framePrompt'] === 'string' ? script['framePrompt'] as string : null
  if (!framePrompt) throw new Error('scriptJson.framePrompt is required for the scene_frame stage')

  const presenterUrl = await resolvePresenterPhotoUrl(job.presenter)
  // Talking-head frames NEVER include the product (product visuals live in
  // b-roll cutaways or post-composited stills), so the real-photography hard
  // gate only applies when the product actually appears in the frame.
  if (talkingHead && !presenterUrl) throw new Error('talkingHead requires a presenter (emma or friend:{slug})')
  const productUrl = talkingHead ? null : await resolveProductImageUrl(job.productHandle)
  const baseImageUrl = presenterUrl ?? productUrl
  if (!baseImageUrl) throw new Error('No reference image available for scene-frame composition')

  const { urls, requestIds, costKey, plate, plateRequestId } = await composeSceneFrame({
    prompt: framePrompt,
    presenterImageUrl: baseImageUrl,
    ...(productUrl ? { productImageUrl: productUrl } : {}),
    count: SCENE_FRAME_CANDIDATES,
  })

  // Persist candidates to Blob promptly (fal URLs are ~24h ephemeral). Log each
  // candidate's spend as its own row (count 1) rather than one aggregate row:
  // each candidate is its own fal request (ticket #3045), so a per-candidate
  // row carries that request_id and a file-identifying ref_id
  // (`<jobId>#frame-<i>`, mirroring the blob key video/<jobId>/frame-<i>.jpg).
  // An owner can then resolve a fal request id straight to the frame it made.
  // Totals are unchanged: /admin/usage groups by (caller, sku, product_id,
  // batch_id) and sums request_count, so N rows of 1 equal one row of N.
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
    if (row) {
      assetIds.push(row.id)
      const rid = requestIds[i]
      void logImageCost({
        feature: 'video-frames',
        model: costKey,
        count: 1,
        caller: 'video-pipeline',
        sku: job.productHandle,
        refId: `${job.jobId}#frame-${i}`,
        ...(rid ? { requestId: rid } : {}),
      })
    }
  }
  if (!assetIds.length) throw new Error('Scene-frame composition produced no candidates')

  // The stage-1 product plate is a separate model and must not be folded into
  // the compositor's count, or /admin/usage attributes its spend to the wrong
  // model and the job's running cost under-reports.
  if (plate) {
    void logImageCost({
      feature: 'video-frames',
      model: plate.costKey,
      count: plate.count,
      caller: 'video-pipeline/plate',
      sku: job.productHandle,
      refId: job.jobId,
      ...(plateRequestId ? { requestId: plateRequestId } : {}),
    })
  }
  const frameCost = estimateImageCostUsd(costKey, assetIds.length)
    + (plate ? estimateImageCostUsd(plate.costKey, plate.count) : 0)
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
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  if (!spec) throw new Error(`Unknown model tier ${job.modelTier}`)
  if (spec.audioDriven) return advanceClipAvatar(job, spec)

  const handles = job.providerRequestIds
  const existing = handles['clip']

  if (!existing) {
    // Submit. Ceiling re-check first: frame retries may have accrued cost.
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

// ─── Stage: clip (avatar tier, audio-first OmniHuman) ───────────────────────

/**
 * Part keys double as providerRequestIds keys and media_assets purposes so
 * assembly can pick the parts back up in order: clip, clip_b, clip_c, ...
 * With the 35s speech cap and 24s part budget that is two parts in practice,
 * but the key scheme and the poll/assembly loops handle any count.
 */
function avatarPartKey(i: number): string {
  return i === 0 ? 'clip' : `clip_${String.fromCharCode(97 + i)}`
}

/** Part keys present in a job's provider handles, in render order. */
function avatarPartKeys(handles: Record<string, unknown>): string[] {
  return Object.keys(handles)
    .filter(k => k === 'clip' || /^clip_[a-z]$/.test(k))
    .sort()
}

async function advanceClipAvatar(job: VideoJobRow, spec: VideoModelSpec): Promise<AdvanceOutcome> {
  const handles = job.providerRequestIds

  if (!handles['clip']) {
    // Submit pass: TTS the presenterLine (split BEFORE TTS when the estimated
    // read exceeds one part budget), upload frame + speech to fal storage, and
    // submit one OmniHuman render per part from the SAME identity frame.
    const line = typeof job.scriptJson['presenterLine'] === 'string' ? (job.scriptJson['presenterLine'] as string).trim() : ''
    if (!line) throw new Error('scriptJson.presenterLine is required for the avatar tier')
    if (!job.sceneFrameAssetId) throw new Error('No approved scene frame for the avatar render')

    const parts = splitPresenterLine(line)
    if (!parts.length) throw new Error('presenterLine produced no speakable parts')

    const voiceId = await getActiveIvrVoiceId()
    const audios: Buffer[] = []
    let totalSpeechSeconds = 0
    for (const part of parts) {
      const audio = await generateVoiceover({ text: part, ...(voiceId ? { voiceId } : {}) })
      const seconds = await probeDurationSeconds(audio)
      if (seconds <= 0) throw new Error('Could not probe TTS audio duration')
      if (seconds > OMNIHUMAN_MAX_RENDER_SECONDS - 0.5) {
        throw new Error(`TTS part runs ${seconds.toFixed(1)}s, over OmniHuman's ${OMNIHUMAN_MAX_RENDER_SECONDS}s per-render cap. Shorten presenterLine (or break long sentences up so the splitter can work) and re-enqueue.`)
      }
      audios.push(audio)
      totalSpeechSeconds += seconds
    }
    const billedSeconds = Math.ceil(totalSpeechSeconds)

    // Book the TTS spend NOW: the ElevenLabs calls above already happened, so
    // a failure past this point must still show in the token log.
    void logVideoCost({
      feature: 'video-tts',
      model: TTS_COST_KEY,
      seconds: billedSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
    })

    // Mid-job ceiling recheck with REAL audio seconds (estimates used chars).
    const clipCost = estimateVideoCostUsd(spec.costKey, billedSeconds)
    const ttsCost = estimateVideoCostUsd(TTS_COST_KEY, billedSeconds)
    const maxCents = await getMaxCostCents()
    if ((Number(job.costUsd) + clipCost + ttsCost) * 100 > maxCents) {
      throw new Error(`Accrued + avatar render cost would exceed the per-video ceiling ($${(maxCents / 100).toFixed(2)})`)
    }

    const [frame] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.sceneFrameAssetId)).limit(1)
    if (!frame) throw new Error('Approved scene-frame asset not found')
    const frameBuf = await blobFetchToBuffer(frame.blobUrl)
    const imageUrl = await uploadToFalStorage(frameBuf, 'image/jpeg', `frame-${job.jobId}.jpg`)

    const newHandles: Record<string, QueueHandle> = {}
    for (let i = 0; i < audios.length; i++) {
      const audioUrl = await uploadToFalStorage(audios[i]!, 'audio/mpeg', `speech-${job.jobId}-${i}.mp3`)
      newHandles[avatarPartKey(i)] = await submitVideoRequest('omnihuman', {
        prompt: '',
        imageUrl,
        audioUrl,
        durationSeconds: 0,
        aspect: '9:16',
      })
    }

    void logVideoCost({
      feature: 'video-avatar',
      model: spec.costKey,
      seconds: billedSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
    })

    await touch(job, {
      status: 'awaiting_provider',
      providerRequestIds: { ...handles, ...newHandles },
      costUsd: String(Number(job.costUsd) + clipCost + ttsCost),
    })
    return 'progressed'
  }

  // Poll pass: wait for EVERY part, then persist them all in one go.
  const activeKeys = avatarPartKeys(handles)
  for (const key of activeKeys) {
    const { status } = await getVideoRequestStatus(handles[key] as QueueHandle)
    if (status === 'FAILED') throw new Error(`fal avatar render failed (${key})`)
    if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
      await touch(job, {}) // heartbeat so ordering stays fair
      return 'waiting'
    }
  }

  for (const key of activeKeys) {
    const result = await getVideoRequestResult(handles[key] as QueueHandle)
    const buf = await downloadFalAsset(result.videoUrl)
    const { url } = await blobPut(`video/${job.jobId}/${key}.mp4`, buf, { contentType: 'video/mp4' })
    await db.insert(mediaAssets).values({
      kind: 'video',
      purpose: key,
      blobUrl: url,
      contentType: 'video/mp4',
      sourceModel: spec.costKey,
      videoJobId: job.id,
    })
  }
  // Lipsync is a no-op for the avatar tier (speech is already embedded); the
  // stage machine still passes through it so the flow stays uniform.
  await touch(job, { stage: 'lipsync', status: 'queued' })
  return 'progressed'
}

// ─── Stage: lipsync ──────────────────────────────────────────────────────────

// TTS_CHARS_PER_SECOND lives in avatar-script.ts (b-roll voiceover rate; the
// avatar tier estimates with its own conservative AVATAR_TTS_CHARS_PER_SECOND).
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

/** Full post passes allowed per job before assembly degrades (bounds music spend). */
const ASSEMBLY_MAX_FULL_ATTEMPTS = 2

async function advanceAssembly(job: VideoJobRow): Promise<AdvanceOutcome> {
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  const clip = await latestAssetByPurpose(job.id, 'clip')
  if (!clip) throw new Error('No clip asset to assemble')
  let raw = await blobFetchToBuffer(clip.blobUrl)

  if (spec?.audioDriven) {
    // Persist the attempt counter BEFORE the heavy work: if assembly keeps
    // crashing, retries must not re-spend music generation and re-encoding
    // forever. Attempts 1-2 run the full post pass; 3+ degrade to concat +
    // watermark so the job is guaranteed to exit this stage.
    const handles = job.providerRequestIds as Record<string, unknown>
    const attempts = (typeof handles['assembly_attempts'] === 'number' ? handles['assembly_attempts'] : 0) + 1
    await touch(job, {
      providerRequestIds: { ...handles, assembly_attempts: attempts } as unknown as VideoJobRow['providerRequestIds'],
    })

    // Join the split parts in render order (audio preserved; each seam doubles
    // as a punch-in cut).
    const partKeys = avatarPartKeys(handles)
    if (partKeys.length > 1) {
      const bufs: Buffer[] = []
      for (const key of partKeys) {
        const part = await latestAssetByPurpose(job.id, key)
        if (!part) throw new Error(`Missing avatar part asset '${key}' for assembly`)
        bufs.push(await blobFetchToBuffer(part.blobUrl))
      }
      raw = await concatWithAudio(bufs)
    }

    if (attempts <= ASSEMBLY_MAX_FULL_ATTEMPTS) {
      // Mandatory post pass: punch-ins ~3.5s, burned captions timed from the
      // presenterLine, music bed, -14 LUFS loudnorm.
      const line = typeof job.scriptJson['presenterLine'] === 'string' ? (job.scriptJson['presenterLine'] as string).trim() : ''
      raw = await runPostPass(raw, { phrases: line ? captionPhrases(line) : [] })
    } else {
      const warn = `assembly degraded on attempt ${attempts}: concat + watermark only, post pass skipped`
      console.warn(`[video-pipeline] job ${job.jobId} ${warn}`)
      await touch(job, { error: warn })
    }
  }

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

/**
 * Owner weekly scorecard self-report (strategy §4): exactly five named fields
 * per video per platform plus optional free-text notes. Absent fields stay
 * absent; the UI shows "not yet reported" and NOTHING is ever estimated.
 */
export interface VideoMetricsReport {
  hookRetentionPct?: number
  saves?: number
  shares?: number
  profileTaps?: number
  utmClicks?: number
  notes?: string
}

/** Merge an owner metrics self-report for one platform into metrics_json. */
export async function recordVideoMetrics(
  jobRowId: number,
  platform: string,
  metrics: VideoMetricsReport,
): Promise<void> {
  // Field-level merge: only submitted fields overwrite; blank fields keep the
  // previously reported value, and an all-empty submission is a no-op.
  const submitted = Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== undefined))
  if (!Object.keys(submitted).length) return
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
  if (!job) throw new Error('Job not found')
  // metrics_json's declared column shape is numeric-per-field; notes rides
  // along as the one string field (owner context, never aggregated).
  const existing = (job.metricsJson ?? {})[platform] ?? {}
  const merged = { ...(job.metricsJson ?? {}), [platform]: { ...existing, ...submitted } as Record<string, number> }
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
