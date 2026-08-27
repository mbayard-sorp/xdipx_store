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
 * Multi-scene jobs (Phase 3, migration 083, 20-60s videos): scriptJson.scenes
 * (2-8 scenes) makes video_jobs.scenes_json / scene_state_json non-null and
 * routes advanceSceneFrame/advanceClip through their multi-scene branches
 * (advanceSceneFrameMultiScene / advanceClipMultiScene below), one scene per
 * poller tick. The clip stage concatenates every finished scene clip into ONE
 * 'clip'-purpose media_assets row (concatAndNormalize) before handing off to
 * `stage: 'lipsync'` — so advanceLipsync / advanceLipsyncPerform / advanceAssembly
 * / advancePoster run UNMODIFIED for multi-scene jobs: they already resolve
 * "the clip" as the newest 'clip'-purpose asset (latestAssetByPurpose), which
 * is exactly this concatenated row. A job with scriptJson.scenes absent or
 * under 2 entries takes the original single-clip path, byte-for-byte.
 *
 * All inter-tick bytes round-trip Blob — never /tmp (instance-local on Vercel).
 */

import { randomUUID } from 'node:crypto'
import { eq, and, inArray, desc, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { videoJobs, mediaAssets, socialPosts, videoEpisodes, type VideoScriptJson, type VideoSceneSpec, type VideoSceneState, type RunpodIdleProbe } from '../../db/schema'
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
  classifyAudioPath,
  type VideoModelId,
  type VideoModelSpec,
  type AudioPath,
  type QueueHandle,
} from '~/lib/fal-video.server'
import { blobPut, blobFetchToBuffer } from '~/lib/blob.server'
import { estimateVideoCostUsd, estimateImageCostUsd, computeRunpodActualCostUsd } from '~/lib/model-pricing.server'
import { utcIsoToLaWallClock } from '~/lib/social-schedule-ui'
import { logVideoCost, logImageCost } from '~/lib/token-log.server'
import { submitRunpodVideo, getRunpodStatus, getRunpodResult } from '~/lib/runpod-video.server'
import { getEditorPhotoUrl, getApprovedCastMembers } from '~/lib/sanity.server'
import { getProductByHandle } from '~/lib/shopify.server'
import { getTeamConfig } from '~/lib/team.server'
import {
  VIDEO_EXTRA_KEYS,
  VIDEO_MAX_COST_CENTS_DEFAULT,
  VIDEO_MAX_VARIANTS_PER_SET_DEFAULT,
  VIDEO_DEFAULT_MODEL_TIER_DEFAULT,
  ENDCARD_CTA_WHITELIST,
  TONE_EXPRESSION,
  isVideoTone,
} from '~/lib/team-keys'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { extractPoster, applyWatermark, probeDurationSeconds, muxAudio, stripAudio, renderAspectMaster, concatAndNormalize, extractLastFrame, type AspectMaster } from '~/lib/video-assembly.server'
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

// TTS_CHARS_PER_SECOND lives in avatar-script.ts (b-roll voiceover rate; the
// avatar tier estimates with its own conservative AVATAR_TTS_CHARS_PER_SECOND).
// Declared here (rather than down by advanceLipsync, its main call site) so the
// multi-scene cost estimator above can share it too.
const TTS_COST_KEY = 'elevenlabs/tts'

// ─── Multi-scene jobs (Phase 3, 20-60s videos, migration 083) ────────────────

export const MULTI_SCENE_MIN = 2
export const MULTI_SCENE_MAX = 8
export const MULTI_SCENE_TOTAL_MAX_SECONDS = 90

/** True when scriptJson describes a multi-scene job (2+ scenes). */
export function isMultiSceneScript(script: VideoScriptJson): script is VideoScriptJson & { scenes: VideoSceneSpec[] } {
  return Array.isArray(script.scenes) && script.scenes.length >= MULTI_SCENE_MIN
}

/**
 * Validate + normalize a raw scenes array at enqueue: 2-8 scenes, each
 * duration one of the rendering model's allowedDurations, total <= 90s,
 * continuity defaulted (scene 0 'own-frame', every later scene 'last-frame').
 * The rendering model is the LIPSYNC TIER'S BASE CLIP when spec.lipsync is
 * set (the clip stage renders scenes on the base model; lipsync performs the
 * concatenated result afterward) — same resolution advanceClip already uses.
 */
function validateScenes(raw: VideoSceneSpec[], spec: VideoModelSpec): VideoSceneSpec[] {
  if (raw.length < MULTI_SCENE_MIN || raw.length > MULTI_SCENE_MAX) {
    throw new Error(`Multi-scene jobs need ${MULTI_SCENE_MIN}-${MULTI_SCENE_MAX} scenes (got ${raw.length})`)
  }
  const clipModelId = spec.lipsync ? spec.lipsync.baseClip : undefined
  const clipSpec = clipModelId ? VIDEO_MODELS[clipModelId] : spec
  let total = 0
  const normalized = raw.map((scene, i): VideoSceneSpec => {
    if (!scene || typeof scene !== 'object') throw new Error(`scenes[${i}] must be an object`)
    if (typeof scene.slug !== 'string' || !scene.slug.trim()) throw new Error(`scenes[${i}].slug is required`)
    if (typeof scene.motionPrompt !== 'string' || !scene.motionPrompt.trim()) throw new Error(`scenes[${i}].motionPrompt is required`)
    if (typeof scene.durationSeconds !== 'number' || !clipSpec.allowedDurations.includes(scene.durationSeconds)) {
      throw new Error(`scenes[${i}].durationSeconds must be one of ${clipSpec.allowedDurations.join(', ')} for ${clipModelId ?? 'this tier'}`)
    }
    const continuity = scene.continuity ?? (i === 0 ? 'own-frame' : 'last-frame')
    if (continuity !== 'own-frame' && continuity !== 'last-frame') {
      throw new Error(`scenes[${i}].continuity must be 'own-frame' or 'last-frame'`)
    }
    if (i === 0 && continuity === 'last-frame') {
      throw new Error('scenes[0] cannot use last-frame continuity (no prior scene to source it from)')
    }
    // framePrompt only feeds the scene_frame composition, which last-frame
    // scenes skip entirely (their opening frame comes from the previous
    // scene's rendered clip). Required for own-frame scenes only.
    if (continuity === 'own-frame' && (typeof scene.framePrompt !== 'string' || !scene.framePrompt.trim())) {
      throw new Error(`scenes[${i}].framePrompt is required for own-frame scenes`)
    }
    total += scene.durationSeconds
    return {
      slug: scene.slug,
      motionPrompt: scene.motionPrompt,
      durationSeconds: scene.durationSeconds,
      continuity,
      ...(scene.framePrompt ? { framePrompt: scene.framePrompt } : {}),
      ...(typeof scene.reuseFrameAssetId === 'number' ? { reuseFrameAssetId: scene.reuseFrameAssetId } : {}),
    }
  })
  if (total > MULTI_SCENE_TOTAL_MAX_SECONDS) {
    throw new Error(`Total scene duration ${total}s exceeds the ${MULTI_SCENE_TOTAL_MAX_SECONDS}s multi-scene ceiling`)
  }
  return normalized
}

/**
 * Estimated all-in USD for a multi-scene job: sum over scenes of (frame cost
 * for own-frame scenes only, skipped on scene 0 when reuseFrame is set + clip
 * cost). Compound lipsync tier adds one TTS + lipsync pass over the TOTAL
 * duration (the lipsync stage performs the concatenated clip once, not per
 * scene) — mirrors estimateJobCostUsd's single-scene lipsync branch.
 */
export function estimateMultiSceneJobCostUsd(modelTier: VideoModelId, scenes: VideoSceneSpec[], opts: { reuseFrame?: boolean } = {}): number {
  const spec = VIDEO_MODELS[modelTier]
  const clipModelId = spec.lipsync ? spec.lipsync.baseClip : modelTier
  const clipSpec = VIDEO_MODELS[clipModelId]
  let total = 0
  scenes.forEach((scene, i) => {
    if (scene.continuity !== 'last-frame') {
      const skipFrame = i === 0 && !!opts.reuseFrame
      if (!skipFrame) {
        total += estimateImageCostUsd(SCENE_PLATE_COST_KEY, 1) + estimateImageCostUsd(SCENE_FRAME_COST_KEY, SCENE_FRAME_CANDIDATES)
      }
    }
    total += estimateVideoCostUsd(clipSpec.costKey, scene.durationSeconds)
  })
  if (spec.lipsync) {
    const totalDuration = scenes.reduce((s, sc) => s + sc.durationSeconds, 0)
    total += estimateVideoCostUsd(TTS_COST_KEY, totalDuration) + estimateVideoCostUsd(spec.costKey, totalDuration)
  }
  return Math.round(total * 1e5) / 1e5
}

