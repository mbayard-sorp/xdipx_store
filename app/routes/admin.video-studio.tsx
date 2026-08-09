/**
 * admin.video-studio.tsx — Video Studio: the owner's single review surface for
 * the fal.ai social video pipeline.
 *
 * One approval fans out: approving a finished video writes pre-approved
 * social_posts drafts for every target platform (Social Studio is the posting
 * surface, not a second review), optionally graduates the clip to Shopify
 * (product media gallery, or the hero_video card/PDP metafield), and can flag
 * it as an ad-creative candidate for the Ad Studio.
 *
 * The frame-approval queue is the cost gate: jobs park after scene-frame
 * composition (cents) and only the owner's pick releases the clip generation
 * (dollars) while the video_frame_review valve is ON.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { Form, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import {
  listVideoJobs,
  hasActiveVideoJobs,
  approveSceneFrame,
  retrySceneFrames,
  rejectVideoJob,
  regenerateVideoJob,
  fanOutVideoToSocialDrafts,
  recordVideoMetrics,
  enqueueVideoJob,
  enqueueVideoJobSet,
  type VideoJobWithAssets,
  type VideoMetricsReport,
} from '~/lib/video-pipeline.server'
import { VIDEO_MODELS, isVideoModelId } from '~/lib/fal-video.server'
import { getApprovedCastMembers } from '~/lib/sanity.server'
import { VIDEO_METRIC_FIELDS, VIDEO_FORMULAS, VIDEO_TONES, SCENE_KIT, SOCIAL_PLATFORMS } from '~/lib/team-keys'
import {
  getProductByHandle,
  createStagedVideoUpload,
  attachVideoToProduct,
  pollMediaReady,
  uploadVideoToShopifyFiles,
  uploadMoodImageToShopifyFiles,
  setHeroVideoMetafield,
} from '~/lib/shopify.server'
import { blobFetchToBuffer } from '~/lib/blob.server'
import { db } from '~/lib/db.server'
import { mediaAssets } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { getAdminUser } from '~/lib/session.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Video Studio — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [rows, cast] = await Promise.all([
    listVideoJobs(40).catch(() => [] as VideoJobWithAssets[]),
    getApprovedCastMembers().catch(() => []),
  ])
  // VIDEO_MODELS is server-only (fal-video.server.ts) — serialize what the
  // Compose form needs across the loader boundary.
  const models = Object.entries(VIDEO_MODELS).map(([id, spec]) => ({
    id,
    label: spec.label,
    tier: spec.tier,
    ratePerSecondUsd: spec.ratePerSecondUsd,
    audioDriven: !!spec.audioDriven,
    lipsync: !!spec.lipsync,
    allowedDurations: spec.allowedDurations,
  }))
  return {
    rows: rows.map(r => ({
      id: r.job.id,
      jobId: r.job.jobId,
      productHandle: r.job.productHandle,
      formula: r.job.formula,
      presenter: r.job.presenter,
      modelTier: r.job.modelTier,
      stage: r.job.stage,
      status: r.job.status,
      costUsd: r.job.costUsd,
      error: r.job.error,
      targetPlatforms: r.job.targetPlatforms,
      aiDisclosure: r.job.aiDisclosure,
      metricsJson: r.job.metricsJson,
      captions: (r.job.scriptJson?.captions ?? {}) as Record<string, string>,
      hook: typeof r.job.scriptJson?.hook === 'string' ? r.job.scriptJson.hook : null,
      variantGroupId: r.job.variantGroupId,
      variantAxes: r.job.variantAxes,
      createdAt: r.job.createdAt,
      frames: r.frames,
      finalUrl: r.finalUrl,
      posterUrl: r.posterUrl,
    })),
    active: hasActiveVideoJobs(rows),
    models,
    cast: cast.map(m => ({ slug: m.slug, name: m.name })),
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const user = await getAdminUser(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  // Job-less intents branch BEFORE the jobRowId guard.
  if (intent === 'compose') {
    try {
      return await composeAction(form)
    } catch (err) {
      console.error('[video-studio] compose', err)
      return Response.json({ error: err instanceof Error ? err.message : 'Compose failed' }, { status: 500 })
    }
  }
  if (intent === 'approve-all-set') {
    const variantGroupId = String(form.get('variantGroupId') ?? '')
    if (!variantGroupId) return Response.json({ error: 'Missing variantGroupId' }, { status: 400 })
    try {
      const reviewer = user?.email ?? 'owner'
      const rows = await listVideoJobs(100)
      const done = rows.filter(r => r.job.variantGroupId === variantGroupId && r.job.stage === 'done' && r.job.status === 'done')
      if (!done.length) return Response.json({ error: 'No finished jobs in this set' }, { status: 400 })
      const postIds: number[] = []
      for (const r of done) {
        postIds.push(...await fanOutVideoToSocialDrafts(r.job.id, reviewer))
      }
      return Response.json({ ok: true, approved: done.length, postIds })
    } catch (err) {
      console.error('[video-studio] approve-all-set', err)
      return Response.json({ error: err instanceof Error ? err.message : 'Set approval failed' }, { status: 500 })
    }
  }

  const jobRowId = Number(form.get('jobRowId'))
  if (!Number.isFinite(jobRowId) || jobRowId <= 0) {
    return Response.json({ error: 'Missing jobRowId' }, { status: 400 })
  }

  try {
    switch (intent) {
      case 'approve-frame': {
        const frameAssetId = Number(form.get('frameAssetId'))
        if (!Number.isFinite(frameAssetId)) return Response.json({ error: 'Missing frameAssetId' }, { status: 400 })
        await approveSceneFrame(jobRowId, frameAssetId)
        return Response.json({ ok: true })
      }
      case 'retry-frames': {
        await retrySceneFrames(jobRowId, String(form.get('feedback') ?? ''))
        return Response.json({ ok: true })
      }
      case 'reject': {
        await rejectVideoJob(jobRowId, String(form.get('reason') ?? ''))
        return Response.json({ ok: true })
      }
      case 'regenerate': {
        const result = await regenerateVideoJob(jobRowId, String(form.get('feedback') ?? ''))
        return Response.json({ ok: true, ...result })
      }
      case 'metrics': {
        const platform = String(form.get('platform') ?? '')
        if (!platform) return Response.json({ error: 'Missing platform' }, { status: 400 })
        // Owner self-report only: blank fields stay absent (never zero-filled,
        // never estimated); the UI shows "not yet reported" for absent data.
        const metrics: VideoMetricsReport = {}
        for (const k of VIDEO_METRIC_FIELDS) {
          const raw = form.get(k)
          if (raw == null || String(raw).trim() === '') continue
          const v = Number(raw)
          if (Number.isFinite(v) && v >= 0) metrics[k] = v
        }
        const notes = String(form.get('notes') ?? '').trim()
        if (notes) metrics.notes = notes
        await recordVideoMetrics(jobRowId, platform, metrics)
        return Response.json({ ok: true })
      }
      case 'approve': {
        const graduation = String(form.get('graduation') ?? 'none') // none | media | hero
        const reviewer = user?.email ?? 'owner'
        const postIds = await fanOutVideoToSocialDrafts(jobRowId, reviewer)

        let shopify: string | null = null
        if (graduation === 'media' || graduation === 'hero') {
          const rows = await listVideoJobs(100)
          const row = rows.find(r => r.job.id === jobRowId)
          if (!row?.finalUrl) throw new Error('Final video missing')
          const product = await getProductByHandle(row.job.productHandle)
          const productGid = row.job.shopifyProductGid ?? product?.id
          if (!productGid) throw new Error(`No Shopify product GID for ${row.job.productHandle}`)
          const videoBuffer = await blobFetchToBuffer(row.finalUrl)
          const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
          const persona = row.job.presenter.replace(':', '-')
          const filename = `social-${row.job.productHandle}-${persona}-${stamp}.mp4`

          if (graduation === 'media') {
            const staged = await createStagedVideoUpload(filename, videoBuffer.length)
            const uploadForm = new FormData()
            for (const p of staged.parameters) uploadForm.append(p.name, p.value)
            uploadForm.append('file', new Blob([new Uint8Array(videoBuffer)], { type: 'video/mp4' }), filename)
            const res = await fetch(staged.url, { method: 'POST', body: uploadForm })
            if (!res.ok) throw new Error(`Staged upload failed: ${res.status}`)
            const mediaId = await attachVideoToProduct(productGid, staged.resourceUrl, `${row.job.productHandle} video`)
            const ready = await pollMediaReady(productGid, mediaId)
            shopify = `attached to product media (${ready ? 'READY' : 'processing'})`
          } else {
            const src = await uploadVideoToShopifyFiles(videoBuffer, filename, { alt: `${row.job.productHandle} hero video` })
            let poster: string | undefined
            if (row.posterUrl) {
              const posterBuffer = await blobFetchToBuffer(row.posterUrl)
              poster = await uploadMoodImageToShopifyFiles(posterBuffer, filename.replace('.mp4', '-poster.jpg'))
            }
            const [finalAsset] = row.job.finalAssetId
              ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, row.job.finalAssetId)).limit(1)
              : []
            const duration = finalAsset?.durationSeconds ? Number(finalAsset.durationSeconds) : undefined
            await setHeroVideoMetafield(productGid, {
              src,
              ...(poster ? { poster } : {}),
              ...(duration && duration > 0 ? { duration } : {}),
            })
            shopify = 'hero_video metafield set (card autoplay + PDP)'
          }
        }
        return Response.json({ ok: true, postIds, shopify })
      }
      default:
        return Response.json({ error: `Unknown intent ${intent}` }, { status: 400 })
    }
  } catch (err) {
    console.error('[video-studio]', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Action failed' }, { status: 500 })
  }
}

/**
 * Owner Compose (spec §5 Phase 4): the two-minute Arcads flow with every gate
 * intact. Calls enqueueVideoJob / enqueueVideoJobSet directly under the admin
 * session — deliberately NOT gate('video') (same as the regenerate intent: the
 * gate governs agent runs; owner actions are deliberate). The per-video
 * ceiling and the variants-per-set cap still apply inside enqueue.
 */
