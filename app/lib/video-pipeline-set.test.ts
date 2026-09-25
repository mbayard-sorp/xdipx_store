/**
 * enqueueVideoJobSet contract tests: the variant cap, the set-level budget
 * check running BEFORE any insert, sibling rows sharing one variant_group_id,
 * and frame reuse zeroing the frame cost in the set estimate.
 *
 * Everything with a side effect (db, kv, blob, providers) is mocked; the
 * estimate math runs the real model-pricing rates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
  /** Every db.update(...).set(...) payload, so a test can assert WHY a job failed. */
  updates: [] as Array<Record<string, unknown>>,
  /** Rows a conditional update's .returning() pretends to have matched. */
  updateReturns: [{ id: 1 }] as Array<{ id: number }>,
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain['where'] = () => chain
    chain['orderBy'] = () => chain
    chain['limit'] = () => Promise.resolve(state.selectResults.shift() ?? [])
    return chain
  }
  return {
    db: {
      select: () => ({ from: () => selectChain() }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          state.inserts.push(v)
          const p = Promise.resolve([{ id: state.inserts.length }]) as Promise<unknown> & { returning?: () => Promise<unknown> }
          p.returning = () => Promise.resolve([{ id: state.inserts.length }])
          return p
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          state.updates.push(v)
          return {
            where: () => {
              const p = Promise.resolve() as Promise<unknown> & { returning?: () => Promise<unknown> }
              p.returning = () => Promise.resolve(state.updateReturns)
              return p
            },
          }
        },
      }),
    },
  }
})
vi.mock('~/lib/kv.server', () => ({
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  KV_KEYS: { videoPollerIdle: 'video:poller:idle' },
}))
const configMock = vi.hoisted(() => vi.fn())
// #5943: enqueueVideoJob now also reads today's spend for the daily-budget fit
// check. Default to 0 spent so these variant enqueues stay under the 2000c
// daily budget.
const spendMock = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock, getTodaySpendCents: spendMock }))
const settingMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<string | null> => null))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: settingMock }))
const gateFramesMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/video-frame-gate.server', () => ({ gateVideoFrames: gateFramesMock }))
const episodeMocks = vi.hoisted(() => ({
  reapStaleEpisodeClaims: vi.fn(async () => 0),
  markEpisodeRenderFailed: vi.fn(async () => true),
  markEpisodeRenderRejected: vi.fn(async () => true),
  episodeForJob: vi.fn(async (): Promise<{ id: number } | null> => null),
}))
vi.mock('~/lib/video-episodes.server', () => episodeMocks)
vi.mock('~/lib/blob.server', () => ({ blobPut: vi.fn(), blobFetchToBuffer: vi.fn() }))
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: vi.fn(), logImageCost: vi.fn() }))
// Real presenterPhotoUrlForCrop semantics, not a stub (ticket #10484).
const cropPhoto = vi.hoisted(() => (
  m: { photoUrl: string; bodyReferencePhotoUrl?: string | null },
  cropScale: string | null | undefined,
) => ((cropScale === 'macro' || cropScale === 'close') && m.bodyReferencePhotoUrl ? m.bodyReferencePhotoUrl : m.photoUrl))
vi.mock('~/lib/sanity.server', () => ({ getEditorPhotoUrl: vi.fn(), getApprovedCastMembers: vi.fn().mockResolvedValue([]), presenterPhotoUrlForCrop: cropPhoto }))
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: vi.fn() }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: vi.fn() }))
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
  extractFrames: vi.fn(async () => []),
  applyWatermark: vi.fn(),
  probeDurationSeconds: vi.fn(),
  muxAudio: vi.fn(),
  renderAspectMaster: vi.fn(),
}))
vi.mock('~/lib/video-postpass.server', () => ({
  concatWithAudio: vi.fn(),
  runPostPass: vi.fn(),
  buildEndCard: vi.fn(),
}))

