/**
 * POST /api/team/video-job — the video-producer agent's ONLY write path.
 *
 *   { op: 'enqueue', productHandle, shopifyProductGid?, formula, presenter,
 *     scriptJson, modelTier, durationSeconds, targetPlatforms, aiDisclosure?,
 *     runId? } -> { jobId, estCostUsd }
 *   { op: 'enqueue-set', productHandle, shopifyProductGid?, formula, presenter,
 *     baseScriptJson, hooks, presenters?, sceneSlugs?, modelTier,
 *     durationSeconds, targetPlatforms, aiDisclosure?, runId? }
 *       -> { variantGroupId, totalEstCostUsd, jobs: [{jobId, estCostUsd, axes}] }
 *   { op: 'list', limit? } -> { jobs: [...] }   (includes fan-out review outcomes
 *                                                — the agent's training channel)
 *   { op: 'config' } -> valves, model tiers/rates, formulas, tones, approved
 *                       cast, platform frequencies
 *
 * Multi-scene jobs (Phase 3, 20-60s videos): op:'enqueue' accepts
 * scriptJson.scenes, an array of 2-8
 *   { slug, framePrompt?, motionPrompt, durationSeconds, continuity? }
 * entries ('continuity' is 'own-frame' | 'last-frame'; defaults to
 * 'own-frame' for scenes[0] and 'last-frame' for every scene after it).
 * framePrompt is required for own-frame scenes (it composes the scene_frame
 * candidates) and optional for last-frame scenes, which never use it: their
 * opening frame comes from the previous scene's rendered clip.
 * durationSeconds on the top-level body is IGNORED when scenes is present —
 * enqueueVideoJob sums the per-scene durations itself (video-pipeline.server.ts's
 * validateScenes enforces the 90s multi-scene ceiling and per-scene duration
 * validity; not re-duplicated here). enqueue-set does not support scenes.
 *
 * Unlike social-post drafting (free), op:'enqueue'/'enqueue-set' SPEND REAL
 * MONEY on fal, so they check the video team's kill switch AND budget gate
 * before inserting. Publishing stays owner-gated: a finished job only ever
 * lands in /admin/video-studio for review; nothing here posts anywhere.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, gate, getTeamConfig, getValve, VALVE_KEYS } from '~/lib/team.server'
import {
  SOCIAL_PLATFORMS,
  VIDEO_FORMULAS,
  VIDEO_MAX_COST_CENTS_DEFAULT,
  VIDEO_MAX_VARIANTS_PER_SET_DEFAULT,
  VIDEO_DEFAULT_MODEL_TIER_DEFAULT,
  VIDEO_TONES,
  SCENE_KIT,
  VIDEO_EXTRA_KEYS,
} from '~/lib/team-keys'
import { enqueueVideoJob, enqueueVideoJobSet, listVideoJobs, estimateJobCostUsd, findReusableSceneFrame, isMultiSceneScript } from '~/lib/video-pipeline.server'
import { assertEpisodeMatchesScript, linkEpisodeToJob } from '~/lib/video-episodes.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { VIDEO_MODELS, isVideoModelId, tierIneligibility } from '~/lib/fal-video.server'
import { getApprovedCastMembers } from '~/lib/sanity.server'
import { db } from '~/lib/db.server'
import { socialPosts } from '../../db/schema'
import { inArray } from 'drizzle-orm'
import { apiError } from '~/lib/api-error.server'
import type { VideoScriptJson } from '../../db/schema'

const PRESENTER_RE = /^(none|emma|friend:[a-z0-9-]+)$/

interface ValidatedEnqueueCommon {
  productHandle: string
  formula: string
  presenter: string
  modelTier: keyof typeof VIDEO_MODELS
  spec: (typeof VIDEO_MODELS)[keyof typeof VIDEO_MODELS]
  script: VideoScriptJson
  platforms: string[]
}

/**
 * Shared field validation for enqueue and enqueue-set. Returns a Response on
 * the first failure. `scriptField` names which body key carries the script
 * (scriptJson vs baseScriptJson).
 */