type VideoJobRow = typeof videoJobs.$inferSelect

/**
 * Propose-time dry run for the episode API (ticket #5712): validate that a
 * script COULD render on the given tier and return its authoritative cost
 * estimate, without touching the database or spending anything. Runs the SAME
 * validateScenes the enqueue runs, so an unrenderable script is refused before
 * it ever reaches the owner's batch instead of failing on render day. Throws
 * with a human-readable message on any defect.
 */
export function dryRunEpisodeScript(script: VideoScriptJson, modelTier: VideoModelId): { estCostUsd: number; totalDurationSeconds: number } {
  const spec = VIDEO_MODELS[modelTier]
  if (!spec) throw new Error(`Unknown modelTier ${modelTier}`)
  if (isMultiSceneScript(script)) {
    if (spec.audioDriven) throw new Error('multi-scene scripts are not supported on the avatar tier')
    const scenes = validateScenes(script.scenes, spec)
    const total = scenes.reduce((s, sc) => s + sc.durationSeconds, 0)
    if (spec.lipsync) {
      const line = typeof script.presenterLine === 'string' ? script.presenterLine.trim() : ''
      if (!line) throw new Error('lipsync tier requires scriptJson.presenterLine')
      const speech = estimateAvatarSpeechSeconds(line)
      if (speech > total) throw new Error(`presenterLine estimates ${speech}s of speech but the scenes total ${total}s. Trim the line or lengthen the scenes.`)
    }
    return { estCostUsd: estimateMultiSceneJobCostUsd(modelTier, scenes), totalDurationSeconds: total }
  }
  if (spec.audioDriven) {
    const line = typeof script.presenterLine === 'string' ? script.presenterLine.trim() : ''
    if (!line) throw new Error('avatar tier requires scriptJson.presenterLine')
    const speech = estimateAvatarSpeechSeconds(line)
    if (speech > AVATAR_MAX_SPEECH_SECONDS) throw new Error(`presenterLine estimates ${speech}s, over the ${AVATAR_MAX_SPEECH_SECONDS}s avatar cap`)
    return { estCostUsd: estimateJobCostUsd(modelTier, speech, { speechSeconds: speech }), totalDurationSeconds: speech }
  }
  const dur = typeof script['durationSeconds'] === 'number' ? script['durationSeconds'] as number : NaN
  if (!spec.allowedDurations.includes(dur)) {
    throw new Error(`single-scene script needs scriptJson.durationSeconds in [${spec.allowedDurations.join(', ')}] for ${modelTier}`)
  }
  if (spec.lipsync) {
    const line = typeof script.presenterLine === 'string' ? script.presenterLine.trim() : ''
    if (!line) throw new Error('lipsync tier requires scriptJson.presenterLine')
    const speech = estimateAvatarSpeechSeconds(line)
    if (speech > dur) throw new Error(`presenterLine estimates ${speech}s of speech but the clip is ${dur}s`)
  }
  return { estCostUsd: estimateJobCostUsd(modelTier, dur), totalDurationSeconds: dur }
}

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
  /** Omit to fall back to the video_default_model_tier pipeline setting (getDefaultModelTier). */
  modelTier?: VideoModelId
  /** Ignored when scriptJson.scenes describes a multi-scene job (2+ entries) — the total there is the sum of scene durations. */
  durationSeconds: number
  targetPlatforms: string[]
  aiDisclosure?: boolean
  runId?: number
  /** Set by enqueueVideoJobSet — shared by every sibling expanded from one call. */
  variantGroupId?: string
  /** Which axis values this sibling got (labels Video Studio's set view). */
  variantAxes?: VariantAxes
  /**
   * Serialized program (ticket #5712): the video_episodes row this job
   * renders. The ROUTE enforces the approval + byte-identical-script guard
   * (assertEpisodeMatchesScript) before calling this; here it is only stored
   * on the row so learn-mode attribution and the Studio can join back.
   */
  episodeId?: number
}

async function getMaxCostCents(): Promise<number> {
  const cfg = await getTeamConfig('video').catch(() => null)
  return cfg?.maxCostCents ?? VIDEO_MAX_COST_CENTS_DEFAULT
}

/**
 * Model tier enqueueVideoJob/enqueueVideoJobSet fall back to when the caller
 * omits modelTier. Reads the same way getMaxCostCents' sibling frameReviewEnabled/
 * endcardEnabled do (plain getPipelineSetting call, not getTeamConfig — this is
 * NOT a 'video_team_%' key). No migration seeds `video_default_model_tier`, so
 * an unset or invalid stored value (typo, retired tier id) falls back to
 * VIDEO_DEFAULT_MODEL_TIER_DEFAULT rather than throwing — a bad setting write
 * can never brick every video enqueue.
 */
