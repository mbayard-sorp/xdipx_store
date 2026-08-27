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
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  }
})
vi.mock('~/lib/kv.server', () => ({
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  KV_KEYS: { videoPollerIdle: 'video:poller:idle' },
}))
const configMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
vi.mock('~/lib/blob.server', () => ({ blobPut: vi.fn(), blobFetchToBuffer: vi.fn() }))
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: vi.fn(), logImageCost: vi.fn() }))
vi.mock('~/lib/sanity.server', () => ({ getEditorPhotoUrl: vi.fn(), getApprovedCastMembers: vi.fn().mockResolvedValue([]) }))
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: vi.fn() }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: vi.fn() }))
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
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
const runpodSubmitMock = vi.hoisted(() => vi.fn())
const runpodStatusMock = vi.hoisted(() => vi.fn())
const runpodResultMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/runpod-video.server', () => ({
  submitRunpodVideo: runpodSubmitMock,
  getRunpodStatus: runpodStatusMock,
  getRunpodResult: runpodResultMock,
  runpodVideoConfigured: vi.fn(() => true),
  cancelRunpod: vi.fn(),
}))

import { enqueueVideoJobSet, estimateJobCostUsd, advanceInflightVideoJobs } from '~/lib/video-pipeline.server'
import { logVideoCost } from '~/lib/token-log.server'
import { blobPut, blobFetchToBuffer } from '~/lib/blob.server'
import { computeRunpodActualCostUsd, estimateVideoCostUsd } from '~/lib/model-pricing.server'

const baseArgs = {
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'none',
  baseScriptJson: { framePrompt: 'archetype B', motionPrompt: 'slow push', voiceover: '{{hook}}' },
  modelTier: 'wan22-i2v' as const,
  durationSeconds: 5,
  targetPlatforms: ['instagram'],
  hooks: ['Hook one', 'Hook two', 'Hook three'],
}

beforeEach(() => {
  vi.clearAllMocks()
  state.selectResults = []
  state.inserts = []
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
    const perJob = estimateJobCostUsd('wan22-i2v', 5, { reuseFrame: false })
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
    // A tiny per-video ceiling makes the set budget (ceiling x cap) smaller than
    // any three-variant total, so the set-budget guard fires regardless of tier.
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 5, maxVariantsPerSet: 4,
    })
    await expect(enqueueVideoJobSet(baseArgs)).rejects.toThrow(/set budget/i)
    expect(state.inserts).toHaveLength(0)
  })

  it('zeroes the frame cost for variants whose scene already has an approved frame', async () => {
    // One findReusableSceneFrame lookup per variant (set estimate); the
    // enqueue itself does not re-query in this path. talkingHead:true triggers
    // the sceneSlug reuse path on an eligible (wan22-i2v) tier.
    state.selectResults = [[{ frameId: 55 }], [{ frameId: 55 }]]
    const result = await enqueueVideoJobSet({
      ...baseArgs,
      presenter: 'emma',
      modelTier: 'wan22-i2v',
      durationSeconds: 5,
      hooks: ['now', 'later'],
      baseScriptJson: { talkingHead: true, sceneSlug: 'couch-cozy', framePrompt: 'C', motionPrompt: 'hold' },
    })
    const expected = 2 * estimateJobCostUsd('wan22-i2v', 5, { reuseFrame: true })
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

// RunPod provider branch in the clip stage (video-provider Phase 2, Wan 2.2
// 14B). Fal's own clip path is untouched (byte-for-byte); these tests only
// exercise the new `spec.provider === 'runpod'` fork.
describe('advanceClip — RunPod provider (wan22-i2v)', () => {
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

  it('submits with mode i2v and the frame URL, and accrues the ESTIMATE without logging it (no api_token_log row at submit)', async () => {
    state.selectResults = [
      [baseJobRow],                                          // advanceInflightVideoJobs' job-rows query
      [{ id: 55, blobUrl: 'https://blob.test/frame.jpg' }],   // scene-frame asset lookup
    ]
    runpodSubmitMock.mockResolvedValue({
      requestId: 'rp-1',
      statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-1',
      responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-1',
    })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(result.advanced).toBe(1)
    expect(runpodSubmitMock).toHaveBeenCalledWith({
      prompt: 'slow push toward the product',
      imageUrl: 'https://blob.test/frame.jpg',
      durationSeconds: 8,
      mode: 'i2v',
      blobPathPrefix: 'video/job-wan22',
    })
    // Estimate accrues to the job row (ceiling enforcement) but never lands in
    // api_token_log — only the ACTUAL cost does, once the job completes.
    expect(logVideoCost).not.toHaveBeenCalled()
    // Never touches the fal queue client's blob round-trip.
    expect(blobPut).not.toHaveBeenCalled()
    expect(blobFetchToBuffer).not.toHaveBeenCalled()
  })

  it('on COMPLETED, records the mediaAssets clip row with blobUrl = the worker videoUrl (no download/re-upload), and replaces the estimate with the actual cost', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      costUsd: String(estimateVideoCostUsd('runpod/wan22', 8)), // what submit accrued
      providerRequestIds: {
        clip: { requestId: 'rp-1', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-1', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-1' },
      },
    }
    state.selectResults = [[awaitingRow]] // only the job-rows query; no frame lookup on poll
    runpodStatusMock.mockResolvedValue({ status: 'COMPLETED' })
    runpodResultMock.mockResolvedValue({
      videoUrl: 'https://blob.vercel-storage.com/video/job-wan22/clip.mp4',
      renderSeconds: 300,
      executionMs: 300000,
    })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(result.advanced).toBe(1)
    expect(blobPut).not.toHaveBeenCalled()
    expect(blobFetchToBuffer).not.toHaveBeenCalled()

    const clipInsert = state.inserts.find(r => r['purpose'] === 'clip')
    expect(clipInsert).toMatchObject({
      kind: 'video',
      purpose: 'clip',
      blobUrl: 'https://blob.vercel-storage.com/video/job-wan22/clip.mp4',
      contentType: 'video/mp4',
      sourceModel: 'runpod/wan22',
    })
    const actualCost = computeRunpodActualCostUsd(300000)
    expect(clipInsert?.['costUsd']).toBe(String(actualCost))
    expect(logVideoCost).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'video-clip',
      model: 'runpod/wan22',
      seconds: 8,
      actualCostUsd: actualCost,
    }))
  })

  it('waits (does not insert or log) while the runpod job is still in progress', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        clip: { requestId: 'rp-1', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-1', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-1' },
      },
    }
    state.selectResults = [[awaitingRow]]
    runpodStatusMock.mockResolvedValue({ status: 'IN_PROGRESS' })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(runpodResultMock).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0)
    expect(logVideoCost).not.toHaveBeenCalled()
  })
})