import { enqueueVideoJobSet, estimateJobCostUsd, advanceInflightVideoJobs } from '~/lib/video-pipeline.server'
import { estimateAvatarSpeechSeconds } from '~/lib/avatar-script'
import { logVideoCost } from '~/lib/token-log.server'
import { blobPut, blobFetchToBuffer } from '~/lib/blob.server'
import { INFLIGHT_VIDEO_STATUSES, approveRenderedVideo, rejectRenderedVideo, fanOutVideoToSocialDrafts } from '~/lib/video-pipeline.server'
import { extractPoster, probeDurationSeconds } from '~/lib/video-assembly.server'

const baseArgs = {
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'none',
  baseScriptJson: { framePrompt: 'archetype B', motionPrompt: 'slow push', voiceover: '{{hook}}' },
  modelTier: 'wan27-atlas' as const,
  durationSeconds: 5,
  targetPlatforms: ['instagram'],
  hooks: ['Hook one', 'Hook two', 'Hook three'],
}

beforeEach(() => {
  vi.clearAllMocks()
  // Atlas tiers are refused as provider_not_configured without the key (ADR-016).
  vi.stubEnv('ATLAS_CLOUD_API_KEY', 'test-atlas-key')
  state.selectResults = []
  state.inserts = []
  state.updates = []
  state.updateReturns = [{ id: 1 }]
  settingMock.mockImplementation(async () => null)
  configMock.mockResolvedValue({
    team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
    autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 4,
  })
})

describe('enqueueVideoJobSet', () => {
  it('inserts one row per hook, all sharing a variant_group_id with per-row axes', async () => {
    const result = await enqueueVideoJobSet(baseArgs)
    expect(result.jobs).toHaveLength(3)
    expect(state.inserts).toHaveLength(3)
    const groupIds = new Set(state.inserts.map(r => r['variantGroupId']))
    expect(groupIds.size).toBe(1)
    expect([...groupIds][0]).toBe(result.variantGroupId)
    expect(state.inserts.map(r => (r['variantAxes'] as { hook: string }).hook)).toEqual(['Hook one', 'Hook two', 'Hook three'])
    const perJob = estimateJobCostUsd('wan27-atlas', 5, { reuseFrame: false })
    expect(result.totalEstCostUsd).toBeCloseTo(perJob * 3, 4)
  })

  it('rejects a set over the variants-per-set cap before any insert', async () => {
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 2,
    })
    await expect(enqueueVideoJobSet(baseArgs)).rejects.toThrow(/cap/)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects when the set estimate exceeds ceiling x cap, before any insert', async () => {
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 30, maxVariantsPerSet: 4,
    })
    await expect(enqueueVideoJobSet(baseArgs)).rejects.toThrow(/set budget/i)
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses a stored retired default tier with the retirement named, never swapping in a paid tier', async () => {
    // ADR-016 blocker 226: production's video_default_model_tier may still read
    // a deleted RunPod id until the owner resets it.
    settingMock.mockImplementation(async (key: string) => (key === 'video_default_model_tier' ? 'wan22-i2v' : null))
    const { modelTier: _omit, ...noTier } = baseArgs
    await expect(enqueueVideoJobSet(noTier)).rejects.toThrow(/RunPod worker, which is retired/)
    expect(state.inserts).toHaveLength(0)
  })

  it('zeroes the frame cost for variants whose scene already has an approved frame', async () => {
    // The avatar path needs an avatar tier: InfiniteTalk on Atlas since
    // ADR-016 (omnihuman is retired with fal video).
    const line = 'Short spoken line about {{hook}}.'
    // One findReusableSceneFrame lookup per variant (set estimate); the
    // enqueue itself does not re-query in this path.
    state.selectResults = [[{ frameId: 55 }], [{ frameId: 55 }]]
    const result = await enqueueVideoJobSet({
      ...baseArgs,
      presenter: 'emma',
      modelTier: 'italk-atlas',
      durationSeconds: 0,
      hooks: ['now', 'later'],
      baseScriptJson: { presenterLine: line, talkingHead: true, sceneSlug: 'couch-cozy', framePrompt: 'C' },
    })
    const expected = ['now', 'later'].reduce((sum, hook) => {
      const speech = estimateAvatarSpeechSeconds(line.split('{{hook}}').join(hook))
      return sum + estimateJobCostUsd('italk-atlas', 0, { speechSeconds: speech, reuseFrame: true })
    }, 0)
    expect(result.totalEstCostUsd).toBeCloseTo(expected, 4)
    expect(state.inserts).toHaveLength(2)
  })
})