async function getDefaultModelTier(): Promise<VideoModelId> {
  const v = await getPipelineSetting(VIDEO_EXTRA_KEYS.defaultModelTier).catch(() => null)
  return isVideoModelId(v) ? v : (VIDEO_DEFAULT_MODEL_TIER_DEFAULT as VideoModelId)
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
  const modelTier = args.modelTier ?? await getDefaultModelTier()
  if (!isVideoModelId(modelTier)) throw new Error(`Unknown model tier: ${modelTier}`)
  const spec = VIDEO_MODELS[modelTier]
  const script = args.scriptJson
  const reuseFrame = typeof script.reuseFrameAssetId === 'number'

  // Multi-scene job (Phase 3, 20-60s videos): 2-8 scenes, validated + defaulted
  // here, become the pipeline's source of truth (scenes_json / scene_state_json)
  // — downstream stages never read scriptJson.scenes directly. The avatar tier
  // has no per-scene motionPrompt/allowedDurations concept at all (duration
  // derives from one presenterLine's speech), so it is out of scope; every
  // other tier, including the lipsync compound, is supported.
  const multiScene = isMultiSceneScript(script)
  let normalizedScenes: VideoSceneSpec[] | undefined
  let totalDurationSeconds = args.durationSeconds
  if (multiScene) {
    if (spec.audioDriven) {
      throw new Error('Multi-scene jobs are not supported on the avatar tier (no per-scene motion prompt); use a single scene or a different model tier.')
    }
    normalizedScenes = validateScenes(script.scenes, spec)
    totalDurationSeconds = normalizedScenes.reduce((s, sc) => s + sc.durationSeconds, 0)
  }

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
    // Multi-scene: per-scene durations were already validated against the base
    // clip model's allowedDurations in validateScenes; the speech-fits-duration
    // guard below uses totalDurationSeconds (the scene sum), not args.durationSeconds.
    if (!multiScene && !spec.allowedDurations.includes(args.durationSeconds)) {
      throw new Error(`${modelTier} does not support ${args.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
    }
    const speech = estimateAvatarSpeechSeconds(line)
    if (speech > totalDurationSeconds) {
      throw new Error(`presenterLine estimates ${speech}s of speech but the clip${multiScene ? 's total' : ' is'} ${totalDurationSeconds}s. Trim the line or lengthen the clip(s).`)
    }
  } else if (multiScene) {
    // Per-scene durations already validated in validateScenes.
  } else if (!spec.allowedDurations.includes(args.durationSeconds)) {
    throw new Error(`${modelTier} does not support ${args.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
  }

  // Hard per-video ceiling: refuse over-budget jobs BEFORE any spend, so a
  // model-tier misconfig cannot drain the daily budget one loop at a time.
  const estCostUsd = multiScene
    ? estimateMultiSceneJobCostUsd(modelTier, normalizedScenes!, { reuseFrame })
    : estimateJobCostUsd(modelTier, args.durationSeconds, {
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
    scriptJson: multiScene ? { ...args.scriptJson, scenes: normalizedScenes! } : args.scriptJson,
    aiDisclosure: args.aiDisclosure ?? true,
    modelTier,
    targetPlatforms: args.targetPlatforms,
    runId: args.runId ?? null,
    variantGroupId: args.variantGroupId ?? null,
    variantAxes: args.variantAxes ?? null,
    episodeId: args.episodeId ?? null,
    scenesJson: multiScene ? normalizedScenes : null,
    sceneStateJson: multiScene ? normalizedScenes!.map((): VideoSceneState => ({ status: 'pending' })) : null,
  })

  await kvDel(KV_KEYS.videoPollerIdle)
  console.log(`[video-pipeline] enqueued job ${jobId} product=${args.productHandle} formula=${args.formula} tier=${modelTier}`)
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
  /** Omit to fall back to the video_default_model_tier pipeline setting (getDefaultModelTier). */
  modelTier?: VideoModelId
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
  const modelTier = args.modelTier ?? await getDefaultModelTier()
  if (!isVideoModelId(modelTier)) throw new Error(`Unknown model tier: ${modelTier}`)
  const spec = VIDEO_MODELS[modelTier]

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
    const est = estimateJobCostUsd(modelTier, args.durationSeconds, {
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
      modelTier,
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

/**
 * Record the GPU-seconds a FAILED RunPod render already burned (ticket #5726).
 *
 * A job that times out or crashes was still billed for the time it ran, but
 * only the COMPLETED branches used to call logVideoCost — so a failure spent
 * real money that reached neither api_token_log nor the team budget gate, and
 * the endpoint's own history is 4 failures in 10 jobs. Best-effort and never
 * throws: this runs on the way to failing a job, and losing the accounting
 * must not also lose the error that caused it.
 *
 * `seconds` is the clip duration that was ATTEMPTED (logVideoCost drops a row
 * with no seconds); the money is carried by actualCostUsd either way.
 */
async function logRunpodBurn(args: {
  costKey: string
  executionMs: number
  seconds: number
  productHandle: string
  refId: string
  feature: 'video-clip' | 'video-avatar'
}): Promise<void> {
  if (!(args.executionMs > 0)) return
  try {
    const burnedUsd = computeRunpodActualCostUsd(args.executionMs)
    if (!(burnedUsd > 0)) return
    await logVideoCost({
      feature: args.feature,
      model: args.costKey,
      seconds: Math.max(1, args.seconds),
      caller: 'video-pipeline/failed',
      sku: args.productHandle,
      refId: args.refId,
      actualCostUsd: burnedUsd,
    })
    console.warn(`[video-pipeline] recorded $${burnedUsd.toFixed(4)} burned by failed runpod render ${args.refId}`)
  } catch (err) {
    console.error(`[video-pipeline] failed-render burn accounting lost for ${args.refId}:`, err)
  }
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

  // Backstop for a render run that claimed an episode and died before it
  // enqueued anything (ticket #5726). Runs on the idle path too — that is
  // exactly when a stranded claim exists, since a stranded claim has no job to
  // keep the poller busy. Best-effort: never block the advance pass.
  try {
    const { reapStaleEpisodeClaims } = await import('./video-episodes.server')
    await reapStaleEpisodeClaims()
  } catch (err) {
    console.error('[video-pipeline] stale episode-claim reap failed:', err)
  }

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
      // The episode this job was rendering has to come off 'rendering' with
      // it (ticket #5726). Nothing else writes that transition, so before this
      // a failed render left the row unclaimable AND undecidable: its episode
      // number spent, its open loop never closing, and no owner-visible reason
      // beyond the job's own red pill. Dynamic import: video-episodes.server
      // imports dryRunEpisodeScript from this module.
      if (job.episodeId != null) {
        try {
          const { markEpisodeRenderFailed } = await import('./video-episodes.server')
          await markEpisodeRenderFailed(job.episodeId, `job ${job.jobId} failed: ${String(err)}`)
        } catch (linkErr) {
          console.error(`[video-pipeline] could not fail episode ${job.episodeId} alongside job ${job.jobId}:`, linkErr)
        }
      }
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
  if (row?.frameId != null) return row.frameId

  // Multi-scene jobs park their approved frames in scene_state_json (the
  // top-level sceneFrameAssetId stays null), so an episode's standing-set
  // frame approved once must be findable here too or every later episode
  // recomposes the presenter (ticket #5714). A scene state at 'frame' or
  // beyond means the owner picked those pixels (or the valve auto-picked);
  // failed jobs are excluded because an owner rejection may be ABOUT the frame.
  const multi = await db.execute(sql`
    SELECT (st.state->>'frameAssetId')::int AS frame_id
    FROM video_jobs j
    JOIN LATERAL jsonb_array_elements(j.scenes_json) WITH ORDINALITY AS sc(scene, i) ON true
    JOIN LATERAL jsonb_array_elements(j.scene_state_json) WITH ORDINALITY AS st(state, k) ON st.k = sc.i
    WHERE j.scenes_json IS NOT NULL
      AND sc.scene->>'slug' = ${sceneSlug}
      AND j.presenter = ${presenter}
      AND st.state->>'frameAssetId' IS NOT NULL
      AND st.state->>'status' IN ('frame', 'clip', 'done')
      AND j.stage <> 'failed'
      ${excludeJobRowId != null ? sql`AND j.id <> ${excludeJobRowId}` : sql``}
    ORDER BY j.created_at DESC
    LIMIT 1
  `)
  const frameId = (multi.rows?.[0] as { frame_id?: number } | undefined)?.frame_id
  return typeof frameId === 'number' ? frameId : null
}

async function advanceSceneFrame(job: VideoJobRow): Promise<AdvanceOutcome> {
  if (job.scenesJson && job.scenesJson.length >= MULTI_SCENE_MIN) {
    return advanceSceneFrameMultiScene(job, job.scenesJson)
  }

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

/**
 * Multi-scene scene_frame stage: compose ONE own-frame scene's candidates per
 * tick (never all of them in one pass — mirrors the submit-or-poll discipline
 * everywhere else in this file). 'last-frame' scenes need nothing here; their
 * opening frame comes from the previous scene's rendered clip at the clip
 * stage. Once every own-frame scene has cleared the gate, advance to 'clip'.
 */
async function advanceSceneFrameMultiScene(job: VideoJobRow, scenes: VideoSceneSpec[]): Promise<AdvanceOutcome> {
  const state: VideoSceneState[] = job.sceneStateJson ?? scenes.map((): VideoSceneState => ({ status: 'pending' }))

  const idx = scenes.findIndex((s, i) => s.continuity !== 'last-frame' && (state[i]?.status ?? 'pending') === 'pending')
  if (idx === -1) {
    // Every own-frame scene has an approved frame (status 'frame' or later);
    // last-frame scenes have nothing to compose. Hand off to the clip stage.
    await touch(job, { stage: 'clip', status: 'queued' })
    return 'progressed'
  }

  const scene = scenes[idx]!

  // Scene-frame REUSE, ported from the single-scene path (ticket #5714). A
  // multi-scene talking job must NOT recompose the presenter every episode:
  // identity drift is fatal for a recurring cast, and a reused frame also
  // skips the owner's park (no new pixels to review). Explicit per-scene
  // reuseFrameAssetId wins; else a slug-keyed hit on an approved
  // same-presenter frame adopts automatically.
  {
    const jobSpec = VIDEO_MODELS[job.modelTier as VideoModelId]
    const reusable = job.scriptJson['talkingHead'] === true || !!jobSpec?.audioDriven || !!jobSpec?.lipsync
    const explicitId = typeof scene.reuseFrameAssetId === 'number' ? scene.reuseFrameAssetId : null
    let adoptId: number | null = null
    if (explicitId != null) {
      if (!reusable) throw new Error(`scenes[${idx}].reuseFrameAssetId applies only to avatar/talking-head jobs`)
      const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, explicitId)).limit(1)
      if (!asset || asset.purpose !== 'scene_frame') {
        throw new Error(`scenes[${idx}].reuseFrameAssetId ${explicitId} does not reference a scene-frame asset`)
      }
      const [approvedBy] = await db
        .select({ id: videoJobs.id })
        .from(videoJobs)
        .where(and(
          eq(videoJobs.sceneFrameAssetId, explicitId),
          eq(videoJobs.presenter, job.presenter),
          inArray(videoJobs.stage, FRAME_APPROVED_STAGES),
        ))
        .limit(1)
      if (!approvedBy) {
        throw new Error(`scenes[${idx}].reuseFrameAssetId ${explicitId} has never been approved for presenter '${job.presenter}'`)
      }
      adoptId = explicitId
    } else if (reusable && scene.slug) {
      adoptId = await findReusableSceneFrame(scene.slug, job.presenter, job.id)
    }
    if (adoptId != null) {
      const adopted: VideoSceneState[] = state.map((s, i) =>
        i === idx ? { ...s, frameAssetId: adoptId!, status: 'frame' } : s,
      )
      await touch(job, { sceneStateJson: adopted })
      return 'progressed'
    }
  }

  // idx only ever lands on an own-frame scene (see findIndex above), which
  // validateScenes guarantees carries a framePrompt. This is a belt-and-
  // braces check, not an expected runtime path.
  if (!scene.framePrompt) throw new Error(`scenes[${idx}].framePrompt is required for own-frame scenes`)
  const talkingHead = job.scriptJson['talkingHead'] === true
  const presenterUrl = await resolvePresenterPhotoUrl(job.presenter)
  if (talkingHead && !presenterUrl) throw new Error('talkingHead requires a presenter (emma or friend:{slug})')
  const productUrl = talkingHead ? null : await resolveProductImageUrl(job.productHandle)
  const baseImageUrl = presenterUrl ?? productUrl
  if (!baseImageUrl) throw new Error(`No reference image available for scene ${idx} composition`)

  const { urls, requestIds, costKey, plate, plateRequestId } = await composeSceneFrame({
    prompt: scene.framePrompt,
    presenterImageUrl: baseImageUrl,
    ...(productUrl ? { productImageUrl: productUrl } : {}),
    count: SCENE_FRAME_CANDIDATES,
  })

  // Same Blob-promptness + per-candidate cost-log discipline as the
  // single-scene path (see the comment above it), keyed to this scene index so
  // Video Studio and the blob path can group candidates back to their scene:
  // video/<jobId>/scene-<idx>-frame-<i>.jpg — parsed back out in listVideoJobs.
  const assetIds: number[] = []
  for (let i = 0; i < urls.length; i++) {
    const buf = await downloadFalAsset(urls[i]!)
    const { url } = await blobPut(`video/${job.jobId}/scene-${idx}-frame-${i}.jpg`, buf, { contentType: 'image/jpeg' })
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
        refId: `${job.jobId}#scene-${idx}-frame-${i}`,
        ...(rid ? { requestId: rid } : {}),
      })
    }
  }
  if (!assetIds.length) throw new Error(`Scene ${idx} frame composition produced no candidates`)

  if (plate) {
    void logImageCost({
      feature: 'video-frames',
      model: plate.costKey,
      count: plate.count,
      caller: 'video-pipeline/plate',
      sku: job.productHandle,
      refId: `${job.jobId}#scene-${idx}`,
      ...(plateRequestId ? { requestId: plateRequestId } : {}),
    })
  }
  const frameCost = estimateImageCostUsd(costKey, assetIds.length)
    + (plate ? estimateImageCostUsd(plate.costKey, plate.count) : 0)
  const newCost = Number(job.costUsd) + frameCost
  const chosen = assetIds[0]!
  const reviewEnabled = await frameReviewEnabled()

  const nextState: VideoSceneState[] = state.map((s, i) =>
    i === idx ? { ...s, frameAssetId: chosen, status: reviewEnabled ? 'awaiting_frame_approval' : 'frame' } : s,
  )

  if (reviewEnabled) {
    await touch(job, { status: 'awaiting_frame_approval', sceneStateJson: nextState, costUsd: String(newCost) })
    return 'parked'
  }

  // Valve off: auto-approved, but still only one scene per tick — the next
  // tick's findIndex picks up the NEXT pending own-frame scene, or (once every
  // own-frame scene has cleared) transitions to 'clip'.
  await touch(job, { sceneStateJson: nextState, costUsd: String(newCost) })
  return 'progressed'
}

// ─── Stage: clip ─────────────────────────────────────────────────────────────

async function advanceClip(job: VideoJobRow): Promise<AdvanceOutcome> {
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  if (!spec) throw new Error(`Unknown model tier ${job.modelTier}`)
  if (job.scenesJson && job.scenesJson.length >= MULTI_SCENE_MIN) return advanceClipMultiScene(job, spec, job.scenesJson)
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

    // RunPod provider (Phase 2, Wan 2.2 14B): the worker uploads its own mp4
    // straight to Blob, so there is nothing to download/re-upload here, and
    // its /run + /status protocol is different enough from fal's queue that
    // it gets its own submit + poll branches rather than reusing
    // submitVideoRequest/getVideoRequestStatus. Mode is always i2v: the scene
    // frame is approved before the pipeline ever reaches the clip stage
    // (FRAME_APPROVED_STAGES), so there is always an image to hand the worker.
    // No submit-time api_token_log entry for a runpod clip — the ESTIMATE
    // never lands there at all, only the ACTUAL metered cost does, once the
    // job completes in the poll branch below. job.costUsd still accrues the
    // estimate now so the per-video ceiling stays enforced while in flight.
    if (clipSpec.provider === 'runpod') {
      const handle = await submitRunpodVideo({
        prompt: motionPrompt,
        imageUrl: frame.blobUrl,
        durationSeconds,
        mode: 'i2v',
        blobPathPrefix: `video/${job.jobId}`,
      })
      await touch(job, {
        status: 'awaiting_provider',
        providerRequestIds: { ...handles, clip: handle },
        costUsd: String(Number(job.costUsd) + clipCost),
      })
      return 'progressed'
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

  // Poll — RunPod provider. Same clip/lipsync model resolution the submit
  // branch used, recomputed here since it is scoped inside the `if
  // (!existing)` block above.
  const pollClipModelId = spec.lipsync ? spec.lipsync.baseClip : job.modelTier as VideoModelId
  const pollClipSpec = VIDEO_MODELS[pollClipModelId]
  if (pollClipSpec.provider === 'runpod') {
    const { status, executionMs } = await getRunpodStatus(existing as QueueHandle)
    if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
      await touch(job, {}) // heartbeat so ordering stays fair
      return 'waiting'
    }
    if (status === 'FAILED') {
      const failedScript = job.scriptJson
      await logRunpodBurn({
        costKey: pollClipSpec.costKey,
        executionMs,
        seconds: typeof failedScript['durationSeconds'] === 'number' ? failedScript['durationSeconds'] as number : spec.allowedDurations[0] ?? 5,
        productHandle: job.productHandle,
        refId: job.jobId,
        feature: 'video-clip',
      })
      throw new Error('runpod video generation failed')
    }

    const result = await getRunpodResult(existing as QueueHandle)
    // Worker already wrote the mp4 to Blob under blobPathPrefix — no
    // download/re-upload, just record the URL it returned.
    const actualCost = computeRunpodActualCostUsd(result.executionMs)
    // Replace the submit-time ESTIMATE with the metered ACTUAL on the job
    // row. durationSeconds is recomputed the same deterministic way the
    // estimate was (scriptJson.durationSeconds, or the spec's first allowed
    // duration), so the subtraction exactly reverses what submit added.
    const pollScript = job.scriptJson
    const pollDurationSeconds = typeof pollScript['durationSeconds'] === 'number'
      ? pollScript['durationSeconds'] as number
      : spec.allowedDurations[0]!
    const estimatedClipCost = estimateVideoCostUsd(pollClipSpec.costKey, pollDurationSeconds)
    await db.insert(mediaAssets).values({
      kind: 'video',
      purpose: 'clip',
      blobUrl: result.videoUrl,
      contentType: 'video/mp4',
      sourceModel: pollClipSpec.costKey,
      costUsd: String(actualCost),
      videoJobId: job.id,
    })
    void logVideoCost({
      feature: 'video-clip',
      model: pollClipSpec.costKey,
      seconds: pollDurationSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
      actualCostUsd: actualCost,
    })
    await touch(job, {
      stage: 'lipsync',
      status: 'queued',
      costUsd: String(Number(job.costUsd) - estimatedClipCost + actualCost),
    })
    return 'progressed'
  }

  // Poll — fal provider.
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

/**
 * Multi-scene clip stage: render scenes in order, one per tick. 'own-frame'
 * scenes animate their approved frame (scene_frame stage); 'last-frame'
 * scenes animate the PREVIOUS scene's rendered clip's final frame instead —
 * RunPod's worker returns it directly (result.lastFrameUrl); fal providers
 * get it via video-assembly's extractLastFrame. Once every scene is done, the
 * per-scene clips are concatenated (concatAndNormalize) into ONE 'clip'-purpose
 * media_assets row — the newest such row — and the job hands off to
 * `stage: 'lipsync'` exactly as the single-clip path does, so advanceLipsync /
 * advanceLipsyncPerform / advanceAssembly / advancePoster need no multi-scene
 * branch of their own: they already resolve "the clip" via
 * latestAssetByPurpose, which now returns this concatenated row.
 */
async function advanceClipMultiScene(job: VideoJobRow, spec: VideoModelSpec, scenes: VideoSceneSpec[]): Promise<AdvanceOutcome> {
  const state: VideoSceneState[] = job.sceneStateJson ?? scenes.map((): VideoSceneState => ({ status: 'pending' }))
  // Compound lipsync tier: scenes render on the base model; the lipsync model
  // performs the CONCATENATED result afterward (same resolution advanceClip's
  // single-scene submit branch uses).
  const clipModelId = spec.lipsync ? spec.lipsync.baseClip : job.modelTier as VideoModelId
  const clipSpec = VIDEO_MODELS[clipModelId]
  const handles = job.providerRequestIds

  const idx = state.findIndex(s => s.status !== 'done')
  if (idx === -1) {
    // Every scene rendered — concatenate into ONE clip asset (free: ffmpeg
    // concat, no model spend) and hand off exactly like the single-clip path.
    const buffers: Buffer[] = []
    for (const s of state) {
      if (!s.clipAssetId) throw new Error('Multi-scene clip stage: a finished scene is missing its clipAssetId')
      const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, s.clipAssetId)).limit(1)
      if (!asset) throw new Error(`Multi-scene clip stage: clip asset ${s.clipAssetId} not found`)
      buffers.push(await blobFetchToBuffer(asset.blobUrl))
    }
    const merged = await concatAndNormalize(buffers)
    const { url } = await blobPut(`video/${job.jobId}/clip-concat.mp4`, merged, { contentType: 'video/mp4' })
    await db.insert(mediaAssets).values({
      kind: 'video',
      purpose: 'clip',
      blobUrl: url,
      contentType: 'video/mp4',
      sourceModel: clipSpec.costKey,
      videoJobId: job.id,
    })
    await touch(job, { stage: 'lipsync', status: 'queued' })
    return 'progressed'
  }

  const scene = scenes[idx]!
  const sceneKey = `scene_${idx}`
  const existing = handles[sceneKey]

  if (!existing) {
    // Submit this scene's clip. Ceiling checks first: the per-scene re-check
    // is the backstop, and at scene 0 the WHOLE remaining job is checked up
    // front (ticket #5714) — the old per-scene-only check could burn scenes
    // 0-4 of real money and then throw at scene 5, marking the row failed
    // with nothing shippable to show for the spend.
    const clipCost = estimateVideoCostUsd(clipSpec.costKey, scene.durationSeconds)
    const maxCents = await getMaxCostCents()
    if (idx === 0) {
      const wholeJobUsd = estimateMultiSceneJobCostUsd(job.modelTier as VideoModelId, scenes, { reuseFrame: true })
      if ((Number(job.costUsd) + wholeJobUsd) * 100 > maxCents) {
        throw new Error(`Accrued + full remaining render estimate $${wholeJobUsd.toFixed(2)} would exceed the per-video ceiling ($${(maxCents / 100).toFixed(2)}); refusing before the first scene spends`)
      }
    }
    if ((Number(job.costUsd) + clipCost) * 100 > maxCents) {
      throw new Error(`Accrued + scene ${idx} clip cost would exceed the per-video ceiling ($${(maxCents / 100).toFixed(2)})`)
    }

    let frameUrl: string
    if (scene.continuity === 'last-frame') {
      const prior = state[idx - 1]
      if (!prior?.lastFrameUrl) throw new Error(`Scene ${idx} needs the previous scene's last frame, but none was captured`)
      frameUrl = prior.lastFrameUrl
    } else {
      const frameAssetId = state[idx]?.frameAssetId
      if (!frameAssetId) throw new Error(`Scene ${idx} has no approved frame to animate`)
      const [frame] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, frameAssetId)).limit(1)
      if (!frame) throw new Error(`Scene ${idx} approved frame asset not found`)
      frameUrl = frame.blobUrl
    }

    // Same grok resolution guard as the single-scene submit branch (ticket #3991).
    if (clipModelId === 'grok') {
      const frameBuf = await blobFetchToBuffer(frameUrl)
      const { width, height } = await probeImageDimensions(frameBuf)
      assertSceneFrameContract(width, height)
    }

    if (clipSpec.provider === 'runpod') {
      const handle = await submitRunpodVideo({
        prompt: scene.motionPrompt,
        imageUrl: frameUrl,
        durationSeconds: scene.durationSeconds,
        mode: 'i2v',
        blobPathPrefix: `video/${job.jobId}/scene-${idx}`,
      })
      await touch(job, {
        status: 'awaiting_provider',
        providerRequestIds: { ...handles, [sceneKey]: handle },
        costUsd: String(Number(job.costUsd) + clipCost),
      })
      return 'progressed'
    }

    const handle = await submitVideoRequest(clipModelId, {
      prompt: scene.motionPrompt,
      imageUrl: frameUrl,
      durationSeconds: scene.durationSeconds,
      aspect: '9:16',
    })
    void logVideoCost({
      feature: 'video-clip',
      model: clipSpec.costKey,
      seconds: scene.durationSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: `${job.jobId}#scene-${idx}`,
    })
    await touch(job, {
      status: 'awaiting_provider',
      providerRequestIds: { ...handles, [sceneKey]: handle },
      costUsd: String(Number(job.costUsd) + clipCost),
    })
    return 'progressed'
  }

  // Poll this scene's clip. Only extract a last-frame plate when the NEXT
  // scene actually needs one — skips a free-but-unnecessary ffmpeg call.
  const needsLastFrame = idx + 1 < scenes.length && scenes[idx + 1]!.continuity === 'last-frame'

  if (clipSpec.provider === 'runpod') {
    const { status, executionMs } = await getRunpodStatus(existing as QueueHandle)
    if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
      await touch(job, {}) // heartbeat so ordering stays fair
      return 'waiting'
    }
    if (status === 'FAILED') {
      await logRunpodBurn({
        costKey: clipSpec.costKey,
        executionMs,
        seconds: scene.durationSeconds,
        productHandle: job.productHandle,
        refId: `${job.jobId}#scene-${idx}`,
        feature: 'video-clip',
      })
      throw new Error(`runpod video generation failed (scene ${idx})`)
    }

    const result = await getRunpodResult(existing as QueueHandle)
    if (needsLastFrame && !result.lastFrameUrl) {
      throw new Error(`Scene ${idx}'s RunPod result is missing lastFrameUrl, needed by scene ${idx + 1}'s last-frame continuity`)
    }
    const actualCost = computeRunpodActualCostUsd(result.executionMs)
    const estimatedClipCost = estimateVideoCostUsd(clipSpec.costKey, scene.durationSeconds)
    const [row] = await db.insert(mediaAssets).values({
      kind: 'video',
      purpose: 'clip',
      blobUrl: result.videoUrl,
      contentType: 'video/mp4',
      sourceModel: clipSpec.costKey,
      costUsd: String(actualCost),
      videoJobId: job.id,
    }).returning({ id: mediaAssets.id })
    if (!row) throw new Error(`Scene ${idx} clip asset insert failed`)
    void logVideoCost({
      feature: 'video-clip',
      model: clipSpec.costKey,
      seconds: scene.durationSeconds,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: `${job.jobId}#scene-${idx}`,
      actualCostUsd: actualCost,
    })
    const nextState: VideoSceneState[] = state.map((s, i) =>
      i === idx ? { ...s, clipAssetId: row.id, status: 'done', ...(result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : {}) } : s,
    )
    await touch(job, {
      status: 'queued',
      sceneStateJson: nextState,
      costUsd: String(Number(job.costUsd) - estimatedClipCost + actualCost),
    })
    return 'progressed'
  }

  // Poll — fal provider.
  const { status } = await getVideoRequestStatus(existing as QueueHandle)
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
    await touch(job, {}) // heartbeat so ordering stays fair
    return 'waiting'
  }
  if (status === 'FAILED') throw new Error(`fal video generation failed (scene ${idx})`)

  const result = await getVideoRequestResult(existing as QueueHandle)
  const buf = await downloadFalAsset(result.videoUrl)
  const { url } = await blobPut(`video/${job.jobId}/scene-${idx}-clip.mp4`, buf, { contentType: 'video/mp4' })
  let lastFrameUrl: string | undefined
  if (needsLastFrame) {
    const lastFrameBuf = await extractLastFrame(buf)
    const put = await blobPut(`video/${job.jobId}/scene-${idx}-lastframe.jpg`, lastFrameBuf, { contentType: 'image/jpeg' })
    lastFrameUrl = put.url
  }
  const [row] = await db.insert(mediaAssets).values({
    kind: 'video',
    purpose: 'clip',
    blobUrl: url,
    contentType: 'video/mp4',
    sourceModel: clipSpec.costKey,
    videoJobId: job.id,
  }).returning({ id: mediaAssets.id })
  if (!row) throw new Error(`Scene ${idx} clip asset insert failed`)
  const nextState: VideoSceneState[] = state.map((s, i) =>
    i === idx ? { ...s, clipAssetId: row.id, status: 'done', ...(lastFrameUrl ? { lastFrameUrl } : {}) } : s,
  )
  await touch(job, { status: 'queued', sceneStateJson: nextState })
  return 'progressed'
}