async function composeAction(form: FormData): Promise<Response> {
  const productHandle = String(form.get('productHandle') ?? '').trim()
  if (!productHandle) return Response.json({ error: 'Product handle required' }, { status: 400 })
  const formula = String(form.get('formula') ?? '')
  if (!(VIDEO_FORMULAS as readonly string[]).includes(formula)) {
    return Response.json({ error: 'Unknown formula' }, { status: 400 })
  }
  const presenter = String(form.get('presenter') ?? 'none')
  const modelTier = String(form.get('modelTier') ?? '')
  if (!isVideoModelId(modelTier)) return Response.json({ error: 'Unknown model tier' }, { status: 400 })
  const spec = VIDEO_MODELS[modelTier]

  const hooks = String(form.get('hooks') ?? '')
    .split('\n')
    .map(h => h.trim())
    .filter(Boolean)
  if (!hooks.length) return Response.json({ error: 'At least one hook line required' }, { status: 400 })

  const platforms = SOCIAL_PLATFORMS.filter(p => form.get(`platform-${p}`) === 'on')
  if (!platforms.length) return Response.json({ error: 'Pick at least one platform' }, { status: 400 })

  // Avatar tier derives duration from speech; its disabled select submits
  // nothing, so normalize to 0 there and validate everywhere else.
  const rawDuration = Number(form.get('durationSeconds'))
  const durationSeconds = spec.audioDriven ? 0 : rawDuration
  if (!spec.audioDriven && !spec.allowedDurations.includes(durationSeconds)) {
    return Response.json({ error: `Duration must be one of ${spec.allowedDurations.join(', ')}s for this tier` }, { status: 400 })
  }

  const str = (name: string): string => String(form.get(name) ?? '').trim()
  const talking = !!spec.audioDriven || !!spec.lipsync
  const tone = str('tone')
  const script: Record<string, unknown> = {
    ...(str('presenterLine') ? { presenterLine: str('presenterLine') } : {}),
    ...(str('voiceover') ? { voiceover: str('voiceover') } : {}),
    ...(str('framePrompt') ? { framePrompt: str('framePrompt') } : {}),
    ...(str('motionPrompt') ? { motionPrompt: str('motionPrompt') } : {}),
    ...(str('sceneSlug') ? { sceneSlug: str('sceneSlug') } : {}),
    ...(str('caption') ? { captions: { default: str('caption') } } : {}),
    ...(tone && (VIDEO_TONES as readonly string[]).includes(tone) ? { presenterTone: tone } : {}),
    ...(talking ? { talkingHead: true } : {}),
  }

  if (hooks.length === 1) {
    const result = await enqueueVideoJob({
      productHandle,
      formula,
      presenter,
      scriptJson: {
        ...script,
        hook: hooks[0]!,
        ...(durationSeconds > 0 ? { durationSeconds } : {}),
      } as VideoJobWithAssets['job']['scriptJson'],
      modelTier,
      durationSeconds,
      targetPlatforms: platforms,
    })
    return Response.json({ ok: true, ...result })
  }
  const result = await enqueueVideoJobSet({
    productHandle,
    formula,
    presenter,
    baseScriptJson: script as VideoJobWithAssets['job']['scriptJson'],
    modelTier,
    durationSeconds,
    targetPlatforms: platforms,
    hooks,
  })
  return Response.json({ ok: true, ...result })
}