function validateEnqueueCommon(b: Record<string, unknown>, scriptField: string): ValidatedEnqueueCommon | Response {
  if (typeof b['productHandle'] !== 'string' || !b['productHandle']) {
    return new Response('Bad Request: productHandle required', { status: 400 })
  }
  if (typeof b['formula'] !== 'string' || !(VIDEO_FORMULAS as readonly string[]).includes(b['formula'])) {
    return new Response(`Bad Request: formula must be one of ${VIDEO_FORMULAS.join('|')}`, { status: 400 })
  }
  const presenter = typeof b['presenter'] === 'string' ? b['presenter'] : 'none'
  if (!PRESENTER_RE.test(presenter)) {
    return new Response('Bad Request: presenter must be none | emma | friend:{slug}', { status: 400 })
  }
  if (!isVideoModelId(b['modelTier'])) {
    return new Response(`Bad Request: modelTier must be one of ${Object.keys(VIDEO_MODELS).join('|')}`, { status: 400 })
  }
  // Retired provider / unavailable worker mode (ticket #5727). Refused here,
  // before the money gate and before any provider call, so an ineligible tier
  // costs a 400 rather than a cold GPU boot or a fal invoice.
  const ineligible = tierIneligibility(b['modelTier'])
  if (ineligible) {
    return Response.json({ error: ineligible.code, detail: ineligible.message }, { status: 400 })
  }
  const spec = VIDEO_MODELS[b['modelTier']]
  const script = b[scriptField]
  if (!script || typeof script !== 'object' || Array.isArray(script)) {
    return new Response(`Bad Request: ${scriptField} object required (framePrompt, motionPrompt, captions)`, { status: 400 })
  }
  // Multi-scene (op:'enqueue' only — enqueue-set does not support scenes; a
  // baseScriptJson.scenes array is left untouched and validated the normal
  // single-scene way, same as any other unrecognized scriptJson field).
  const multiScene = scriptField === 'scriptJson' && isMultiSceneScript(script as VideoScriptJson)
  if (spec.audioDriven && multiScene) {
    return new Response('Bad Request: multi-scene jobs are not supported on the avatar tier', { status: 400 })
  }

  if (spec.audioDriven || spec.lipsync) {
    // Talking tiers: the spoken line and an on-camera presenter are required.
    // (enqueue-set may carry the line via the {{hook}} token — the pipeline
    // re-validates each expanded variant.)
    const line = (script as VideoScriptJson).presenterLine
    if (typeof line !== 'string' || !line.trim()) {
      return new Response(`Bad Request: ${spec.lipsync ? 'lipsync' : 'avatar'} tier requires ${scriptField}.presenterLine`, { status: 400 })
    }
    if (presenter === 'none') {
      return new Response(`Bad Request: ${spec.lipsync ? 'lipsync' : 'avatar'} tier requires a presenter (emma or friend:{slug})`, { status: 400 })
    }
    // durationSeconds is per-scene for a multi-scene lipsync job (validated by
    // enqueueVideoJob's validateScenes) — the top-level field is not required.
    if (spec.lipsync && !multiScene && typeof b['durationSeconds'] !== 'number') {
      return new Response('Bad Request: durationSeconds required for the lipsync tier', { status: 400 })
    }
  } else if (!multiScene && typeof b['durationSeconds'] !== 'number') {
    return new Response('Bad Request: durationSeconds required', { status: 400 })
  }
  const platforms = Array.isArray(b['targetPlatforms'])
    ? (b['targetPlatforms'] as unknown[]).filter((p): p is string => typeof p === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(p))
    : []
  if (!platforms.length) {
    return new Response(`Bad Request: targetPlatforms must include at least one of ${SOCIAL_PLATFORMS.join('|')}`, { status: 400 })
  }
  return {
    productHandle: b['productHandle'],
    formula: b['formula'],
    presenter,
    modelTier: b['modelTier'],
    spec,
    script: script as VideoScriptJson,
    platforms,
  }
}

/**
 * Fills in modelTier from the video_default_model_tier pipeline setting
 * (mirrors video-pipeline.server.ts's getDefaultModelTier) when the caller
 * omits it, so validateEnqueueCommon's isVideoModelId check always has a
 * value to validate. Mutates nothing the caller passed; only adds the key
 * when absent.
 */