// ─── Stage: clip (avatar tier, audio-first OmniHuman) ───────────────────────

/**
 * Part keys double as providerRequestIds keys and media_assets purposes so
 * assembly can pick the parts back up in order: clip, clip_b, clip_c, ...
 * With the 35s speech cap and 24s part budget that is two parts in practice,
 * but the key scheme and the poll/assembly loops handle any count.
 */
// Provisional per-render caps for the own-worker audio-driven tier (ticket
// #5714). PENDING THE BAKE-OFF (docs/store-team/video-worker-runpod.md): the
// real chunking behavior of the chosen model replaces these numbers; until
// then a 60s line renders as one part and the worker's execution timeout is
// the hard backstop.
const S2V_MAX_RENDER_SECONDS = 60
const S2V_PART_MAX_SECONDS = 55

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

    const isRunpodAvatar = spec.provider === 'runpod'
    const parts = isRunpodAvatar ? splitPresenterLine(line, S2V_PART_MAX_SECONDS) : splitPresenterLine(line)
    if (!parts.length) throw new Error('presenterLine produced no speakable parts')

    const tone = isVideoTone(job.scriptJson['presenterTone']) ? job.scriptJson['presenterTone'] : undefined
    const voiceId = await getActiveIvrVoiceId()
    const audios: Buffer[] = []
    const partSeconds: number[] = []
    const wordTimings: WordTiming[] = []
    let timingsComplete = true
    let totalSpeechSeconds = 0
    const perRenderCap = isRunpodAvatar ? S2V_MAX_RENDER_SECONDS : OMNIHUMAN_MAX_RENDER_SECONDS
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
      if (seconds > perRenderCap - 0.5) {
        throw new Error(`TTS part runs ${seconds.toFixed(1)}s, over the ${perRenderCap}s per-render cap for this tier. Shorten presenterLine (or break long sentences up so the splitter can work) and re-enqueue.`)
      }
      if (alignment) {
        // Offset by the REAL accumulated seconds of prior parts — the parts
        // concat in assembly, so cumulative timing survives the join.
        wordTimings.push(...charAlignmentToWordTimings(alignment, totalSpeechSeconds))
      } else {
        timingsComplete = false
      }
      audios.push(audio)
      partSeconds.push(seconds)
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

    const newHandles: Record<string, QueueHandle> = {}
    if (isRunpodAvatar) {
      // Own-worker audio-driven tier (ticket #5714): frame and speech never
      // leave our infrastructure. The frame's Blob URL is already public; each
      // speech part parks on Blob for the worker to fetch; the worker (mode
      // 's2v', ticket #5713) performs the part and uploads the mp4 itself.
      // Like the clip stage's runpod branch, NO submit-time api_token_log row:
      // only the metered actual lands there, in the poll branch. job.costUsd
      // still accrues the estimate now so the ceiling stays enforced.
      for (let i = 0; i < audios.length; i++) {
        const { url: audioUrl } = await blobPut(`video/${job.jobId}/speech-${i}.mp3`, audios[i]!, { contentType: 'audio/mpeg' })
        newHandles[avatarPartKey(i)] = await submitRunpodVideo({
          prompt: tone ? TONE_EXPRESSION[tone] : '',
          imageUrl: frame.blobUrl,
          audioUrl,
          durationSeconds: Math.ceil(partSeconds[i]!),
          mode: 's2v',
          blobPathPrefix: `video/${job.jobId}/part-${i}`,
        })
      }
    } else {
      const frameBuf = await blobFetchToBuffer(frame.blobUrl)
      const imageUrl = await uploadToFalStorage(frameBuf, 'image/jpeg', `frame-${job.jobId}.jpg`)
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
    }

    // Persist word timings alongside the handles: assembly runs on a later
    // cron tick and reads them back off the row. Partial coverage (some part
    // returned no alignment) is dropped wholesale — mistimed cues are worse
    // than the char-proportional fallback.
    const scriptWithTimings: VideoScriptJson = { ...job.scriptJson }
    if (timingsComplete && wordTimings.length) scriptWithTimings.wordTimings = wordTimings
    else delete scriptWithTimings.wordTimings

    await touch(job, {
      status: 'awaiting_provider',
      providerRequestIds: {
        ...handles,
        ...newHandles,
        // Non-handle bookkeeping key (assembly_attempts precedent): the poll
        // branch reverses the submit-time ESTIMATE with the metered actual,
        // and the real billed speech seconds are not otherwise recoverable.
        ...(isRunpodAvatar ? ({ avatar_billed_seconds: billedSeconds } as unknown as Record<string, QueueHandle>) : {}),
      },
      scriptJson: scriptWithTimings,
      costUsd: String(Number(job.costUsd) + clipCost + ttsCost),
    })
    return 'progressed'
  }

  // Poll pass: wait for EVERY part, then persist them all in one go.
  const activeKeys = avatarPartKeys(handles)

  if (spec.provider === 'runpod') {
    for (const key of activeKeys) {
      const { status, executionMs } = await getRunpodStatus(handles[key] as QueueHandle)
      if (status === 'FAILED') {
        // One failed part fails the job, but every part that already ran was
        // billed; record this one's burn on the way out (ticket #5726). The
        // sibling parts' burns land when their own poll sees them terminal,
        // or are lost — an accepted floor, not a silent zero.
        const billedRaw = (handles as Record<string, unknown>)['avatar_billed_seconds']
        await logRunpodBurn({
          costKey: spec.costKey,
          executionMs,
          seconds: typeof billedRaw === 'number' && billedRaw > 0 ? billedRaw : 1,
          productHandle: job.productHandle,
          refId: `${job.jobId}#${key}`,
          feature: 'video-avatar',
        })
        throw new Error(`runpod avatar render failed (${key})`)
      }
      if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
        await touch(job, {}) // heartbeat so ordering stays fair
        return 'waiting'
      }
    }
    let actualTotal = 0
    for (const key of activeKeys) {
      const result = await getRunpodResult(handles[key] as QueueHandle)
      const actualCost = computeRunpodActualCostUsd(result.executionMs)
      actualTotal += actualCost
      // Worker already wrote the mp4 to Blob — record its URL, no re-upload.
      await db.insert(mediaAssets).values({
        kind: 'video',
        purpose: key,
        blobUrl: result.videoUrl,
        contentType: 'video/mp4',
        sourceModel: spec.costKey,
        costUsd: String(actualCost),
        videoJobId: job.id,
      })
    }
    // Reverse the submit-time estimate with the metered actual (same
    // discipline as the clip stage's runpod poll branch).
    const billedRaw = (handles as Record<string, unknown>)['avatar_billed_seconds']
    const billed = typeof billedRaw === 'number' ? billedRaw : 0
    const estimated = billed > 0 ? estimateVideoCostUsd(spec.costKey, billed) : 0
    void logVideoCost({
      feature: 'video-avatar',
      model: spec.costKey,
      seconds: billed,
      caller: 'video-pipeline',
      sku: job.productHandle,
      refId: job.jobId,
      actualCostUsd: actualTotal,
    })
    await touch(job, {
      stage: 'lipsync',
      status: 'queued',
      costUsd: String(Number(job.costUsd) - estimated + actualTotal),
    })
    return 'progressed'
  }

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