// ─── Page ───────────────────────────────────────────────────────────────────

type Row = Awaited<ReturnType<typeof loader>>['rows'][number]

const ACTIVE = new Set(['queued', 'running', 'awaiting_provider', 'applying'])

export default function VideoStudioPage() {
  const { rows, active, models, cast } = useLoaderData<typeof loader>()
  const { revalidate } = useRevalidator()
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Display-refresh timer while jobs are in flight (same pattern as
  // admin.async-jobs.tsx) — data always comes from the loader.
  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      return
    }
    intervalRef.current = setInterval(() => { void revalidate() }, 4000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [active, revalidate])

  const parked = rows.filter(r => r.status === 'awaiting_frame_approval')
  const inFlight = rows.filter(r => ACTIVE.has(r.status))
  const ready = rows.filter(r => r.status === 'done' && r.stage === 'done')
  const failed = rows.filter(r => r.status === 'failed')

  // Variant sets among the ready jobs: group by variant_group_id when 2+
  // finished siblings share one; everything else reviews individually.
  const setGroups = new Map<string, Row[]>()
  for (const r of ready) {
    if (!r.variantGroupId) continue
    const list = setGroups.get(r.variantGroupId) ?? []
    list.push(r)
    setGroups.set(r.variantGroupId, list)
  }
  const readySets = [...setGroups.entries()].filter(([, list]) => list.length > 1)
  const inSet = new Set(readySets.flatMap(([, list]) => list.map(r => r.id)))
  const readySingles = ready.filter(r => !inSet.has(r.id))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Video Studio
        </h1>
        <p className="text-xs text-ink-4">
          Frames cost cents, clips cost dollars. Nothing posts without you.
        </p>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Awaiting frame pick" value={parked.length} accent={parked.length > 0} />
        <Stat label="Generating" value={inFlight.length} accent={false} />
        <Stat label="Ready to review" value={ready.length} accent={ready.length > 0} />
        <Stat label="Failed" value={failed.length} accent={false} />
      </div>

      {/* ── Compose ─────────────────────────────────────────────────────── */}
      <ComposeSection models={models} cast={cast} busy={busy} />

      {/* ── Frame approvals ─────────────────────────────────────────────── */}
      {parked.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-lg text-ink">Pick a frame</h2>
          {parked.map(job => (
            <div key={job.id} className="rounded-[22px] border border-line bg-paper-2 p-4">
              <JobHeader job={job} />
              <Form method="post" className="mt-3">
                <input type="hidden" name="intent" value="approve-frame" />
                <input type="hidden" name="jobRowId" value={job.id} />
                <div className="grid grid-cols-3 gap-2">
                  {job.frames.map(f => (
                    <button
                      key={f.id}
                      type="submit"
                      name="frameAssetId"
                      value={f.id}
                      disabled={busy}
                      className="group overflow-hidden rounded-lg border-2 border-line transition hover:border-coral disabled:opacity-50"
                    >
                      <img src={f.blobUrl} alt="Candidate frame" className="aspect-[9/16] w-full object-cover" />
                      <span className="block py-1 text-center text-xs text-ink-3 group-hover:text-coral">Use this frame</span>
                    </button>
                  ))}
                </div>
              </Form>
              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <Form method="post" className="flex flex-1 gap-2">
                  <input type="hidden" name="intent" value="retry-frames" />
                  <input type="hidden" name="jobRowId" value={job.id} />
                  <input
                    name="feedback"
                    placeholder="What should change? (regenerates 3 frames, ~$0.12)"
                    className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
                  />
                  <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40">
                    Retry frames
                  </button>
                </Form>
                <RejectForm jobRowId={job.id} busy={busy} />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── In production ───────────────────────────────────────────────── */}
      {inFlight.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg text-ink">Generating</h2>
          {inFlight.map(job => (
            <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-line bg-paper-2 px-4 py-3">
              <JobHeader job={job} compact />
              <span className="text-xs text-ink-3">
                {job.stage} · {job.status.replace(/_/g, ' ')} · ${Number(job.costUsd).toFixed(2)} so far
              </span>
            </div>
          ))}
          <p className="text-xs text-ink-4">The poller advances jobs every 2 minutes. This page refreshes itself.</p>
        </section>
      )}

      {/* ── Ready for review ────────────────────────────────────────────── */}
      {ready.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-lg text-ink">Ready for review</h2>
          {readySets.map(([groupId, jobs]) => (
            <div key={groupId} className="space-y-3 rounded-[22px] border border-plum/30 bg-plum-soft/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-sm font-medium text-ink">
                  Variant set · {jobs.length} finished · {jobs[0]!.productHandle}
                </p>
                <Form method="post">
                  <input type="hidden" name="intent" value="approve-all-set" />
                  <input type="hidden" name="variantGroupId" value={groupId} />
                  <button type="submit" disabled={busy} className="rounded-full bg-coral px-4 py-1.5 text-sm text-paper disabled:opacity-40">
                    Approve all in set
                  </button>
                </Form>
              </div>
              {jobs.map(job => <ReadyCard key={job.id} job={job} busy={busy} />)}
            </div>
          ))}
          {readySingles.map(job => <ReadyCard key={job.id} job={job} busy={busy} />)}
        </section>
      )}

      {/* ── History ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="font-display text-lg text-ink">All jobs</h2>
        <ResponsiveTable>
          <table className="min-w-[720px] w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Formula</th>
                <th className="py-2 pr-3">Presenter</th>
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3">Stage</th>
                <th className="py-2 pr-3">Cost</th>
                <th className="py-2 pr-3">Metrics</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(job => (
                <tr key={job.id} className="border-b border-line/50 align-top">
                  <td className="py-2 pr-3 text-ink">{job.productHandle}</td>
                  <td className="py-2 pr-3 text-ink-3">{job.formula}</td>
                  <td className="py-2 pr-3 text-ink-3">{job.presenter}</td>
                  <td className="py-2 pr-3 text-ink-3">{job.modelTier}</td>
                  <td className="py-2 pr-3">
                    <span className={job.status === 'failed' ? 'text-coral' : job.status === 'done' ? 'text-sage' : 'text-ink-3'}>
                      {job.status === 'failed' ? `failed` : `${job.stage} / ${job.status.replace(/_/g, ' ')}`}
                    </span>
                    {job.error && <p className="mt-1 max-w-[26ch] text-xs text-ink-4">{job.error.slice(0, 140)}</p>}
                  </td>
                  <td className="py-2 pr-3 text-ink-3">${Number(job.costUsd).toFixed(2)}</td>
                  <td className="min-w-[280px] py-2 pr-3">
                    {job.status === 'done' ? (
                      <MetricsForm job={job} busy={busy} />
                    ) : (
                      <span className="text-xs text-ink-4">n/a</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="py-6 text-center text-sm text-ink-4">
                  No video jobs yet. The video-producer routine enqueues them, or spike one from /admin/labs.
                </td></tr>
              )}
            </tbody>
          </table>
        </ResponsiveTable>
      </section>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent: boolean }) {
  return (
    <div className={`rounded-[14px] border px-4 py-3 ${accent ? 'border-coral bg-coral-soft' : 'border-line bg-paper-2'}`}>
      <p className="text-2xl font-bold text-ink">{value}</p>
      <p className="text-xs text-ink-3">{label}</p>
    </div>
  )
}

function JobHeader({ job, compact }: { job: Row; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-ink">{job.productHandle}</span>
      <Chip>{job.formula}</Chip>
      <Chip>{job.presenter}</Chip>
      <Chip>{job.modelTier}</Chip>
      {job.aiDisclosure && <Chip>AI-labeled</Chip>}
      {job.variantAxes?.sceneSlug && <Chip>{job.variantAxes.sceneSlug}</Chip>}
      {!compact && job.hook && <p className="w-full text-sm text-ink-3">"{job.hook}"</p>}
    </div>
  )
}

function ReadyCard({ job, busy }: { job: Row; busy: boolean }) {
  return (
    <div className="rounded-[22px] border border-line bg-paper-2 p-4">
      <JobHeader job={job} />
      <div className="mt-3 flex flex-col gap-4 md:flex-row">
        <div className="w-full md:w-56">
          {job.finalUrl && (
            <video
              src={job.finalUrl}
              poster={job.posterUrl ?? undefined}
              controls
              playsInline
              className="w-full rounded-lg border border-line bg-ink"
            />
          )}
          {job.finalUrl && (
            <a href={job.finalUrl} download className="mt-1 inline-block text-xs text-coral underline">
              Download mp4
            </a>
          )}
        </div>
        <div className="flex-1 space-y-3">
          {Object.entries(job.captions).length > 0 && (
            <div className="space-y-1">
              {Object.entries(job.captions).map(([platform, caption]) => (
                <p key={platform} className="text-sm text-ink-3">
                  <span className="font-medium text-ink">{platform}:</span> {caption}
                </p>
              ))}
            </div>
          )}
          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="approve" />
            <input type="hidden" name="jobRowId" value={job.id} />
            <fieldset className="space-y-1 text-sm text-ink-3">
              <legend className="text-xs font-medium uppercase tracking-wide text-ink-4">Also send to Shopify?</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="graduation" value="none" defaultChecked /> Social drafts only
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="graduation" value="media" /> Attach to PDP media gallery
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="graduation" value="hero" /> Set as hero_video (card autoplay + PDP)
              </label>
            </fieldset>
            <button type="submit" disabled={busy} className="rounded-full bg-coral px-5 py-2 text-sm text-paper disabled:opacity-40">
              Approve · fan out to {job.targetPlatforms.join(', ')}
            </button>
          </Form>
          <div className="flex flex-col gap-2 md:flex-row">
            <Form method="post" className="flex flex-1 gap-2">
              <input type="hidden" name="intent" value="regenerate" />
              <input type="hidden" name="jobRowId" value={job.id} />
              <input
                name="feedback"
                placeholder="Feedback for the retake (new job, same script)"
                className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
              <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40">
                Regenerate
              </button>
            </Form>
            <RejectForm jobRowId={job.id} busy={busy} />
          </div>
        </div>
      </div>
    </div>
  )
}

type LoaderData = Awaited<ReturnType<typeof loader>>

function ComposeSection({ models, cast, busy }: { models: LoaderData['models']; cast: LoaderData['cast']; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [tierId, setTierId] = useState<string>('kling25-pro')
  const tier = models.find(m => m.id === tierId)
  const talking = !!tier?.audioDriven || !!tier?.lipsync
  return (
    <section className="rounded-[22px] border border-line bg-paper-2 p-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between text-left">
        <span className="font-display text-lg text-ink">Compose a video</span>
        <span className="text-xs text-ink-4">{open ? 'Hide' : 'One or more hooks · frame gate + ceilings still apply'}</span>
      </button>
      {open && (
        <Form method="post" className="mt-4 space-y-3">
          <input type="hidden" name="intent" value="compose" />
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              name="productHandle"
              required
              placeholder="Product handle (e.g. satin-wand)"
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
            <select name="formula" className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              {VIDEO_FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select name="presenter" defaultValue="emma" className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              <option value="none">no presenter</option>
              <option value="emma">emma</option>
              {cast.map(m => <option key={m.slug} value={`friend:${m.slug}`}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <select name="modelTier" value={tierId} onChange={e => setTierId(e.target.value)} className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              {models.map(m => <option key={m.id} value={m.id}>{m.label} (${m.ratePerSecondUsd.toFixed(2)}/s)</option>)}
            </select>
            <select name="durationSeconds" className="rounded-lg border border-line bg-paper px-3 py-2 text-sm" disabled={!!tier?.audioDriven}>
              {(tier?.allowedDurations.length ? tier.allowedDurations : [8]).map(d => <option key={d} value={d}>{d}s</option>)}
            </select>
            <select name="sceneSlug" defaultValue="" className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              <option value="">no scene (fresh frame)</option>
              {SCENE_KIT.map(s => <option key={s.slug} value={s.slug}>{s.label}</option>)}
            </select>
            <select name="tone" defaultValue="" className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              <option value="">neutral tone</option>
              {VIDEO_TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <textarea
            name="hooks"
            required
            rows={3}
            placeholder={'Hook lines, one per line. Two or more lines become a variant set (shared approved frame, one review group).'}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
          />
          {talking ? (
            <textarea
              name="presenterLine"
              rows={2}
              placeholder="Spoken on-camera line. Use {{hook}} where each hook variant should be spoken."
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          ) : (
            <textarea
              name="voiceover"
              rows={2}
              placeholder="Voiceover narration (silent tiers only; optional). Use {{hook}} for per-variant substitution."
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          )}
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              name="framePrompt"
              placeholder="Frame prompt (scene composition; blank reuses the approved scene frame)"
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
            <input
              name="motionPrompt"
              placeholder="Motion prompt (required for non-avatar tiers)"
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          </div>
          <input
            name="caption"
            placeholder="Default caption for the social drafts (optional; falls back to hook + CTA)"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-3">
            {SOCIAL_PLATFORMS.map(p => (
              <label key={p} className="flex items-center gap-1 text-sm text-ink-3">
                <input type="checkbox" name={`platform-${p}`} defaultChecked={p === 'instagram'} /> {p}
              </label>
            ))}
          </div>
          <button type="submit" disabled={busy} className="rounded-full bg-coral px-5 py-2 text-sm text-paper disabled:opacity-40">
            Queue it · frame gate reviews before any dollar spend
          </button>
        </Form>
      )}
    </section>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink-3 border border-line">{children}</span>
}

function RejectForm({ jobRowId, busy }: { jobRowId: number; busy: boolean }) {
  return (
    <Form method="post" className="flex gap-2">
      <input type="hidden" name="intent" value="reject" />
      <input type="hidden" name="jobRowId" value={jobRowId} />
      <input type="hidden" name="reason" value="owner rejected" />
      <button type="submit" disabled={busy} className="rounded-full border border-line px-4 py-2 text-sm text-ink-3 hover:text-coral disabled:opacity-40">
        Reject
      </button>
    </Form>
  )
}

const METRIC_LABELS: Record<(typeof VIDEO_METRIC_FIELDS)[number], string> = {
  hookRetentionPct: 'hook %',
  saves: 'saves',
  shares: 'shares',
  profileTaps: 'taps',
  utmClicks: 'utm',
}

/** One platform's reported scorecard, or null when nothing was reported. */
function reportedSummary(metrics: Record<string, number | string> | undefined): string | null {
  if (!metrics) return null
  const parts = VIDEO_METRIC_FIELDS
    .filter(f => typeof metrics[f] === 'number')
    .map(f => `${METRIC_LABELS[f]} ${metrics[f]}${f === 'hookRetentionPct' ? '%' : ''}`)
  if (!parts.length) return null
  return parts.join(' · ')
}

function MetricsForm({ job, busy }: { job: Row; busy: boolean }) {
  const platform = job.targetPlatforms[0] ?? 'instagram'
  const metricsJson = (job.metricsJson ?? {}) as Record<string, Record<string, number | string>>
  return (
    <div className="space-y-1">
      {/* Reported state per platform. Absent = "not yet reported", never an estimate. */}
      {job.targetPlatforms.map(p => {
        const summary = reportedSummary(metricsJson[p])
        const notes = typeof metricsJson[p]?.['notes'] === 'string' ? String(metricsJson[p]['notes']) : null
        return (
          <p key={p} className="text-xs text-ink-3">
            <span className="font-medium text-ink">{p}:</span>{' '}
            {summary ?? <span className="text-ink-4">not yet reported</span>}
            {notes && <span className="text-ink-4"> · {notes.slice(0, 60)}</span>}
          </p>
        )
      })}
      <Form method="post" className="flex flex-wrap items-center gap-1">
        <input type="hidden" name="intent" value="metrics" />
        <input type="hidden" name="jobRowId" value={job.id} />
        <select name="platform" defaultValue={platform} className="rounded border border-line bg-paper px-1 py-0.5 text-xs">
          {job.targetPlatforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {VIDEO_METRIC_FIELDS.map(f => (
          <input
            key={f}
            name={f}
            type="number"
            min="0"
            step={f === 'hookRetentionPct' ? '0.1' : '1'}
            placeholder={METRIC_LABELS[f]}
            className="w-16 rounded border border-line bg-paper px-1 py-0.5 text-xs"
          />
        ))}
        <input name="notes" placeholder="notes" className="w-28 rounded border border-line bg-paper px-1 py-0.5 text-xs" />
        <button type="submit" disabled={busy} className="rounded border border-line px-2 py-0.5 text-xs text-ink-3 hover:text-ink disabled:opacity-40">
          Save
        </button>
        <span className="w-full text-[10px] text-ink-4">Blank fields keep their reported value.</span>
      </Form>
    </div>
  )
}