async function withDefaultModelTier(b: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof b['modelTier'] === 'string' && b['modelTier']) return b
  const v = await getPipelineSetting(VIDEO_EXTRA_KEYS.defaultModelTier).catch(() => null)
  const modelTier = isVideoModelId(v) ? v : VIDEO_DEFAULT_MODEL_TIER_DEFAULT
  return { ...b, modelTier }
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const b = (rawBody['op'] === 'enqueue' || rawBody['op'] === 'enqueue-set')
    ? await withDefaultModelTier(rawBody)
    : rawBody

  try {
    if (b['op'] === 'enqueue') {
      const v = validateEnqueueCommon(b, 'scriptJson')
      if (v instanceof Response) return v

      // Serialized-program guard (ticket #5712): an enqueue carrying an
      // episodeId must reference an owner-APPROVED episode whose spoken text
      // is byte-identical to the payload's. assertEpisodeMatchesScript throws
      // a ready-made Response (403 unapproved, 409 mismatch naming BOTH
      // strings) which we pass straight through. This is what moves the money
      // gate from the frame pick to the script read.
      const episodeId = typeof b['episodeId'] === 'number' ? b['episodeId'] : undefined
      if (episodeId !== undefined) {
        try {
          await assertEpisodeMatchesScript(episodeId, v.script)
        } catch (err) {
          if (err instanceof Response) return err
          throw err
        }
      }

      // Money gate: kill switch + daily budget + run cap. Enqueue ops are the
      // ONLY team ops that spend, so they are the ones that gate.
      const excludeRun = typeof b['runId'] === 'number' ? b['runId'] : undefined
      const gateResult = await gate('video', excludeRun)
      if (!gateResult.ok) {
        return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
      }

      // Multi-scene: enqueueVideoJob sums the per-scene durations itself and
      // ignores this field; a placeholder of 0 is fine (never persisted as-is).
      const durationSeconds = v.spec.audioDriven || isMultiSceneScript(v.script)
        ? 0
        : b['durationSeconds'] as number

      const result = await enqueueVideoJob({
        productHandle: v.productHandle,
        ...(typeof b['shopifyProductGid'] === 'string' ? { shopifyProductGid: b['shopifyProductGid'] } : {}),
        formula: v.formula,
        presenter: v.presenter,
        scriptJson: v.script,
        modelTier: v.modelTier,
        durationSeconds,
        targetPlatforms: v.platforms,
        ...(typeof b['aiDisclosure'] === 'boolean' ? { aiDisclosure: b['aiDisclosure'] } : {}),
        ...(typeof b['runId'] === 'number' ? { runId: b['runId'] } : {}),
        ...(episodeId !== undefined ? { episodeId } : {}),
      })
      if (episodeId !== undefined) {
        // Link the episode to its job (sets videoJobId + production_status
        // 'rendering'); failure to link must not orphan the paid-for job.
        await linkEpisodeToJob(episodeId, result.jobId).catch(err =>
          console.error(`[team-video-job] episode ${episodeId} link failed for job ${result.jobId}:`, err))
      }
      return Response.json(result)
    }

    if (b['op'] === 'enqueue-set') {
      const v = validateEnqueueCommon(b, 'baseScriptJson')
      if (v instanceof Response) return v
      const hooks = Array.isArray(b['hooks'])
        ? (b['hooks'] as unknown[]).filter((h): h is string => typeof h === 'string' && !!h.trim())
        : []
      if (!hooks.length) {
        return new Response('Bad Request: hooks must be a non-empty array of strings', { status: 400 })
      }
      const strList = (key: string): string[] | undefined => {
        if (!Array.isArray(b[key])) return undefined
        const out = (b[key] as unknown[]).filter((s): s is string => typeof s === 'string' && !!s.trim())
        return out.length ? out : undefined
      }
      const presenters = strList('presenters')
      if (presenters?.some(p => !PRESENTER_RE.test(p))) {
        return new Response('Bad Request: presenters entries must be none | emma | friend:{slug}', { status: 400 })
      }
      const sceneSlugs = strList('sceneSlugs')
      // Avatar tier derives duration from speech; every other tier (incl.
      // lipsync) validated a numeric durationSeconds above.
      const durationSeconds = v.spec.audioDriven ? 0 : b['durationSeconds'] as number

      const excludeRun = typeof b['runId'] === 'number' ? b['runId'] : undefined
      const gateResult = await gate('video', excludeRun)
      if (!gateResult.ok) {
        return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
      }

      const result = await enqueueVideoJobSet({
        productHandle: v.productHandle,
        ...(typeof b['shopifyProductGid'] === 'string' ? { shopifyProductGid: b['shopifyProductGid'] } : {}),
        formula: v.formula,
        presenter: v.presenter,
        baseScriptJson: v.script,
        modelTier: v.modelTier,
        durationSeconds,
        targetPlatforms: v.platforms,
        ...(typeof b['aiDisclosure'] === 'boolean' ? { aiDisclosure: b['aiDisclosure'] } : {}),
        ...(typeof b['runId'] === 'number' ? { runId: b['runId'] } : {}),
        hooks,
        ...(presenters ? { presenters } : {}),
        ...(sceneSlugs ? { sceneSlugs } : {}),
      })
      return Response.json(result)
    }

    if (b['op'] === 'list') {
      const limit = typeof b['limit'] === 'number' ? Math.min(Math.max(1, b['limit']), 100) : 40
      const rows = await listVideoJobs(limit)
      const jobRowIds = rows.map(r => r.job.id)
      const fanout = jobRowIds.length
        ? await db
            .select({
              id: socialPosts.id,
              videoJobId: socialPosts.videoJobId,
              platform: socialPosts.platform,
              status: socialPosts.status,
              reviewStatus: socialPosts.reviewStatus,
              feedback: socialPosts.feedback,
              editedText: socialPosts.editedText,
            })
            .from(socialPosts)
            .where(inArray(socialPosts.videoJobId, jobRowIds))
        : []
      const jobs = rows.map(r => ({
        id: r.job.id,
        jobId: r.job.jobId,
        productHandle: r.job.productHandle,
        formula: r.job.formula,
        presenter: r.job.presenter,
        modelTier: r.job.modelTier,
        stage: r.job.stage,
        status: r.job.status,
        costUsd: r.job.costUsd,
        sceneFrameAssetId: r.job.sceneFrameAssetId,
        sceneSlug: typeof r.job.scriptJson?.sceneSlug === 'string' ? r.job.scriptJson.sceneSlug : null,
        // Multi-scene jobs only (Phase 3): the scene list + per-scene progress.
        scenes: r.job.scenesJson,
        sceneState: r.job.sceneStateJson,
        variantGroupId: r.job.variantGroupId,
        variantAxes: r.job.variantAxes,
        error: r.job.error,
        targetPlatforms: r.job.targetPlatforms,
        metricsJson: r.job.metricsJson,
        createdAt: r.job.createdAt,
        completedAt: r.job.completedAt,
        // Owner review outcomes on the fanned-out drafts: the training channel.
        socialPosts: fanout.filter(p => p.videoJobId === r.job.id),
      }))
      return Response.json({ jobs })
    }

    if (b['op'] === 'config') {
      const [config, autopublish, cast, endcardSetting] = await Promise.all([
        getTeamConfig('video'),
        getValve(VALVE_KEYS.videoAutopublish),
        getApprovedCastMembers(),
        getPipelineSetting(VIDEO_EXTRA_KEYS.endcardEnabled).catch(() => null),
      ])
      // Only ELIGIBLE tiers are advertised (ticket #5727). This op is the
      // writers room's tier menu; handing it all eleven was how a slate got
      // written on a retired fal tier in the first place. Historical rows still
      // resolve their spec through VIDEO_MODELS directly, not through here.
      const models = Object.fromEntries(
        Object.entries(VIDEO_MODELS).filter(([id]) => tierIneligibility(id as never) == null).map(([id, spec]) => {
          // Avatar models derive duration from speech; example a 30s script.
          const exampleSeconds = spec.audioDriven ? 30 : (spec.allowedDurations.includes(8) ? 8 : spec.allowedDurations[0] ?? 5)
          return [id, {
            label: spec.label,
            tier: spec.tier,
            ratePerSecondUsd: spec.ratePerSecondUsd,
            nativeAudio: spec.nativeAudio,
            audioDriven: !!spec.audioDriven,
            lipsync: !!spec.lipsync,
            allowedDurations: spec.allowedDurations,
            example8sCostUsd: estimateJobCostUsd(
              id as keyof typeof VIDEO_MODELS,
              exampleSeconds,
              spec.audioDriven ? { speechSeconds: exampleSeconds } : {},
            ),
          }]
        }),
      )
      // Per-scene reusable frame availability for presenter 'emma': the same
      // lookup the pipeline runs when a job carries sceneSlug. Non-null means
      // enqueueing that scene reuses the approved frame with no new composition.
      const sceneKit = await Promise.all(SCENE_KIT.map(async scene => ({
        ...scene,
        approvedFrameAssetId: await findReusableSceneFrame(scene.slug, 'emma').catch(() => null),
      })))
      return Response.json({
        enabled: config.enabled,
        dailyCents: config.dailyCents,
        maxCostCents: config.maxCostCents ?? VIDEO_MAX_COST_CENTS_DEFAULT,
        maxVariantsPerSet: config.maxVariantsPerSet ?? VIDEO_MAX_VARIANTS_PER_SET_DEFAULT,
        endcardEnabled: endcardSetting === 'true',
        autopublish,
        formulas: VIDEO_FORMULAS,
        tones: VIDEO_TONES,
        platforms: SOCIAL_PLATFORMS,
        models,
        sceneKit,
        cast: cast.map(m => ({ slug: m.slug, name: m.name, role: m.role })),
      })
    }

    return new Response('Bad Request', { status: 400 })
  } catch (err) {
    return apiError('team-video-job', err, 'video-job op failed')
  }
}
