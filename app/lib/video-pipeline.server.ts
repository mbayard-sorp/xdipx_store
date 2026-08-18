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
  assertSceneFrameContract,
  probeImageDimensions,
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
import {
  VIDEO_EXTRA_KEYS,
  VIDEO_MAX_COST_CENTS_DEFAULT,
  VIDEO_MAX_VARIANTS_PER_SET_DEFAULT,
  ENDCARD_CTA_WHITELIST,
  TONE_EXPRESSION,
  isVideoTone,
} from '~/lib/team-keys'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { extractPoster, applyWatermark, probeDurationSeconds, muxAudio, renderAspectMaster, type AspectMaster } from '~/lib/video-assembly.server'
import { concatWithAudio, runPostPass, buildEndCard } from '~/lib/video-postpass.server'
import {
  TTS_CHARS_PER_SECOND,
  OMNIHUMAN_MAX_RENDER_SECONDS,
  AVATAR_MAX_SPEECH_SECONDS,
  estimateAvatarSpeechSeconds,
  splitPresenterLine,
  captionPhrases,
} from '~/lib/avatar-script'
import { generateVoiceover, generateVoiceoverWithTimestamps } from '~/lib/elevenlabs.server'
import { charAlignmentToWordTimings, type WordTiming } from '~/lib/caption-timing'
import { expandVariantSet, type VariantAxes } from '~/lib/video-variants'
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
  /** Set by enqueueVideoJobSet — shared by every sibling expanded from one call. */
  variantGroupId?: string
  /** Which axis values this sibling got (labels Video Studio's set view). */
  variantAxes?: VariantAxes
}

async function getMaxCostCents(): Promise<number> {
  const cfg = await getTeamConfig('video').catch(() => null)
  return cfg?.maxCostCents ?? VIDEO_MAX_COST_CENTS_DEFAULT
}

/**
 * Estimated all-in USD for a job before it runs. Non-avatar: frames + clip.
 * Avatar (audio-driven): clip priced from derived speech seconds + TTS, and
 * frames are free when an approved scene frame is being reused. Lipsync
 * (compound tier): base clip + TTS + lipsync, all at durationSeconds.
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
  if (spec.lipsync) {
    const base = VIDEO_MODELS[spec.lipsync.baseClip]
    const clip = estimateVideoCostUsd(base.costKey, durationSeconds)
    const tts = estimateVideoCostUsd(TTS_COST_KEY, durationSeconds)
    const lipsync = estimateVideoCostUsd(spec.costKey, durationSeconds)
    return Math.round((frames + clip + tts + lipsync) * 1e5) / 1e5
  }
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
  } else if (spec.lipsync) {
    // Compound talking tier: the base clip is duration-validated, and the
    // spoken line must fit inside it (sync_mode cut_off truncates the longer
    // track, so an over-long read would lose its ending).
    const line = typeof script.presenterLine === 'string' ? script.presenterLine.trim() : ''
    if (!line) throw new Error('scriptJson.presenterLine is required for the lipsync tier')
    if (args.presenter === 'none') throw new Error('lipsync tier requires a presenter (emma or friend:{slug})')
    if (!spec.allowedDurations.includes(args.durationSeconds)) {
      throw new Error(`${args.modelTier} does not support ${args.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
    }
    const speech = estimateAvatarSpeechSeconds(line)
    if (speech > args.durationSeconds) {
      throw new Error(`presenterLine estimates ${speech}s of speech but the clip is ${args.durationSeconds}s. Trim the line or lengthen the clip.`)
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
    variantGroupId: args.variantGroupId ?? null,
    variantAxes: args.variantAxes ?? null,
  })

  await kvDel(KV_KEYS.videoPollerIdle)
  console.log(`[video-pipeline] enqueued job ${jobId} product=${args.productHandle} formula=${args.formula} tier=${args.modelTier}`)
  return { jobId, estCostUsd }
}

// ─── Enqueue a variant set (batch engine, spec §5 Phase 1) ───────────────────

export interface EnqueueVideoJobSetArgs {
  productHandle: string
  shopifyProductGid?: string
  formula: string
  /** Base presenter; the presenters axis overrides per variant. */
  presenter: string
  baseScriptJson: VideoScriptJson
  modelTier: VideoModelId
  durationSeconds: number
  targetPlatforms: string[]
  aiDisclosure?: boolean
  runId?: number
  hooks: string[]
  presenters?: string[]
  sceneSlugs?: string[]
}

