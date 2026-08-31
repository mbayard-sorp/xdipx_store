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
    // Thenable itself (not just `.limit()`) so a query that terminates at
    // `.where()` with no `.limit()`, e.g. listVideoJobs's media_assets
    // lookup, resolves against the same state.selectResults queue as every
    // other query in this mock.
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(state.selectResults.shift() ?? []).then(resolve, reject),
    }
    chain['where'] = () => chain
    chain['orderBy'] = () => chain
    chain['limit'] = () => chain
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
// #5943: enqueueVideoJob now also reads today's spend for the daily-budget fit
// check. Default to 0 spent so these multi-scene enqueues stay well under the
// 2000c daily budget (the ceiling-refusal test throws at the ceiling check,
// which runs first).
const spendMock = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock, getTodaySpendCents: spendMock }))
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
  cancelRunpod: vi.fn(),
}))

import { enqueueVideoJob, advanceInflightVideoJobs, listVideoJobs } from '~/lib/video-pipeline.server'
import { estimateVideoCostUsd, estimateImageCostUsd } from '~/lib/model-pricing.server'
import { SCENE_FRAME_COST_KEY, SCENE_PLATE_COST_KEY } from '~/lib/fal-video.server'
import { getApprovedCastMembers } from '~/lib/sanity.server'

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

  it('rejects a missing framePrompt on an own-frame scene', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ framePrompt: undefined, continuity: 'own-frame' }), scene()] },
    })).rejects.toThrow(/scenes\[0\]\.framePrompt is required for own-frame scenes/)
  })

  it('allows a missing framePrompt on a last-frame scene (never used there, its opening frame comes from the previous scene\'s clip)', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene(), scene({ framePrompt: undefined, continuity: 'last-frame' })] },
    })
    expect(state.inserts).toHaveLength(1)
    const stored = state.inserts[0]!['scenesJson'] as { framePrompt?: string; continuity: string }[]
    expect(stored[1]!.continuity).toBe('last-frame')
    expect(stored[1]!.framePrompt).toBeUndefined()
  })

  it('rejects the avatar tier for a multi-scene job (no per-scene motion prompt concept)', async () => {
    // Widened so the job reaches the multi-scene check rather than being
    // refused earlier for an unavailable worker mode — that refusal is real
    // and covered separately, but it is not what this test is about.
    workerModes.value = ['i2v', 't2v', 's2v']
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      modelTier: 'wan22-s2v',
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

// ─── listVideoJobs: scene-frame candidate grouping (Video Studio picker) ────

describe('listVideoJobs — scene frame candidate grouping', () => {
  it('groups scene_frame candidates by scene index even though blobPut adds a random suffix before the extension (real production shape: video_jobs id 5, parked scene 0)', async () => {
    // Exact production shape from the ticket: 3 scenes, scene 0 own-frame,
    // parked at scene_frame/awaiting_frame_approval with only frameAssetId 20
    // recorded on scene_state_json. The other two candidates (21, 22) are
    // only discoverable through media_assets, which is what listVideoJobs's
    // grouping has to surface for MultiSceneFramePicker to render anything.
    const job = {
      ...multiSceneJobRow,
      id: 5,
      stage: 'scene_frame',
      status: 'awaiting_frame_approval',
      sceneFrameAssetId: null,
      scenesJson: [
        scene({ slug: 'scene-0', continuity: 'own-frame' }),
        scene({ slug: 'scene-1', continuity: 'last-frame' }),
        scene({ slug: 'scene-2', continuity: 'last-frame' }),
      ],
      sceneStateJson: [
        { status: 'awaiting_frame_approval', frameAssetId: 20 },
        { status: 'pending' },
        { status: 'pending' },
      ],
    }
    // blobPut always writes with addRandomSuffix: true, so the real blob
    // pathname carries a random segment between the frame index and the
    // extension, never the bare `scene-0-frame-0.jpg` the naming convention
    // comment implies.
    state.selectResults = [
      [job],
      [
        { id: 20, blobUrl: 'https://blob.test/video/job-5/scene-0-frame-0-aBcDeFgH12345678.jpg', purpose: 'scene_frame', videoJobId: 5 },
        { id: 21, blobUrl: 'https://blob.test/video/job-5/scene-0-frame-1-qRsTuVwX87654321.jpg', purpose: 'scene_frame', videoJobId: 5 },
        { id: 22, blobUrl: 'https://blob.test/video/job-5/scene-0-frame-2-zZyYxXwW11223344.jpg', purpose: 'scene_frame', videoJobId: 5 },
      ],
    ]

    const [row] = await listVideoJobs(40)

    expect(row?.sceneFrames?.[0]).toHaveLength(3)
    expect(row?.sceneFrames?.[0]?.map(f => f.id).sort()).toEqual([20, 21, 22])
  })

  it('still groups candidates when blobPut writes the bare filename with no random suffix', async () => {
    const job = {
      ...multiSceneJobRow,
      id: 5,
      scenesJson: [scene({ slug: 'scene-0', continuity: 'own-frame' }), scene({ slug: 'scene-1', continuity: 'last-frame' })],
      sceneStateJson: [{ status: 'awaiting_frame_approval', frameAssetId: 20 }, { status: 'pending' }],
    }
    state.selectResults = [
      [job],
      [{ id: 20, blobUrl: 'https://blob.test/video/job-5/scene-0-frame-0.jpg', purpose: 'scene_frame', videoJobId: 5 }],
    ]

    const [row] = await listVideoJobs(40)

    expect(row?.sceneFrames?.[0]?.map(f => f.id)).toEqual([20])
  })
})

describe('enqueueVideoJob — presenter voice guard (ticket #6584)', () => {
  const castMember = (overrides: Record<string, unknown> = {}) => ({
    slug: 'maya', name: 'Maya', role: null, photoUrl: 'https://blob.test/maya.jpg', photoAlt: null,
    shortBio: null, personaNotes: null, archetype: null, ageRange: null, description: null,
    emotionTags: [] as string[], editorialPhotoUrl: null, voiceId: null as string | null,
    ...overrides,
  })

  it('refuses, before any spend, to enqueue a talking friend with no voiceId assigned', async () => {
    vi.mocked(getApprovedCastMembers).mockResolvedValueOnce([castMember({ voiceId: null })])
    workerModes.value = ['i2v', 't2v', 's2v']
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:maya',
      modelTier: 'wan22-s2v',
      scriptJson: { presenterLine: 'This one is my favorite.', talkingHead: true },
    })).rejects.toThrow(/no voiceId assigned/i)
    expect(state.inserts).toHaveLength(0)
  })

  it('enqueues once the talking friend has a voiceId assigned in Sanity', async () => {
    vi.mocked(getApprovedCastMembers).mockResolvedValueOnce([castMember({ voiceId: 'maya-voice-1' })])
    workerModes.value = ['i2v', 't2v', 's2v']
    const result = await enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:maya',
      modelTier: 'wan22-s2v',
      scriptJson: { presenterLine: 'This one is my favorite.', talkingHead: true },
    })
    expect(result.jobId).toBeTruthy()
    expect(state.inserts).toHaveLength(1)
  })

  it('does not gate a silent tier (no presenter voice ever spoken)', async () => {
    // wan22-i2v is neither audioDriven nor lipsync, so a friend with no
    // voiceId still enqueues — nothing about this tier ever calls TTS for
    // the presenter's line.
    vi.mocked(getApprovedCastMembers).mockResolvedValueOnce([castMember({ voiceId: null })])
    const result = await enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:maya',
      modelTier: 'wan22-i2v',
      scriptJson: { scenes: [scene(), scene()] },
    })
    expect(result.jobId).toBeTruthy()
  })
})
