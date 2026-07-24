/**
 * POST /api/team/video-job — the video-producer agent's ONLY write path.
 *
 *   { op: 'enqueue', productHandle, shopifyProductGid?, formula, presenter,
 *     scriptJson, modelTier, durationSeconds, targetPlatforms, aiDisclosure?,
 *     runId? } -> { jobId, estCostUsd }
 *   { op: 'list', limit? } -> { jobs: [...] }   (includes fan-out review outcomes
 *                                                — the agent's training channel)
 *   { op: 'config' } -> valves, model tiers/rates, formulas, approved cast,
 *                       platform frequencies
 *
 * Unlike social-post drafting (free), op:'enqueue' SPENDS REAL MONEY on fal,
 * so it checks the video team's kill switch AND budget gate before inserting.
 * Publishing stays owner-gated: a finished job only ever lands in
 * /admin/video-studio for review; nothing here posts anywhere.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, gate, getTeamConfig, getValve, VALVE_KEYS } from '~/lib/team.server'
import { SOCIAL_PLATFORMS, VIDEO_FORMULAS, VIDEO_MAX_COST_CENTS_DEFAULT, SCENE_KIT } from '~/lib/team-keys'
import { enqueueVideoJob, listVideoJobs, estimateJobCostUsd, findReusableSceneFrame } from '~/lib/video-pipeline.server'
import { VIDEO_MODELS, isVideoModelId } from '~/lib/fal-video.server'
import { getApprovedCastMembers } from '~/lib/sanity.server'
import { db } from '~/lib/db.server'
import { socialPosts } from '../../db/schema'
import { inArray } from 'drizzle-orm'
import { apiError } from '~/lib/api-error.server'
import type { VideoScriptJson } from '../../db/schema'

const PRESENTER_RE = /^(none|emma|friend:[a-z0-9-]+)$/

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    if (b['op'] === 'enqueue') {
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
      const spec = VIDEO_MODELS[b['modelTier']]
      const script = b['scriptJson']
      if (!script || typeof script !== 'object' || Array.isArray(script)) {
        return new Response('Bad Request: scriptJson object required (framePrompt, motionPrompt, captions)', { status: 400 })
      }
      if (spec.audioDriven) {
        // Avatar tier: duration derives from speech length, so durationSeconds
        // is not required; the spoken line and an on-camera presenter are.
        const line = (script as VideoScriptJson).presenterLine
        if (typeof line !== 'string' || !line.trim()) {
          return new Response('Bad Request: avatar tier requires scriptJson.presenterLine', { status: 400 })
        }
        if (presenter === 'none') {
          return new Response('Bad Request: avatar tier requires a presenter (emma or friend:{slug})', { status: 400 })
        }
      } else if (typeof b['durationSeconds'] !== 'number') {
        return new Response('Bad Request: durationSeconds required', { status: 400 })
      }
      const platforms = Array.isArray(b['targetPlatforms'])
        ? (b['targetPlatforms'] as unknown[]).filter((p): p is string => typeof p === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(p))
        : []
      if (!platforms.length) {
        return new Response(`Bad Request: targetPlatforms must include at least one of ${SOCIAL_PLATFORMS.join('|')}`, { status: 400 })
      }

      // Money gate: kill switch + daily budget + run cap. Enqueue is the ONLY
      // team op that spends, so it is the one that gates.
      const excludeRun = typeof b['runId'] === 'number' ? b['runId'] : undefined
      const gateResult = await gate('video', excludeRun)
      if (!gateResult.ok) {
        return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
      }

      const result = await enqueueVideoJob({
        productHandle: b['productHandle'],
        ...(typeof b['shopifyProductGid'] === 'string' ? { shopifyProductGid: b['shopifyProductGid'] } : {}),
        formula: b['formula'],
        presenter,
        scriptJson: script as VideoScriptJson,
        modelTier: b['modelTier'],
        durationSeconds: spec.audioDriven ? 0 : b['durationSeconds'] as number,
        targetPlatforms: platforms,
        ...(typeof b['aiDisclosure'] === 'boolean' ? { aiDisclosure: b['aiDisclosure'] } : {}),
        ...(typeof b['runId'] === 'number' ? { runId: b['runId'] } : {}),
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
      const [config, autopublish, cast] = await Promise.all([
        getTeamConfig('video'),
        getValve(VALVE_KEYS.videoAutopublish),
        getApprovedCastMembers(),
      ])
      const models = Object.fromEntries(
        Object.entries(VIDEO_MODELS).map(([id, spec]) => {
          // Avatar models derive duration from speech; example a 30s script.
          const exampleSeconds = spec.audioDriven ? 30 : (spec.allowedDurations.includes(8) ? 8 : spec.allowedDurations[0] ?? 5)
          return [id, {
            label: spec.label,
            tier: spec.tier,
            ratePerSecondUsd: spec.ratePerSecondUsd,
            nativeAudio: spec.nativeAudio,
            audioDriven: !!spec.audioDriven,
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
        autopublish,
        formulas: VIDEO_FORMULAS,
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