describe('estimateJobCostUsd — Grok Imagine tier (ticket #3991)', () => {
  it('prices the clip at 0.14/s; reused frame leaves exactly 0.14*duration', () => {
    // reuseFrame zeroes the frame cost, so the estimate is the pure clip cost.
    expect(estimateJobCostUsd('grok', 8, { reuseFrame: true })).toBeCloseTo(1.12, 5)
    expect(estimateJobCostUsd('grok', 5, { reuseFrame: true })).toBeCloseTo(0.7, 5)
  })

  it('adds the frame cost when a frame must be composed', () => {
    expect(estimateJobCostUsd('grok', 8, { reuseFrame: false })).toBeGreaterThan(1.12)
  })
})

// Historical RunPod rows after ADR-016 Phase 4 (2026-09-23). The wan22 tiers
// are deleted from VIDEO_MODELS; a row that still names one fails with the
// retired_provider message, never a TypeError from an undefined spec. The
// Atlas submit -> poll -> re-host flow is covered in video-pipeline-atlas.test.ts.
describe('advanceJob: historical RunPod rows (retired, ADR-016)', () => {
  const baseJobRow = {
    id: 7,
    jobId: 'job-wan22',
    productHandle: 'satin-wand',
    shopifyProductGid: null,
    formula: 'myth-busting',
    presenter: 'none',
    scriptJson: { motionPrompt: 'slow push toward the product', durationSeconds: 8 },
    aiDisclosure: true,
    modelTier: 'wan22-i2v',
    targetPlatforms: ['instagram'],
    stage: 'clip',
    status: 'queued',
    providerRequestIds: {} as Record<string, { requestId: string; statusUrl: string; responseUrl: string }>,
    sceneFrameAssetId: 55,
    finalAssetId: null,
    posterAssetId: null,
    costUsd: '0',
    metricsJson: null,
    variantGroupId: null,
    variantAxes: null,
    error: null,
    team: 'video',
    runId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  }

  it('fails a queued wan22 clip with the retirement named', async () => {
    state.selectResults = [
      [baseJobRow],                                          // advanceInflightVideoJobs' job-rows query
      [{ id: 55, blobUrl: 'https://blob.test/frame.jpg' }],   // scene-frame asset lookup
    ]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(state.updates.map(u => String(u['error'] ?? '')).join(' ')).toMatch(/RunPod worker, which is retired/)
    expect(state.updates.map(u => String(u['error'] ?? '')).join(' ')).not.toMatch(/TypeError|undefined/)
    expect(logVideoCost).not.toHaveBeenCalled()
  })

  it('fails an in-flight wan22 row rather than polling a retired worker forever', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        clip: { requestId: 'rp-1', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-1', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-1' },
      },
    }
    state.selectResults = [[awaitingRow]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(state.updates.map(u => String(u['error'] ?? '')).join(' ')).toMatch(/RunPod worker, which is retired/)
    expect(state.inserts.filter(r => r['purpose'] === 'clip')).toHaveLength(0)
  })

  /**
   * The frame stage's per-video ceiling guard (ticket #5941). It was the one
   * spending stage with no getMaxCostCents check, so frame cost could cross
   * the ceiling and strand the job: the cost still accrues, and the clip stage
   * then refuses a job already paid for in frames.
   *
   * Asserted on the guard's own message rather than on the whole stage
   * succeeding — composing a frame needs Sanity/Shopify/Atlas, which this
   * harness does not stand up, and a test that passed only because the stage
   * failed later would prove nothing.
   */
  const frameJob = (costUsd: string) => ({
    ...baseJobRow,
    modelTier: 'wan27-atlas',
    stage: 'scene_frame',
    status: 'queued',
    sceneFrameAssetId: null,
    costUsd,
    scriptJson: { framePrompt: 'archetype B', motionPrompt: 'slow push', durationSeconds: 8 },
  })

  it('refuses to compose candidates that would carry the job past the ceiling', async () => {
    state.selectResults = [[frameJob('5.99')]] // ceiling is $6.00 in this fixture
    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(state.updates.map(u => String(u['error'] ?? '')).join(' ')).toMatch(/per-video ceiling/)
    // Refused BEFORE the spend: no candidate assets inserted.
    expect(state.inserts.filter(r => r['purpose'] === 'scene_frame')).toHaveLength(0)
  })

  it('does not refuse on cost when there is headroom left', async () => {
    state.selectResults = [[frameJob('0')]]
    await advanceInflightVideoJobs()

    // It may still fail further down this harness (no Sanity/Shopify stubs),
    // but it must not be the ceiling that stopped it.
    expect(state.updates.map(u => String(u['error'] ?? '')).join(' ')).not.toMatch(/per-video ceiling/)
  })

})