// TTS_COST_KEY is declared near the top of the file (multi-scene cost
// estimator shares it).

/** Record which audio path a job took, for the console job trail (ticket #3996). */
function logAudioPath(job: VideoJobRow, path: AudioPath): void {
  console.info(`[video-pipeline] job ${job.jobId} audio path: ${path} (tier ${job.modelTier})`)
}

async function advanceLipsync(job: VideoJobRow): Promise<AdvanceOutcome> {
  // The old skip keyed on nativeAudio, which conflated two opposite things: an
  // audio-DRIVEN avatar performing OUR ElevenLabs track (keep it), and a model
  // that INVENTS its own dialogue in a non-Emma voice no gate read (never ship
  // it). classifyAudioPath separates them; see fal-video.server.ts.
  //   - authored:      OmniHuman / lipsync perform our track; never re-mux.
  //   - overdubbed:    voiceover exists, so Emma's track REPLACES the clip's
  //                    audio (silent Kling OR an invented veo/seedance/grok track).
  //   - stripped:      no voiceover + inventsDialogue: silence the invented track.
  //   - native-silent: no voiceover + no invented audio (Kling): pass through.
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  if (spec?.lipsync) return advanceLipsyncPerform(job, spec)

  const voiceover = typeof job.scriptJson['voiceover'] === 'string' ? (job.scriptJson['voiceover'] as string).trim() : ''
  const path: AudioPath = spec ? classifyAudioPath(spec, voiceover.length > 0) : (voiceover ? 'overdubbed' : 'native-silent')

  if (path === 'authored' || path === 'native-silent') {
    logAudioPath(job, path)
    await touch(job, { stage: 'assembly', status: 'queued' })
    return 'progressed'
  }

  if (path === 'stripped') {
    // The model wrote and spoke its own dialogue; strip it to silence so an
    // unreviewed, non-Emma voice never ships on an owned channel. The strip
    // helper leaves a silent audio track so the end card concat and watermark
    // stream-copy still have a stream to work with.
    const clip = await latestAssetByPurpose(job.id, 'clip')
    if (!clip) throw new Error('No clip asset to strip')
    const clipBuf = await blobFetchToBuffer(clip.blobUrl)
    const silent = await stripAudio(clipBuf)
    const { url } = await blobPut(`video/${job.jobId}/clip-silent.mp4`, silent, { contentType: 'video/mp4' })
    // Same purpose as the source clip: assembly picks the newest 'clip' asset.
    await db.insert(mediaAssets).values({
      kind: 'video',
      purpose: 'clip',
      blobUrl: url,
      contentType: 'video/mp4',
      sourceModel: `${spec!.costKey}+strip`,
      videoJobId: job.id,
    })
    logAudioPath(job, path)
    await touch(job, { stage: 'assembly', status: 'queued' })
    return 'progressed'
  }

  // path === 'overdubbed': mux Emma's ElevenLabs voiceover over the clip. muxAudio
  // maps 0:v + 1:a, so the model's own track (if any) is dropped, not mixed.
  logAudioPath(job, path)
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

    // Speech must fit inside the rendered clip (ticket #5714): sync's cut_off
    // mode truncates the longer track, and Wan renders run slightly long of
    // their nominal duration, so compare against the REAL clip. Failing here
    // costs the $0.18 TTS just booked, not the $3 lipsync pass.
    const clipSeconds = await probeDurationSeconds(clipBuf)
    if (clipSeconds > 0 && speechSeconds > clipSeconds - 0.5) {
      throw new Error(`presenterLine speech runs ${speechSeconds.toFixed(1)}s but the rendered clip is ${clipSeconds.toFixed(1)}s; the performance would truncate mid-word. Trim the line or lengthen the scenes.`)
    }

    const videoUrl = await uploadToFalStorage(clipBuf, 'video/mp4', `clip-${job.jobId}.mp4`)
    const audioUrl = await uploadToFalStorage(audio, 'audio/mpeg', `speech-${job.jobId}.mp3`)

    // Route by the job's own tier (ticket #5714): this was hardcoded to
    // 'sync-lipsync', which mis-submits (and structurally disagrees with the
    // spec-keyed cost log below) the moment a second lipsync tier exists.
    const handle = await submitVideoRequest(job.modelTier as VideoModelId, {
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

  // RunPod off-confirmation (ticket #5717). Ordering is load-bearing: this
  // sits AFTER the terminal write, in its own catch, so a RunPod API hiccup
  // can never turn a finished, paid-for video into a failed row.
  if (jobUsedRunpod(job)) {
    try {
      await confirmRunpodIdle(job.id)
    } catch (err) {
      console.warn(`[video-pipeline] job ${job.jobId} runpod idle probe failed:`, err)
    }
  }
  return 'done'
}

// ─── RunPod off-confirmation (ticket #5717) ─────────────────────────────────

/**
 * True when this job's render path touched the RunPod serverless endpoint:
 * the job's own tier, a compound tier's base clip, or (per-scene tiers,
 * later) any scene's tier. Derived, never stored — a stored flag would be a
 * fourth writer on a row three things already write.
 */
export function jobUsedRunpod(job: Pick<VideoJobRow, 'modelTier' | 'scenesJson'>): boolean {
  const spec = VIDEO_MODELS[job.modelTier as VideoModelId]
  if (!spec) return false
  if (spec.provider === 'runpod') return true
  const base = spec.lipsync ? VIDEO_MODELS[spec.lipsync.baseClip] : undefined
  if (base?.provider === 'runpod') return true
  return (job.scenesJson ?? []).some(sc => {
    const t = (sc as { modelTier?: string }).modelTier
    return typeof t === 'string' && VIDEO_MODELS[t as VideoModelId]?.provider === 'runpod'
  })
}

/**
 * Probe BOTH RunPod surfaces (the serverless endpoint's workers/queue AND the
 * hourly-billed pods list) and stamp the result on the job row. The pods list
 * alone is a permanent false all-clear for the render fleet: video renders on
 * the endpoint, which that list never contains.
 *
 * Three outcomes, never conflated (the owner-blocker guardedRun discipline):
 *   clear: true    both reads succeeded AND both are zero -> confirmedAt set
 *   clear: false   a read succeeded and found work still up
 *   couldNotAsk    a read threw; recorded by surface name, NEVER an all-clear
 *
 * Never throws: the caller sits AFTER the terminal stage write, and a RunPod
 * API hiccup must never turn a finished, paid-for video into a failed row.
 */
export async function confirmRunpodIdle(jobRowId: number): Promise<RunpodIdleProbe> {
  const probe: RunpodIdleProbe = {
    checkedAt: new Date().toISOString(),
    endpoint: null,
    pods: null,
    clear: false,
    couldNotAsk: [],
  }
  try {
    const { getRunpodEndpointHealth } = await import('./runpod-endpoint.server')
    probe.endpoint = await getRunpodEndpointHealth()
  } catch {
    probe.couldNotAsk.push('endpoint')
  }
  try {
    const { listRunningRunpodPods } = await import('./runpod-pods.server')
    const pods = await listRunningRunpodPods()
    probe.pods = pods.map(pd => ({ id: pd.id, name: pd.name, hoursRunning: pd.hoursRunning, costPerHour: pd.costPerHour }))
  } catch {
    probe.couldNotAsk.push('pods')
  }
  probe.clear = probe.couldNotAsk.length === 0
    && probe.endpoint != null
    && probe.endpoint.workers.active === 0
    && probe.endpoint.jobs.inQueue === 0
    && probe.endpoint.jobs.inProgress === 0
    && (probe.pods?.length ?? 1) === 0

  try {
    await db.update(videoJobs).set({
      runpodIdleProbeJson: probe,
      ...(probe.clear ? { runpodIdleConfirmedAt: new Date() } : {}),
    }).where(eq(videoJobs.id, jobRowId))
  } catch (err) {
    console.warn(`[video-pipeline] runpod idle probe write failed for job row ${jobRowId}:`, err)
  }
  return probe
}

// ─── Owner actions (Video Studio) ────────────────────────────────────────────

/**
 * Approve a candidate frame: job resumes next tick. `sceneIndex` is required
 * for a multi-scene job and approves ONLY that scene — the poller's
 * advanceSceneFrameMultiScene picks up the next pending own-frame scene (or
 * advances to the clip stage once every own-frame scene is approved). Omitted
 * for a single-scene job (unchanged behavior: resumes straight at 'clip').
 */
export async function approveSceneFrame(jobRowId: number, frameAssetId: number, sceneIndex?: number): Promise<void> {
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, frameAssetId)).limit(1)
  if (!asset || asset.videoJobId !== jobRowId || asset.purpose !== 'scene_frame') {
    throw new Error('Frame does not belong to this job')
  }

  if (typeof sceneIndex === 'number') {
    const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
    if (!job) throw new Error('Job not found')
    if (!job.scenesJson || !job.sceneStateJson) throw new Error('Job is not a multi-scene job')
    if (sceneIndex < 0 || sceneIndex >= job.scenesJson.length) throw new Error(`sceneIndex ${sceneIndex} out of range`)
    const nextState: VideoSceneState[] = job.sceneStateJson.map((s, i) =>
      i === sceneIndex ? { ...s, frameAssetId, status: 'frame' } : s,
    )
    await db.update(videoJobs)
      .set({ sceneStateJson: nextState, status: 'queued', updatedAt: new Date() })
      .where(eq(videoJobs.id, jobRowId))
    await kvDel(KV_KEYS.videoPollerIdle)
    return
  }

  await db.update(videoJobs)
    .set({ sceneFrameAssetId: frameAssetId, stage: 'clip', status: 'queued', updatedAt: new Date() })
    .where(eq(videoJobs.id, jobRowId))
  await kvDel(KV_KEYS.videoPollerIdle)
}