export interface EnqueueVideoJobSetResult {
  variantGroupId: string
  totalEstCostUsd: number
  jobs: { jobId: string; estCostUsd: number; axes: VariantAxes }[]
}

/**
 * Expand one concept into N variant jobs sharing a variant_group_id. All
 * validation and the set-level budget check run BEFORE the first insert.
 * Variants whose scene already has an approved frame (sceneSlug reuse, or an
 * explicit reuseFrameAssetId on the base script) cost no new frame spend —
 * that is what makes a 4-hook set ~1.4x one video, not 4x. Per-job ceilings
 * still apply inside each enqueueVideoJob call.
 */
export async function enqueueVideoJobSet(args: EnqueueVideoJobSetArgs): Promise<EnqueueVideoJobSetResult> {
  if (!isVideoModelId(args.modelTier)) throw new Error(`Unknown model tier: ${args.modelTier}`)
  const spec = VIDEO_MODELS[args.modelTier]

  const variants = expandVariantSet({
    baseScriptJson: args.baseScriptJson,
    hooks: args.hooks,
    ...(args.presenters?.length ? { presenters: args.presenters } : {}),
    ...(args.sceneSlugs?.length ? { sceneSlugs: args.sceneSlugs } : {}),
    durationSeconds: args.durationSeconds,
  })

  const cfg = await getTeamConfig('video').catch(() => null)
  const maxVariants = cfg?.maxVariantsPerSet ?? VIDEO_MAX_VARIANTS_PER_SET_DEFAULT
  if (variants.length > maxVariants) {
    throw new Error(`Set expands to ${variants.length} variants, over the ${maxVariants}-variant cap (video_team_max_variants_per_set)`)
  }
  const maxCents = cfg?.maxCostCents ?? VIDEO_MAX_COST_CENTS_DEFAULT

  // Per-variant estimates with real frame-reuse detection, then the set-level
  // budget check: total <= per-video ceiling x the variant cap.
  let totalEstCostUsd = 0
  const estimates: number[] = []
  for (const v of variants) {
    const presenter = v.presenter ?? args.presenter
    let reuseFrame = typeof v.scriptJson.reuseFrameAssetId === 'number'
    if (!reuseFrame && typeof v.scriptJson.sceneSlug === 'string' && (spec.audioDriven || spec.lipsync || v.scriptJson.talkingHead === true)) {
      reuseFrame = (await findReusableSceneFrame(v.scriptJson.sceneSlug, presenter).catch(() => null)) != null
    }
    const speechSource = typeof v.scriptJson.presenterLine === 'string' ? v.scriptJson.presenterLine : ''
    const est = estimateJobCostUsd(args.modelTier, args.durationSeconds, {
      ...(spec.audioDriven ? { speechSeconds: estimateAvatarSpeechSeconds(speechSource) } : {}),
      reuseFrame,
    })
    estimates.push(est)
    totalEstCostUsd += est
  }
  if (totalEstCostUsd * 100 > maxCents * maxVariants) {
    throw new Error(
      `Set estimate $${totalEstCostUsd.toFixed(2)} exceeds the set budget of $${((maxCents * maxVariants) / 100).toFixed(2)} ` +
      `(per-video ceiling x max variants per set)`,
    )
  }

  const variantGroupId = randomUUID()
  const jobs: EnqueueVideoJobSetResult['jobs'] = []
  for (const v of variants) {
    const { jobId, estCostUsd } = await enqueueVideoJob({
      productHandle: args.productHandle,
      ...(args.shopifyProductGid ? { shopifyProductGid: args.shopifyProductGid } : {}),
      formula: args.formula,
      presenter: v.presenter ?? args.presenter,
      scriptJson: v.scriptJson,
      modelTier: args.modelTier,
      durationSeconds: args.durationSeconds,
      targetPlatforms: args.targetPlatforms,
      ...(typeof args.aiDisclosure === 'boolean' ? { aiDisclosure: args.aiDisclosure } : {}),
      ...(typeof args.runId === 'number' ? { runId: args.runId } : {}),
      variantGroupId,
      variantAxes: v.axes,
    })
    jobs.push({ jobId, estCostUsd, axes: v.axes })
  }
  console.log(`[video-pipeline] enqueued variant set ${variantGroupId}: ${jobs.length} jobs, est $${totalEstCostUsd.toFixed(2)}`)
  return { variantGroupId, totalEstCostUsd: Math.round(totalEstCostUsd * 1e5) / 1e5, jobs }
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
  // product-composed per job and never carry an identity to preserve. The
  // lipsync tier is a talking path too — its frame carries the presenter.
  const reusableJob = talkingHead || !!spec?.audioDriven || !!spec?.lipsync
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
    // Compound lipsync tier: the CLIP renders on the base model (Kling); the
    // lipsync model itself runs at the next stage.
    const clipModelId = spec.lipsync ? spec.lipsync.baseClip : job.modelTier as VideoModelId
    const clipSpec = VIDEO_MODELS[clipModelId]
    const script = job.scriptJson
    const motionPrompt = typeof script['motionPrompt'] === 'string' ? script['motionPrompt'] as string : null
    const durationSeconds = typeof script['durationSeconds'] === 'number' ? script['durationSeconds'] as number : spec.allowedDurations[0]!
    if (!motionPrompt) throw new Error('scriptJson.motionPrompt is required for the clip stage')
    if (!job.sceneFrameAssetId) throw new Error('No approved scene frame to animate')

    const clipCost = estimateVideoCostUsd(clipSpec.costKey, durationSeconds)
    const maxCents = await getMaxCostCents()
    if ((Number(job.costUsd) + clipCost) * 100 > maxCents) {
      throw new Error(`Accrued + clip cost would exceed the per-video ceiling ($${(maxCents / 100).toFixed(2)})`)
    }

    const [frame] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, job.sceneFrameAssetId)).limit(1)
    if (!frame) throw new Error('Approved scene-frame asset not found')

    // Grok image-to-video has no aspect_ratio param and its product fidelity
    // tracks the input frame's resolution (ticket #3991), so a degraded frame
    // must fail before the paid submit. Probe the real pixels of the frame
    // (stored dims are not persisted on scene_frame assets) and assert the
    // 9:16 full-resolution contract. Other tiers pass aspect_ratio explicitly
    // to fal and are not subject to this failure mode.
    if (clipModelId === 'grok') {
      const frameBuf = await blobFetchToBuffer(frame.blobUrl)
      const { width, height } = await probeImageDimensions(frameBuf)
      assertSceneFrameContract(width, height)
    }

    const handle = await submitVideoRequest(clipModelId, {
      prompt: motionPrompt,
      imageUrl: frame.blobUrl,
      durationSeconds,
      aspect: '9:16',
    })

    void logVideoCost({
      feature: 'video-clip',
      model: clipSpec.costKey,
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
  const clipSourceSpec = spec.lipsync ? VIDEO_MODELS[spec.lipsync.baseClip] : spec
  await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'clip',
    blobUrl: url,
    contentType: 'video/mp4',
    sourceModel: clipSourceSpec?.costKey ?? job.modelTier,
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

    const tone = isVideoTone(job.scriptJson['presenterTone']) ? job.scriptJson['presenterTone'] : undefined
    const voiceId = await getActiveIvrVoiceId()
    const audios: Buffer[] = []
    const wordTimings: WordTiming[] = []
    let timingsComplete = true
    let totalSpeechSeconds = 0
    for (const part of parts) {
      // with-timestamps: same audio, plus the char alignment that drives the
      // word-timed caption burn. A missing alignment falls back to the
      // char-proportional recipe at assembly, never fails the render.
      const { audio, alignment } = await generateVoiceoverWithTimestamps({
        text: part,
        ...(voiceId ? { voiceId } : {}),
        ...(tone ? { tone } : {}),
      })
      const seconds = await probeDurationSeconds(audio)
      if (seconds <= 0) throw new Error('Could not probe TTS audio duration')
      if (seconds > OMNIHUMAN_MAX_RENDER_SECONDS - 0.5) {
        throw new Error(`TTS part runs ${seconds.toFixed(1)}s, over OmniHuman's ${OMNIHUMAN_MAX_RENDER_SECONDS}s per-render cap. Shorten presenterLine (or break long sentences up so the splitter can work) and re-enqueue.`)
      }
      if (alignment) {
        // Offset by the REAL accumulated seconds of prior parts — the parts
        // concat in assembly, so cumulative timing survives the join.
        wordTimings.push(...charAlignmentToWordTimings(alignment, totalSpeechSeconds))
      } else {
        timingsComplete = false
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
        // Tone colors the performance, not just the read (spec §5 Phase 3).
        prompt: tone ? TONE_EXPRESSION[tone] : '',
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

    // Persist word timings alongside the handles: assembly runs on a later
    // cron tick and reads them back off the row. Partial coverage (some part
    // returned no alignment) is dropped wholesale — mistimed cues are worse
    // than the char-proportional fallback.
    const scriptWithTimings: VideoScriptJson = { ...job.scriptJson }
    if (timingsComplete && wordTimings.length) scriptWithTimings.wordTimings = wordTimings
    else delete scriptWithTimings.wordTimings

    await touch(job, {
      status: 'awaiting_provider',
      providerRequestIds: { ...handles, ...newHandles },
      scriptJson: scriptWithTimings,
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
  // so an on-camera speaking presenter would read as dubbed. The sync-lipsync
  // compound tier IS the sanctioned talking path on a standard-tier budget:
  // it performs the presenterLine onto the finished base clip below.
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  if (spec?.lipsync) return advanceLipsyncPerform(job, spec)

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

/**
 * sync-lipsync perform pass (compound tier): TTS the presenterLine, submit the
 * finished base clip + speech track to fal-ai/sync-lipsync, poll, and land the
 * performed clip as the newest 'clip' asset for assembly. Same submit-or-poll
 * discipline as advanceClip.
 */
async function advanceLipsyncPerform(job: VideoJobRow, spec: VideoModelSpec): Promise<AdvanceOutcome> {
  const handles = job.providerRequestIds
  const existing = handles['lipsync']

  if (!existing) {
    const line = typeof job.scriptJson['presenterLine'] === 'string' ? (job.scriptJson['presenterLine'] as string).trim() : ''
    if (!line) throw new Error('scriptJson.presenterLine is required for the lipsync tier')
    const clip = await latestAssetByPurpose(job.id, 'clip')
    if (!clip) throw new Error('No clip asset to lip-sync')

    const tone = isVideoTone(job.scriptJson['presenterTone']) ? job.scriptJson['presenterTone'] : undefined
    const voiceId = await getActiveIvrVoiceId()
    const { audio, alignment } = await generateVoiceoverWithTimestamps({
      text: line,
      ...(voiceId ? { voiceId } : {}),
      ...(tone ? { tone } : {}),
    })
    const speechSeconds = await probeDurationSeconds(audio)
    if (speechSeconds <= 0) throw new Error('Could not probe TTS audio duration')
    const billedSeconds = Math.ceil(speechSeconds)

    // TTS spend happened above — book it before anything can throw.
    void logVideoCost({
      feature: 'video-tts',
      model: TTS_COST_KEY,
      seconds: billedSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
    })

    const ttsCost = estimateVideoCostUsd(TTS_COST_KEY, billedSeconds)
    const lipsyncCost = estimateVideoCostUsd(spec.costKey, billedSeconds)
    const maxCents = await getMaxCostCents()
    if ((Number(job.costUsd) + ttsCost + lipsyncCost) * 100 > maxCents) {
      throw new Error(`Accrued + lipsync cost would exceed the per-video ceiling ($${(maxCents / 100).toFixed(2)})`)
    }

    // Round-trip both inputs through fal storage: Blob URLs are usually
    // fetchable, but fal storage keeps inputs in-house (same as the avatar path).
    const clipBuf = await blobFetchToBuffer(clip.blobUrl)
    const videoUrl = await uploadToFalStorage(clipBuf, 'video/mp4', `clip-${job.jobId}.mp4`)
    const audioUrl = await uploadToFalStorage(audio, 'audio/mpeg', `speech-${job.jobId}.mp3`)

    const handle = await submitVideoRequest('sync-lipsync', {
      prompt: '',
      imageUrl: '',
      videoUrl,
      audioUrl,
      durationSeconds: 0,
      aspect: '9:16',
    })

    void logVideoCost({
      feature: 'video-lipsync',
      model: spec.costKey,
      seconds: billedSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
    })

    const scriptWithTimings: VideoScriptJson = { ...job.scriptJson }
    const timings = alignment ? charAlignmentToWordTimings(alignment, 0) : []
    if (timings.length) scriptWithTimings.wordTimings = timings
    else delete scriptWithTimings.wordTimings

    await touch(job, {
      status: 'awaiting_provider',
      providerRequestIds: { ...handles, lipsync: handle },
      scriptJson: scriptWithTimings,
      costUsd: String(Number(job.costUsd) + ttsCost + lipsyncCost),
    })
    return 'progressed'
  }

  // Poll.
  const { status } = await getVideoRequestStatus(existing as QueueHandle)
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
    await touch(job, {}) // heartbeat so ordering stays fair
    return 'waiting'
  }
  if (status === 'FAILED') throw new Error('fal lipsync failed')

  const result = await getVideoRequestResult(existing as QueueHandle)
  const buf = await downloadFalAsset(result.videoUrl)
  const { url } = await blobPut(`video/${job.jobId}/clip-ls.mp4`, buf, { contentType: 'video/mp4' })
  // Same purpose as the base clip: assembly picks the newest 'clip' asset.
  await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'clip',
    blobUrl: url,
    contentType: 'video/mp4',
    sourceModel: spec.costKey,
    videoJobId: job.id,
  })
  await touch(job, { stage: 'assembly', status: 'queued' })
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

async function endcardEnabled(): Promise<boolean> {
  const v = await getPipelineSetting(VIDEO_EXTRA_KEYS.endcardEnabled).catch(() => null)
  return v === 'true' // defaults OFF
}

async function advanceAssembly(job: VideoJobRow): Promise<AdvanceOutcome> {
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  const clip = await latestAssetByPurpose(job.id, 'clip')
  if (!clip) throw new Error('No clip asset to assemble')
  let raw = await blobFetchToBuffer(clip.blobUrl)

  // Talking tiers (audio-first avatar AND the lipsync compound) get the full
  // post pass; silent/native-audio b-roll ships as generated.
  if (spec?.audioDriven || spec?.lipsync) {
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
      // Mandatory post pass: punch-ins ~3.5s, burned captions (word-timed when
      // TTS captured timings, char-proportional otherwise), music bed,
      // -14 LUFS loudnorm.
      const line = typeof job.scriptJson['presenterLine'] === 'string' ? (job.scriptJson['presenterLine'] as string).trim() : ''
      const wordTimings = Array.isArray(job.scriptJson.wordTimings) ? job.scriptJson.wordTimings as WordTiming[] : []
      raw = await runPostPass(raw, {
        phrases: line ? captionPhrases(line) : [],
        ...(wordTimings.length ? { wordTimings } : {}),
        costRef: { sku: job.productHandle, refId: job.jobId },
      })
    } else {
      const warn = `assembly degraded on attempt ${attempts}: concat + watermark only, post pass skipped`
      console.warn(`[video-pipeline] job ${job.jobId} ${warn}`)
      await touch(job, { error: warn })
    }
  }

  // Valve-gated 1.5s logo + CTA outro (spec §5 Phase 2). Failure never bricks
  // the job — the video ships without its end card.
  if (await endcardEnabled()) {
    try {
      const cta = typeof job.scriptJson.cta === 'string' && (ENDCARD_CTA_WHITELIST as readonly string[]).includes(job.scriptJson.cta)
        ? job.scriptJson.cta
        : ENDCARD_CTA_WHITELIST[0]
      const card = await buildEndCard({ ctaLine: cta })
      raw = await concatWithAudio([raw, card])
    } catch (err) {
      console.warn(`[video-pipeline] job ${job.jobId} end card failed, shipping without:`, err instanceof Error ? err.message.slice(0, 200) : err)
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

/** Extra masters derived from the 9:16 final in the poster tick (spec §5 Phase 2). */
const ASPECT_MASTERS: { aspect: AspectMaster; purpose: string; suffix: string; width: number; height: number }[] = [
  { aspect: '1:1', purpose: 'final_1x1', suffix: 'final-1x1', width: 1080, height: 1080 },
  { aspect: '4:5', purpose: 'final_4x5', suffix: 'final-4x5', width: 1080, height: 1350 },
]

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

  // Multi-aspect masters, derived from the FINAL so captions/end card/watermark
  // carry over free. Runs here (a light tick) rather than assembly to protect
  // that stage's 300s budget. Each crop degrades independently — a failed crop
  // never blocks completion. Idempotent across retries: skip purposes that
  // already exist for this job.
  for (const m of ASPECT_MASTERS) {
    try {
      if (await latestAssetByPurpose(job.id, m.purpose)) continue
      const cropped = await renderAspectMaster(video, m.aspect)
      const put = await blobPut(`video/${job.jobId}/${m.suffix}.mp4`, cropped, { contentType: 'video/mp4' })
      await db.insert(mediaAssets).values({
        kind: 'video',
        purpose: m.purpose,
        blobUrl: put.url,
        contentType: 'video/mp4',
        width: m.width,
        height: m.height,
        ...(duration > 0 ? { durationSeconds: String(duration) } : {}),
        videoJobId: job.id,
      })
    } catch (err) {
      console.warn(`[video-pipeline] job ${job.jobId} ${m.aspect} master failed, skipping:`, err instanceof Error ? err.message.slice(0, 200) : err)
    }
  }

  if (duration > 0) {
    await db.update(mediaAssets).set({ durationSeconds: String(duration), width: 1080, height: 1920 }).where(eq(mediaAssets.id, finalAsset.id))
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
  // Stale render artifacts never travel: timings are re-captured at TTS time,
  // and a retake is a NEW single job — it does not inherit variant_group_id.
  delete script.wordTimings
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
 * platform. Rows land status='draft' + reviewStatus='pending_review', never
 * 'approved' (ticket #3733): both publish paths refuse an approved row without
 * a publish-gate stamp in `feedback`, and only `applyPublishGateVerdict` may
 * write one. Video Studio approval is the editorial review of the VIDEO; the
 * publish gate still owns whether the finished POST ships (repetition across
 * the feed, caption patterns, stock at publish time are its checks, not frame
 * review's). Instagram rows are swept by the social routine's Step 6.5 gate
 * pass; other platforms stay pending for the owner in the Social Studio.
 * `scheduledFor` is set to today because the publish job's eligibility query
 * requires `scheduled_for <= current_date`; a NULL there never matches, which
 * would strand the row even once gated. Nothing here posts anywhere.
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
      reviewStatus: 'pending_review',
      scheduledFor: new Date().toISOString().slice(0, 10),
      // Who approved the VIDEO, kept for audit; the POST's reviewer is whoever
      // the gate stamp names once it verdicts.
      reviewedBy,
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