/**
 * The render gate (Phase 2b): the poster stage parks a finished cut at
 * awaiting_render_approval while video_render_review is ON (the default), the
 * poller never selects it, only an owner approve releases it to 'done', and
 * nothing fans out to social drafts until then.
 */
describe('render gate: awaiting_render_approval', () => {
  const posterJob = {
    id: 11,
    jobId: 'job-cut',
    productHandle: 'satin-wand',
    shopifyProductGid: null,
    formula: 'myth-busting',
    presenter: 'none',
    scriptJson: { motionPrompt: 'slow push', durationSeconds: 8 },
    aiDisclosure: true,
    modelTier: 'kling25-pro',
    targetPlatforms: ['instagram'],
    stage: 'poster',
    status: 'queued',
    providerRequestIds: {},
    sceneFrameAssetId: 55,
    finalAssetId: 90,
    posterAssetId: null,
    scenesJson: null,
    sceneStateJson: null,
    costUsd: '1.20',
    metricsJson: null,
    variantGroupId: null,
    variantAxes: null,
    error: null,
    team: 'video',
    runId: null,
    episodeId: null as number | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  }

  function armPosterStage() {
    state.selectResults = [
      [posterJob],                                                  // poller's job-rows query
      [{ id: 90, blobUrl: 'https://blob.test/video/job-cut/final.mp4' }], // final asset
    ]
    vi.mocked(blobFetchToBuffer).mockResolvedValue(Buffer.from('mp4'))
    vi.mocked(extractPoster).mockResolvedValue(Buffer.from('jpg'))
    vi.mocked(probeDurationSeconds).mockResolvedValue(8)
    vi.mocked(blobPut).mockResolvedValue({ url: 'https://blob.test/video/job-cut/poster.jpg' } as never)
    gateFramesMock.mockResolvedValue({ pass: true, notes: '', frameVerdicts: [{ verdict: 'pass' }] })
  }

  it('the poller never selects a parked cut', () => {
    expect(INFLIGHT_VIDEO_STATUSES as readonly string[]).not.toContain('awaiting_render_approval')
    expect(INFLIGHT_VIDEO_STATUSES as readonly string[]).not.toContain('awaiting_frame_approval')
    expect('awaiting_render_approval'.length).toBeLessThanOrEqual(24) // video_jobs.status varchar(24)
  })

  const terminalWrite = () => state.updates.find(u => u['stage'] === 'done')

  it('parks the finished cut instead of finishing it when the valve is unset (defaults ON)', async () => {
    armPosterStage()
    const result = await advanceInflightVideoJobs()
    expect(result.failed).toBe(0)
    expect(result.parked).toBe(1)
    expect(result.done).toBe(0)
    expect(terminalWrite()).toMatchObject({ stage: 'done', status: 'awaiting_render_approval' })
    expect(terminalWrite()?.['posterAssetId']).toBeDefined()
    expect(settingMock).toHaveBeenCalledWith('video_render_review')
  })

  it('finishes straight to done when video_render_review is false', async () => {
    armPosterStage()
    settingMock.mockImplementation(async (key: string) => (key === 'video_render_review' ? 'false' : null))
    const result = await advanceInflightVideoJobs()
    expect(result.done).toBe(1)
    expect(result.parked).toBe(0)
    expect(terminalWrite()).toMatchObject({ stage: 'done', status: 'done' })
  })

  it('the post-render vision gate still wins: a FAIL parks at awaiting_final_review, not the render gate', async () => {
    armPosterStage()
    gateFramesMock.mockResolvedValue({ pass: false, notes: 'nudity', frameVerdicts: [] })
    await advanceInflightVideoJobs()
    expect(state.updates.some(u => u['status'] === 'awaiting_final_review')).toBe(true)
    expect(state.updates.some(u => u['status'] === 'awaiting_render_approval')).toBe(false)
  })

  it('approveRenderedVideo releases a parked cut to done', async () => {
    await approveRenderedVideo(11)
    expect(state.updates[0]).toMatchObject({ status: 'done' })
  })

  it('approveRenderedVideo throws when nothing was parked (double click, or already decided)', async () => {
    state.updateReturns = []
    await expect(approveRenderedVideo(11)).rejects.toThrow(/not awaiting final-cut approval/)
  })

  it('fanOutVideoToSocialDrafts refuses a parked cut, so no social draft exists before approval', async () => {
    state.selectResults = [[{ ...posterJob, stage: 'done', status: 'awaiting_render_approval' }]]
    await expect(fanOutVideoToSocialDrafts(11, 'mike')).rejects.toThrow(/awaiting your approval/)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejectRenderedVideo requires a reason and writes nothing without one', async () => {
    await expect(rejectRenderedVideo(11, '   ', 'mike')).rejects.toThrow(/reason is required/)
    expect(state.updates).toHaveLength(0)
  })

  it('rejectRenderedVideo fails the job with the reason and hands a linked episode back', async () => {
    state.selectResults = [[{ ...posterJob, stage: 'done', status: 'awaiting_render_approval', episodeId: 4 }]]
    const result = await rejectRenderedVideo(11, 'hands melt at 0:04', 'mike@xdipx.com')
    expect(state.updates[0]).toMatchObject({ status: 'failed' })
    // stage stays 'done'; status 'failed' alone keeps it out of every list.
    expect(state.updates[0]).not.toHaveProperty('stage')
    expect(String(state.updates[0]?.['error'])).toMatch(/Final cut rejected by owner: hands melt/)
    expect(episodeMocks.markEpisodeRenderRejected).toHaveBeenCalledWith(4, 'job job-cut: hands melt at 0:04', 'mike@xdipx.com')
    expect(result).toEqual({ episodeReleased: true, episodeId: 4 })
  })

  it('rejectRenderedVideo on an unlinked job fails it and touches no episode', async () => {
    state.selectResults = [[{ ...posterJob, stage: 'done', status: 'awaiting_render_approval' }]]
    const result = await rejectRenderedVideo(11, 'off-brand', 'mike')
    expect(result).toEqual({ episodeReleased: false, episodeId: null })
    expect(episodeMocks.markEpisodeRenderRejected).not.toHaveBeenCalled()
  })

  it('rejectRenderedVideo refuses a job that is not parked (never fails a finished or approved cut)', async () => {
    state.selectResults = [[{ ...posterJob, stage: 'done', status: 'done' }]]
    state.updateReturns = []
    await expect(rejectRenderedVideo(11, 'late change of heart', 'mike')).rejects.toThrow(/not awaiting final-cut approval/)
    expect(episodeMocks.markEpisodeRenderRejected).not.toHaveBeenCalled()
  })
})