/** Regenerate frame candidates with owner feedback folded into the prompt. */
export async function retrySceneFrames(jobRowId: number, feedback: string, sceneIndex?: number): Promise<void> {
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobRowId)).limit(1)
  if (!job) throw new Error('Job not found')
  const script: VideoScriptJson = { ...job.scriptJson }
  const prior = Array.isArray(script.frameFeedback) ? script.frameFeedback : []
  script.frameFeedback = [...prior, feedback]

  // Multi-scene retry (ticket #5714, mirrors approveSceneFrame's sceneIndex):
  // fold the feedback into THAT scene's framePrompt and reset only that
  // scene's state, so the poller recomposes one scene, not the job.
  if (sceneIndex != null) {
    const scenes = job.scenesJson
    const state = job.sceneStateJson
    if (!scenes || !state) throw new Error('sceneIndex given but this is not a multi-scene job')
    const scene = scenes[sceneIndex]
    if (!scene) throw new Error(`sceneIndex ${sceneIndex} out of range (job has ${scenes.length} scenes)`)
    if (scene.continuity === 'last-frame') throw new Error(`scene ${sceneIndex} inherits the previous scene's last frame; there are no candidates to retry`)
    const nextScenes: VideoSceneSpec[] = scenes.map((sc, i) => {
      if (i !== sceneIndex || !feedback) return sc
      return { ...sc, framePrompt: `${sc.framePrompt ?? ''} ${feedback}`.trim() }
    })
    const nextState: VideoSceneState[] = state.map((st, i) => {
      if (i !== sceneIndex) return st
      const { frameAssetId: _dropped, ...rest } = st
      return { ...rest, status: 'pending' }
    })
    await db.update(videoJobs)
      .set({ scriptJson: script, scenesJson: nextScenes, sceneStateJson: nextState, stage: 'scene_frame', status: 'queued', updatedAt: new Date() })
      .where(eq(videoJobs.id, jobRowId))
    await kvDel(KV_KEYS.videoPollerIdle)
    return
  }

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

