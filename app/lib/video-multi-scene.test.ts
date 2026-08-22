/**
 * Multi-scene video jobs (Phase 3, 20-60s videos, migration 083): scene
 * validation + defaulting at enqueue, the cost estimate summed over scenes,
 * scene ordering + 'last-frame' continuity in the clip stage, and the final
 * concat that hands a single 'clip' asset off to the (unmodified) lipsync /
 * assembly stages.
 *
 * Mocking follows video-pipeline-set.test.ts's pattern exactly: db/kv/blob/
 * token-log/sanity/shopify/ivr-voice/elevenlabs/video-assembly/video-postpass
 * are mocked; RunPod is mocked the same way its own clip-stage tests mock it
 * (no network). fal-video.server is left real (data-only at this scope — no
 * test here exercises its fal-provider network calls).
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
const blobPutMock = vi.hoisted(() => vi.fn())
const blobFetchMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/blob.server', () => ({ blobPut: blobPutMock, blobFetchToBuffer: blobFetchMock }))
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: vi.fn(), logImageCost: vi.fn() }))
vi.mock('~/lib/sanity.server', () => ({ getEditorPhotoUrl: vi.fn(), getApprovedCastMembers: vi.fn().mockResolvedValue([]) }))
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: vi.fn() }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: vi.fn() }))
const concatMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
  applyWatermark: vi.fn(),
  probeDurationSeconds: vi.fn(),
  muxAudio: vi.fn(),
  renderAspectMaster: vi.fn(),
  concatAndNormalize: concatMock,
  extractLastFrame: vi.fn(),
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

import { enqueueVideoJob, advanceInflightVideoJobs } from '~/lib/video-pipeline.server'
import { estimateVideoCostUsd, estimateImageCostUsd } from '~/lib/model-pricing.server'
import { SCENE_FRAME_COST_KEY, SCENE_PLATE_COST_KEY } from '~/lib/fal-video.server'

beforeEach(() => {
  vi.clearAllMocks()
  state.selectResults = []
  state.inserts = []
  configMock.mockResolvedValue({
    team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
    autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 4,
  })
})

const scene = (overrides: Record<string, unknown> = {}) => ({
  slug: 'product-detail',
  framePrompt: 'product on a cream surface',
  motionPrompt: 'slow push in',
  durationSeconds: 5,
  ...overrides,
})

const baseEnqueueArgs = {
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'none',
  modelTier: 'wan22-i2v' as const,
  durationSeconds: 5, // ignored for multi-scene; real total is the scene sum
  targetPlatforms: ['instagram'],
}

describe('enqueueVideoJob — multi-scene validation', () => {
  it('does not treat a 1-entry scenes array as multi-scene (2 is the minimum)', async () => {
    // scriptJson.scenes with a single entry does not meet MULTI_SCENE_MIN, so
    // isMultiSceneScript is false and the job takes the ordinary single-scene
    // path — scenesJson/sceneStateJson stay unset on the inserted row.
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { framePrompt: 'x', motionPrompt: 'y', scenes: [scene()] },
    })
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]!['scenesJson']).toBeNull()
    expect(state.inserts[0]!['sceneStateJson']).toBeNull()
  })

  it('rejects more than 8 scenes', async () => {
    const scenes = Array.from({ length: 9 }, () => scene())
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes },
    })).rejects.toThrow(/2-8 scenes/)
  })

  it('rejects a scene duration not in the model\'s allowedDurations', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ durationSeconds: 3 }), scene({ durationSeconds: 5 })] },
    })).rejects.toThrow(/durationSeconds must be one of/)
  })

  it('rejects a total scene duration over the 90s multi-scene ceiling', async () => {
    const scenes = Array.from({ length: 8 }, () => scene({ durationSeconds: 15 })) // 8*15=120s
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes },
    })).rejects.toThrow(/90s/)
  })

  it('rejects scenes[0] explicitly set to last-frame continuity (nothing precedes it)', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ continuity: 'last-frame' }), scene()] },
    })).rejects.toThrow(/scenes\[0\]/)
  })

  it('rejects the avatar tier for a multi-scene job (no per-scene motion prompt concept)', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      modelTier: 'omnihuman',
      durationSeconds: 0,
      scriptJson: { scenes: [scene(), scene()] },
    })).rejects.toThrow(/avatar tier/)
  })

  it('defaults continuity: scene 0 own-frame, every later scene last-frame', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene(), scene(), scene()] }, // no explicit continuity anywhere
    })
    expect(state.inserts).toHaveLength(1)
    const stored = state.inserts[0]!['scenesJson'] as { continuity: string }[]
    expect(stored.map(s => s.continuity)).toEqual(['own-frame', 'last-frame', 'last-frame'])
    const sceneState = state.inserts[0]!['sceneStateJson'] as { status: string }[]
    expect(sceneState).toEqual([{ status: 'pending' }, { status: 'pending' }, { status: 'pending' }])
  })
})

describe('enqueueVideoJob — multi-scene cost estimate', () => {
  it('sums frame cost (own-frame scenes only) + clip cost per scene', async () => {
    const scenes = [scene({ durationSeconds: 5 }), scene({ durationSeconds: 8, continuity: 'last-frame' })]
    const result = await enqueueVideoJob({ ...baseEnqueueArgs, scriptJson: { scenes } })
    const frameCost = estimateImageCostUsd(SCENE_PLATE_COST_KEY, 1) + estimateImageCostUsd(SCENE_FRAME_COST_KEY, 3)
    const expected = frameCost
      + estimateVideoCostUsd('runpod/wan22', 5)
      + estimateVideoCostUsd('runpod/wan22', 8)
    expect(result.estCostUsd).toBeCloseTo(expected, 4)
  })

  it('rejects a multi-scene job whose summed estimate exceeds the per-video ceiling', async () => {
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 1, maxVariantsPerSet: 4,
    })
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene(), scene()] },
    })).rejects.toThrow(/ceiling/)
    expect(state.inserts).toHaveLength(0)
  })
})

// ─── Clip stage: scene ordering + 'last-frame' continuity (RunPod provider) ──

const multiSceneJobRow = {
  id: 9,
  jobId: 'job-multiscene',
  productHandle: 'satin-wand',
  shopifyProductGid: null,
  formula: 'myth-busting',
  presenter: 'none',
  scriptJson: {},
  aiDisclosure: true,
  modelTier: 'wan22-i2v',
  targetPlatforms: ['instagram'],
  stage: 'clip',
  status: 'queued',
  providerRequestIds: {} as Record<string, unknown>,
  sceneFrameAssetId: null,
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
  scenesJson: [
    { slug: 'scene-a', framePrompt: 'a', motionPrompt: 'push in on scene a', durationSeconds: 5, continuity: 'own-frame' },
    { slug: 'scene-b', framePrompt: 'b', motionPrompt: 'pan across scene b', durationSeconds: 6, continuity: 'last-frame' },
  ],
  sceneStateJson: null as unknown,
}

describe('advanceClip — multi-scene, RunPod provider', () => {
  it('submits scene 0 (own-frame) using its approved frame asset, keyed scene_0', async () => {
    const job = {
      ...multiSceneJobRow,
      sceneStateJson: [{ frameAssetId: 55, status: 'frame' }, { status: 'pending' }],
    }
    state.selectResults = [
      [job],
      [{ id: 55, blobUrl: 'https://blob.test/scene0-frame.jpg' }],
    ]
    runpodSubmitMock.mockResolvedValue({
      requestId: 'rp-scene0',
      statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-scene0',
      responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-scene0',
    })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(runpodSubmitMock).toHaveBeenCalledWith({
      prompt: 'push in on scene a',
      imageUrl: 'https://blob.test/scene0-frame.jpg',
      durationSeconds: 5,
      mode: 'i2v',
      blobPathPrefix: 'video/job-multiscene/scene-0',
    })
  })

  it('on scene 0 completion, records its clip + lastFrameUrl and stays in the clip stage (more scenes remain)', async () => {
    const job = {
      ...multiSceneJobRow,
      status: 'awaiting_provider',
      costUsd: String(estimateVideoCostUsd('runpod/wan22', 5)),
      providerRequestIds: {
        scene_0: { requestId: 'rp-scene0', statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-scene0', responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-scene0' },
      },
      sceneStateJson: [{ frameAssetId: 55, status: 'frame' }, { status: 'pending' }],
    }
    state.selectResults = [[job]]
    runpodStatusMock.mockResolvedValue({ status: 'COMPLETED' })
    runpodResultMock.mockResolvedValue({
      videoUrl: 'https://blob.vercel-storage.com/video/job-multiscene/scene-0/clip.mp4',
      lastFrameUrl: 'https://blob.vercel-storage.com/video/job-multiscene/scene-0/last.jpg',
      renderSeconds: 5,
      executionMs: 5000,
    })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    const clipInsert = state.inserts.find(r => r['purpose'] === 'clip')
    expect(clipInsert).toMatchObject({ blobUrl: 'https://blob.vercel-storage.com/video/job-multiscene/scene-0/clip.mp4' })
    // Stage stays 'clip' (via touch's implicit set — no stage key means unchanged);
    // status returns to 'queued' so the poller comes back for scene 1.
    expect(runpodResultMock).toHaveBeenCalled()
  })

  it('submits scene 1 (last-frame) using the PREVIOUS scene\'s lastFrameUrl, not a frame-asset lookup', async () => {
    const job = {
      ...multiSceneJobRow,
      sceneStateJson: [
        { frameAssetId: 55, clipAssetId: 1, status: 'done', lastFrameUrl: 'https://blob.test/scene0-last.jpg' },
        { status: 'pending' },
      ],
    }
    state.selectResults = [[job]] // no mediaAssets lookup for scene 1 — it has no frameAssetId
    runpodSubmitMock.mockResolvedValue({
      requestId: 'rp-scene1',
      statusUrl: 'https://api.runpod.ai/v2/ep/status/rp-scene1',
      responseUrl: 'https://api.runpod.ai/v2/ep/status/rp-scene1',
    })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(runpodSubmitMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'pan across scene b',
      imageUrl: 'https://blob.test/scene0-last.jpg',
      durationSeconds: 6,
      blobPathPrefix: 'video/job-multiscene/scene-1',
    }))
  })

  it('fails the scene clearly when last-frame continuity has no prior lastFrameUrl to source', async () => {
    const job = {
      ...multiSceneJobRow,
      sceneStateJson: [
        { frameAssetId: 55, clipAssetId: 1, status: 'done' }, // no lastFrameUrl captured
        { status: 'pending' },
      ],
    }
    state.selectResults = [[job]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(runpodSubmitMock).not.toHaveBeenCalled()
  })
})

// ─── Clip stage: all scenes done -> concat into ONE clip asset ──────────────

describe('advanceClip — multi-scene concat (hands off to the unmodified lipsync/assembly stages)', () => {
  it('concatenates scene clips in order into a single new "clip" asset, then advances to stage=lipsync', async () => {
    const job = {
      ...multiSceneJobRow,
      sceneStateJson: [
        { clipAssetId: 101, status: 'done' },
        { clipAssetId: 102, status: 'done' },
      ],
    }
    state.selectResults = [
      [job],
      [{ id: 101, blobUrl: 'https://blob.test/scene-0-clip.mp4' }],
      [{ id: 102, blobUrl: 'https://blob.test/scene-1-clip.mp4' }],
    ]
    const buf0 = Buffer.from('scene-0')
    const buf1 = Buffer.from('scene-1')
    blobFetchMock.mockResolvedValueOnce(buf0).mockResolvedValueOnce(buf1)
    concatMock.mockResolvedValue(Buffer.from('merged'))
    blobPutMock.mockResolvedValue({ url: 'https://blob.test/clip-concat.mp4' })

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    // Fetched in scene order, concatenated in that same order.
    expect(blobFetchMock).toHaveBeenNthCalledWith(1, 'https://blob.test/scene-0-clip.mp4')
    expect(blobFetchMock).toHaveBeenNthCalledWith(2, 'https://blob.test/scene-1-clip.mp4')
    expect(concatMock).toHaveBeenCalledWith([buf0, buf1])
    const clipInsert = state.inserts.find(r => r['purpose'] === 'clip' && r['blobUrl'] === 'https://blob.test/clip-concat.mp4')
    expect(clipInsert).toBeTruthy()
  })
})
