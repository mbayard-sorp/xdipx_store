/**
 * Per-scene presenter identity + two-shot compositing at the scene_frame
 * stage (ADR-014, ticket #6586). Split out from video-multi-scene.test.ts
 * because it is the one code path in this ticket that needs
 * composeSceneFrame/downloadFalAsset mocked — every other multi-scene test in
 * this repo leaves fal-video.server real (data-only) and never reaches this
 * branch (it exercises the reuse path or a pre-set 'frame'/'clip' state
 * instead). Mocking follows video-multi-scene.test.ts's pattern for
 * everything else (db/kv/team/blob/sanity/shopify are mocked the same way).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
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
const spendMock = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock, getTodaySpendCents: spendMock }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
const blobPutMock = vi.hoisted(() => vi.fn(async (path: string) => ({ url: `https://blob.test/${path}` })))
vi.mock('~/lib/blob.server', () => ({ blobPut: blobPutMock, blobFetchToBuffer: vi.fn() }))
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: vi.fn(), logImageCost: vi.fn() }))
const castMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/sanity.server', () => ({ getEditorPhotoUrl: vi.fn(), getApprovedCastMembers: castMock }))
const productMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: productMock }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: vi.fn() }))
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
  applyWatermark: vi.fn(),
  probeDurationSeconds: vi.fn(),
  muxAudio: vi.fn(),
  renderAspectMaster: vi.fn(),
  concatAndNormalize: vi.fn(),
  extractLastFrame: vi.fn(),
}))
vi.mock('~/lib/video-postpass.server', () => ({
  concatWithAudio: vi.fn(),
  runPostPass: vi.fn(),
  buildEndCard: vi.fn(),
}))
vi.mock('~/lib/runpod-video.server', () => ({
  submitRunpodVideo: vi.fn(),
  getRunpodStatus: vi.fn(),
  getRunpodResult: vi.fn(),
  runpodVideoConfigured: vi.fn(() => true),
  runpodWorkerModes: () => ['i2v', 't2v'],
  runpodWorkerSupportsMode: (m: string) => ['i2v', 't2v'].includes(m),
  cancelRunpod: vi.fn(),
}))
const composeSceneFrameMock = vi.hoisted(() => vi.fn())
const downloadFalAssetMock = vi.hoisted(() => vi.fn(async () => Buffer.from('fake-jpeg')))
vi.mock('~/lib/fal-video.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/fal-video.server')>('~/lib/fal-video.server')
  return { ...actual, composeSceneFrame: composeSceneFrameMock, downloadFalAsset: downloadFalAssetMock }
})

import { advanceInflightVideoJobs } from '~/lib/video-pipeline.server'

beforeEach(() => {
  vi.clearAllMocks()
  state.selectResults = []
  state.inserts = []
  configMock.mockResolvedValue({
    team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
    autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 4,
  })
  castMock.mockResolvedValue([
    { slug: 'maya', name: 'Maya', role: null, photoUrl: 'https://blob.test/maya.jpg', voiceId: 'voice-maya' },
    { slug: 'diego-r', name: 'Diego', role: null, photoUrl: 'https://blob.test/diego.jpg', voiceId: 'voice-diego' },
  ])
  productMock.mockResolvedValue({ images: [{ url: 'https://blob.test/product.jpg' }] })
  composeSceneFrameMock.mockResolvedValue({
    urls: ['https://fal.test/candidate-0.jpg'],
    requestIds: ['req-1'],
    costKey: 'fal/scene-frame',
  })
})

const multiSceneJobRow = {
  id: 42,
  jobId: 'job-two-shot',
  productHandle: 'satin-wand',
  shopifyProductGid: null,
  formula: 'myth-busting',
  presenter: 'friend:maya', // job-level presenter — scene 1 below overrides it
  scriptJson: {},
  aiDisclosure: true,
  modelTier: 'wan22-i2v',
  targetPlatforms: ['instagram'],
  stage: 'scene_frame',
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
    { slug: 'scene-a', framePrompt: 'a', motionPrompt: 'push in', durationSeconds: 5, continuity: 'own-frame' },
    {
      slug: 'scene-b', framePrompt: 'b', motionPrompt: 'two shot', durationSeconds: 5, continuity: 'own-frame',
      presenter: 'friend:diego-r', coPresenters: ['friend:maya'],
    },
  ],
  sceneStateJson: [{ status: 'frame', frameAssetId: 10 }, { status: 'pending' }],
}

describe('advanceSceneFrameMultiScene — per-scene presenter + coPresenters (ADR-014, ticket #6586)', () => {
  it("composes scene 1's frame from its OWN presenter (diego), not the job's (maya)", async () => {
    state.selectResults = [[multiSceneJobRow]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(composeSceneFrameMock).toHaveBeenCalledTimes(1)
    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/diego.jpg',
    }))
  })

  it('passes coPresenters through as composeSceneFrame extraImageUrls (the video frame stage wiring the compositor already supported)', async () => {
    state.selectResults = [[multiSceneJobRow]]

    await advanceInflightVideoJobs()

    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      extraImageUrls: ['https://blob.test/maya.jpg'],
    }))
  })

  it('a scene with no presenter falls back to the job presenter, and passes no extraImageUrls (existing single-presenter jobs render byte-for-byte unchanged)', async () => {
    const singlePresenterJob = {
      ...multiSceneJobRow,
      scenesJson: [
        { slug: 'scene-a', framePrompt: 'a', motionPrompt: 'push in', durationSeconds: 5, continuity: 'own-frame' },
        { slug: 'scene-b', framePrompt: 'b', motionPrompt: 'still on maya', durationSeconds: 5, continuity: 'own-frame' },
      ],
    }
    state.selectResults = [[singlePresenterJob]]

    await advanceInflightVideoJobs()

    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya.jpg', // job.presenter, scene.presenter absent
    }))
    const call = composeSceneFrameMock.mock.calls[0]![0] as Record<string, unknown>
    expect(call['extraImageUrls']).toBeUndefined()
  })
})