export interface FanOutOpts {
  /** The episode this job rendered (defaults to job.episodeId when present). */
  episodeId?: number
  /** Explicit slot instant; defaults to the episode's planned_slot_at. */
  scheduledAt?: Date
}
export interface FanOutResult {
  created: { id: number; platform: string }[]
  skipped: { platform: string; reason: string }[]
}

/**
 * Fan a finished, owner-approved video out to one social_posts row per target
 * platform. Rows land status='draft' + reviewStatus='pending_review', never
 * 'approved' (ticket #3733): both publish paths refuse an approved row without
 * a publish-gate stamp, and only `applyPublishGateVerdict` may write one.
 * Video Studio approval is the editorial review of the VIDEO; the publish gate
 * still owns whether the finished POST ships. Nothing here posts anywhere.
 *
 * Ticket #5715 rewrote the row it writes:
 *   - scheduledAt is the REAL slot instant (episode planned_slot_at or the
 *     explicit opts value); scheduledFor dual-writes the LA calendar date of
 *     that instant for the COALESCE readers. No slot -> today (due now),
 *     preserving the pre-episode behavior.
 *   - altText (episode logline), castSlugs, shopifyProductId (first placement
 *     gid: its absence is why the pre-publish stock block never fired on
 *     video posts), episodeId (the learn-mode join), mediaKind 'video'.
 *   - X NEVER receives a video row (owner direction 2026-08-26: X video is
 *     manual-only; the X publisher hard-refuses video, so a row here would
 *     loop in the hourly tick forever). Skips are RETURNED, never silent.
 */
