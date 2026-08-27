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
          return { where: () => Promise.resolve() }
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
const runpodCancelMock = vi.hoisted(() => vi.fn())
/**
 * What the DEPLOYED worker image implements. Real semantics, not a permissive
 * stub: tierIneligibility reads this, and a mock that said "every mode is
 * available" would hide exactly the trap it exists for. Default matches the
 * live endpoint (image eb2a126: i2v + t2v, no s2v); a test that needs the
 * avatar tier widens it deliberately and says so.
 */
const workerModes = vi.hoisted(() => ({ value: ['i2v', 't2v'] as string[] }))
vi.mock('~/lib/runpod-video.server', () => ({
  submitRunpodVideo: runpodSubmitMock,
  getRunpodStatus: runpodStatusMock,
  getRunpodResult: runpodResultMock,
  runpodVideoConfigured: vi.fn(() => true),
  // Real semantics, not a stub: tierIneligibility reads these, and a mock that
  // said "every mode is available" would hide exactly the trap they exist for.
  runpodWorkerModes: () => workerModes.value,
  runpodWorkerSupportsMode: (m: string) => workerModes.value.includes(m),
  cancelRunpod: runpodCancelMock,
}))

import { enqueueVideoJobSet, estimateJobCostUsd, advanceInflightVideoJobs } from '~/lib/video-pipeline.server'
import { estimateAvatarSpeechSeconds } from '~/lib/avatar-script'
import { logVideoCost } from '~/lib/token-log.server'
import { blobPut, blobFetchToBuffer } from '~/lib/blob.server'
import { computeRunpodActualCostUsd, estimateVideoCostUsd } from '~/lib/model-pricing.server'
import { rejectVideoJob } from '~/lib/video-pipeline.server'

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
  state.updates = []
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
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 30, maxVariantsPerSet: 4,
    })
    await expect(enqueueVideoJobSet(baseArgs)).rejects.toThrow(/set budget/i)
    expect(state.inserts).toHaveLength(0)
  })

  it('zeroes the frame cost for variants whose scene already has an approved frame', async () => {
    // The avatar path needs an avatar tier, and the only one left is the
    // RunPod s2v tier — omnihuman is retired with the rest of fal video. Widen
    // the worker's declared modes for this test only; the point under test is
    // the frame-cost arithmetic, not tier eligibility.
    workerModes.value = ['i2v', 't2v', 's2v']
    const line = 'Short spoken line about {{hook}}.'
    // One findReusableSceneFrame lookup per variant (set estimate); the
    // enqueue itself does not re-query in this path.
    state.selectResults = [[{ frameId: 55 }], [{ frameId: 55 }]]
    const result = await enqueueVideoJobSet({
      ...baseArgs,
      presenter: 'emma',
      modelTier: 'wan22-s2v',
      durationSeconds: 0,
      hooks: ['now', 'later'],
      baseScriptJson: { presenterLine: line, talkingHead: true, sceneSlug: 'couch-cozy', framePrompt: 'C' },
    })
    const expected = ['now', 'later'].reduce((sum, hook) => {
      const speech = estimateAvatarSpeechSeconds(line.split('{{hook}}').join(hook))
      return sum + estimateJobCostUsd('wan22-s2v', 0, { speechSeconds: speech, reuseFrame: true })
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

  /**
   * Orphan cancellation (ticket #5728). A RunPod request outlives the row that
   * submitted it: nothing reads the output of a terminal job, but the GPU
   * keeps billing to completion or to the 1800s execution timeout. cancelRunpod
   * existed from the start and was called from nowhere.
   */
  it('cancels the in-flight runpod request when the job fails, and records what it burned', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        clip: { requestId: 'rp-1', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-1', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-1' },
      },
    }
    state.selectResults = [[awaitingRow]]
    // COMPLETED, then a result the pipeline cannot use -> advanceJob throws.
    runpodStatusMock.mockResolvedValue({ status: 'COMPLETED', executionMs: 210_000 })
    runpodResultMock.mockRejectedValue(new Error('runpod result missing output.videoUrl'))

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(runpodCancelMock).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'rp-1' }))
    expect(logVideoCost).toHaveBeenCalledWith(expect.objectContaining({
      refId: 'job-wan22#clip#cancelled',
      actualCostUsd: computeRunpodActualCostUsd(210_000),
    }))
  })

  it('cancels every sibling part, which is the avatar multi-part leak', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        avatar_0: { requestId: 'rp-a', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-a', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-a' },
        avatar_1: { requestId: 'rp-b', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-b', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-b' },
        // Non-handle bookkeeping keys share this column and must be skipped.
        avatar_billed_seconds: 30,
        assembly_attempts: 2,
      } as never,
    }
    state.selectResults = [[awaitingRow]]
    runpodStatusMock.mockResolvedValue({ status: 'FAILED', executionMs: 5_000 })

    await advanceInflightVideoJobs()

    expect(runpodCancelMock).toHaveBeenCalledTimes(2)
    expect(runpodCancelMock.mock.calls.map(c => (c[0] as { requestId: string }).requestId).sort()).toEqual(['rp-a', 'rp-b'])
  })

  it('leaves a fal handle alone (fal video is retired and its cancel semantics differ)', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        clip: { requestId: 'fal-1', statusUrl: 'https://queue.fal.run/some/model/requests/fal-1', responseUrl: 'https://queue.fal.run/some/model/requests/fal-1' },
      },
    }
    state.selectResults = [[awaitingRow]]
    runpodStatusMock.mockRejectedValue(new Error('boom'))

    await advanceInflightVideoJobs()

    expect(runpodCancelMock).not.toHaveBeenCalled()
  })

  it('a failing cancel never masks the error that led there', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        clip: { requestId: 'rp-1', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-1', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-1' },
      },
    }
    state.selectResults = [[awaitingRow]]
    runpodStatusMock.mockResolvedValue({ status: 'FAILED', executionMs: 1_000 })
    runpodCancelMock.mockRejectedValue(new Error('already terminal on runpod side'))

    const result = await advanceInflightVideoJobs()

    // Still a clean single failure, not a thrown poller pass.
    expect(result.failed).toBe(1)
  })

  it('rejectVideoJob cancels what is still rendering (prod job 4 took exactly this path)', async () => {
    const awaitingRow = {
      ...baseJobRow,
      status: 'awaiting_provider',
      providerRequestIds: {
        clip: { requestId: 'rp-9', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-9', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-9' },
      },
    }
    state.selectResults = [[awaitingRow]]
    runpodStatusMock.mockResolvedValue({ status: 'IN_PROGRESS', executionMs: 42_000 })

    await rejectVideoJob(7, 'not the read I wanted')

    expect(runpodCancelMock).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'rp-9' }))
    expect(logVideoCost).toHaveBeenCalledWith(expect.objectContaining({
      refId: 'job-wan22#clip#cancelled',
      actualCostUsd: computeRunpodActualCostUsd(42_000),
    }))
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