export async function fanOutVideoToSocialDrafts(jobRowId: number, reviewedBy: string, opts: FanOutOpts = {}): Promise<FanOutResult> {
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

  const episodeId = opts.episodeId ?? job.episodeId ?? null
  const episode = episodeId != null
    ? (await db.select().from(videoEpisodes).where(eq(videoEpisodes.id, episodeId)).limit(1))[0] ?? null
    : null

  const scheduledAt = opts.scheduledAt ?? episode?.plannedSlotAt ?? null
  const scheduledFor = scheduledAt
    ? (utcIsoToLaWallClock(scheduledAt)?.date ?? scheduledAt.toISOString().slice(0, 10))
    : new Date().toISOString().slice(0, 10)
  const altText = episode?.logline ? episode.logline.slice(0, 1000) : null
  const castSlugs = episode?.castSlugs?.length ? episode.castSlugs : null
  const productGid = episode?.productPlacements?.find(pl => pl.shopifyProductGid)?.shopifyProductGid ?? null

  const captions = (job.scriptJson.captions ?? {}) as Record<string, string>
  const fallbackCaption = [job.scriptJson.hook, job.scriptJson.cta].filter(Boolean).join(' ')

  const created: FanOutResult['created'] = []
  const skipped: FanOutResult['skipped'] = []
  for (const platform of job.targetPlatforms) {
    if (platform === 'x') {
      skipped.push({ platform, reason: 'X video is manual-only (owner direction 2026-08-26); the X publisher refuses video and the tick would loop on the row forever' })
      continue
    }
    const caption = captions[platform] ?? captions['default'] ?? fallbackCaption
    if (!caption) {
      skipped.push({ platform, reason: 'no caption for this platform in scriptJson' })
      continue
    }
    const [row] = await db.insert(socialPosts).values({
      platform,
      postType: platform === 'youtube' ? 'video_short' : 'video_reel',
      tweetText: caption,
      mediaUrls: [finalAsset.blobUrl],
      posterUrl: posterAsset?.blobUrl ?? null,
      videoJobId: job.id,
      episodeId,
      mediaKind: 'video',
      altText,
      castSlugs,
      shopifyProductId: productGid,
      status: 'draft',
      createdBy: 'agent',
      reviewStatus: 'pending_review',
      scheduledFor,
      scheduledAt,
      updatedAt: new Date(),
      // Who approved the VIDEO, kept for audit; the POST's reviewer is whoever
      // the gate stamp names once it verdicts.
      reviewedBy,
    }).returning({ id: socialPosts.id })
    if (row) created.push({ id: row.id, platform })
  }

  if (created.length && episode) {
    await db.update(videoEpisodes)
      .set({ productionStatus: 'scheduled', updatedAt: new Date() })
      .where(eq(videoEpisodes.id, episode.id))
  }

  // Best-effort poster into the asset Library (source 'video_poster') so a
  // rendered episode is findable next month. The final mp4 is NOT ingested:
  // the library's binaries are Sanity image assets, which cannot hold video.
  if (created.length && posterAsset?.blobUrl) {
    try {
      const { ingestSocialAsset } = await import('./social-asset-library.server')
      await ingestSocialAsset({
        sourceUrl: posterAsset.blobUrl,
        filename: `video-${job.jobId}-poster.jpg`,
        contentType: 'image/jpeg',
        source: 'video_poster',
        productHandle: job.productHandle,
        ...(castSlugs ? { castSlugs } : {}),
        postId: created[0]!.id,
        createdBy: 'video-pipeline',
      })
    } catch (err) {
      console.warn(`[video-pipeline] poster library ingest failed for job ${job.jobId}:`, err)
    }
  }

  return { created, skipped }
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
  /**
   * Multi-scene jobs only: candidate scene_frame assets grouped by scene index.
   * Parsed off the blob path (video/<jobId>/scene-<idx>-frame-<i>.jpg) rather
   * than a new media_assets column — media_assets stays untouched by this
   * migration, and the naming convention is owned entirely by
   * advanceSceneFrameMultiScene.
   */
  sceneFrames?: Record<number, { id: number; blobUrl: string }[]>
  finalUrl: string | null
  posterUrl: string | null
}

// blobPut always writes with addRandomSuffix: true, so the path Vercel Blob
// actually returns is `scene-<idx>-frame-<i>-<randomSuffix>.jpg`, not the bare
// `scene-<idx>-frame-<i>.jpg` advanceSceneFrameMultiScene passes in. The
// random-suffix segment must stay optional in the regex or every real
// production asset silently fails to match and a parked job's frame picker
// renders with zero candidates (ticket: multi-scene approve UI shows nothing
// to click).
const SCENE_FRAME_BLOB_RE = /\/scene-(\d+)-frame-\d+(?:-[^/]+)?\.jpg$/

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
    const frameAssets = own.filter(a => a.purpose === 'scene_frame')

    let sceneFrames: Record<number, { id: number; blobUrl: string }[]> | undefined
    if (job.scenesJson && job.scenesJson.length >= MULTI_SCENE_MIN) {
      sceneFrames = {}
      for (const a of frameAssets) {
        const m = SCENE_FRAME_BLOB_RE.exec(a.blobUrl)
        if (!m) continue
        const idx = Number(m[1])
        const list = sceneFrames[idx] ?? []
        list.push({ id: a.id, blobUrl: a.blobUrl })
        sceneFrames[idx] = list
      }
    }

    return {
      job,
      frames: frameAssets.map(a => ({ id: a.id, blobUrl: a.blobUrl })),
      ...(sceneFrames ? { sceneFrames } : {}),
      finalUrl: finalAsset?.blobUrl ?? null,
      posterUrl: posterAsset?.blobUrl ?? null,
    }
  })
}

/** True while any job is in a state the admin page should live-poll for. */
export function hasActiveVideoJobs(rows: VideoJobWithAssets[]): boolean {
  return rows.some(r => ['queued', 'running', 'awaiting_provider', 'applying'].includes(r.job.status))
}
