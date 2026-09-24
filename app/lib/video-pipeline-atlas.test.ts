/**
 * ADR-016: a clip on an Atlas tier goes submit -> awaiting_provider -> done ->
 * blobPut through the REAL media-provider registry and the REAL Atlas adapter,
 * with fetch mocked at the network edge, and never touches RunPod.
 *
 * Harness copied from video-pipeline-set.test.ts (db/kv/blob/token-log/sanity/
 * shopify/elevenlabs/video-assembly mocked). The only provider-shaped mock is
 * global fetch, answering with the bake-off capture's response shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
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
          return {
            where: () => {
              const p = Promise.resolve() as Promise<unknown> & { returning?: () => Promise<unknown> }
              p.returning = () => Promise.resolve([{ id: 1 }])
              return p
            },
          }
        },
      }),
    },
  }
})
vi.mock('~/lib/kv.server', () => ({ kvSet: vi.fn(), kvDel: vi.fn(), KV_KEYS: { videoPollerIdle: 'video:poller:idle' } }))
const configMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock, getTodaySpendCents: vi.fn(async () => 0) }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => null) }))
vi.mock('~/lib/video-frame-gate.server', () => ({ gateVideoFrames: vi.fn() }))
vi.mock('~/lib/video-episodes.server', () => ({
  reapStaleEpisodeClaims: vi.fn(async () => 0),
  markEpisodeRenderFailed: vi.fn(async () => true),
  markEpisodeRenderRejected: vi.fn(async () => true),
  episodeForJob: vi.fn(async () => null),
}))
const blobPutMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/blob.server', () => ({ blobPut: blobPutMock, blobFetchToBuffer: vi.fn() }))
const logVideoCostMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: logVideoCostMock, logImageCost: vi.fn(), logGenerationBlock: vi.fn(async () => {}) }))
vi.mock('~/lib/sanity.server', () => ({ getEditorPhotoUrl: vi.fn(), getApprovedCastMembers: vi.fn().mockResolvedValue([]), presenterPhotoUrlForCrop: vi.fn() }))
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: vi.fn() }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
const ttsMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: ttsMock }))
const probeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
  extractFrames: vi.fn(async () => []),
  applyWatermark: vi.fn(),
  probeDurationSeconds: probeMock,
  muxAudio: vi.fn(),
  renderAspectMaster: vi.fn(),
  extractLastFrame: vi.fn(),
}))
vi.mock('~/lib/video-postpass.server', () => ({ concatWithAudio: vi.fn(), runPostPass: vi.fn(), buildEndCard: vi.fn() }))
const runpod = vi.hoisted(() => ({
  submitRunpodVideo: vi.fn(),
  getRunpodStatus: vi.fn(),
  getRunpodResult: vi.fn(),
  cancelRunpod: vi.fn(),
}))
vi.mock('~/lib/runpod-video.server', () => ({
  ...runpod,
  runpodVideoConfigured: vi.fn(() => true),
  runpodWorkerModes: () => ['i2v', 't2v'],
  runpodWorkerSupportsMode: (m: string) => ['i2v', 't2v'].includes(m),
}))

import { advanceInflightVideoJobs } from '~/lib/video-pipeline.server'
import { estimateVideoCostUsd } from '~/lib/model-pricing.server'

const ATLAS = 'https://api.atlascloud.ai/api/v1'
const PRED_ID = 'b072da7f39c24a5f89cfc5ddfcc01352'
const PRED_URL = `${ATLAS}/model/prediction/${PRED_ID}`
const OUT_MP4 = `https://atlas-media.oss-us-west-1.aliyuncs.com/assetd-history/v1/a/u/s/${PRED_ID}-9add71b41618f952.mp4`
const FRAME = 'https://x.public.blob.vercel-storage.com/video/job-atlas/frame.jpg'
const HANDLE = { requestId: PRED_ID, statusUrl: PRED_URL, responseUrl: PRED_URL }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const prediction = (status: string, outputs: string[] | null = null) =>
  json({ code: 200, message: '', data: { id: PRED_ID, model: 'alibaba/wan-2.7/image-to-video', outputs, urls: { get: PRED_URL }, has_nsfw_contents: null, status, error: '' } })

const jobRow = (over: Record<string, unknown> = {}) => ({
  id: 7,
  jobId: 'job-atlas',
  productHandle: 'le-wand-mini-micro-wand',
  shopifyProductGid: null,
  formula: 'myth-busting',
  presenter: 'none',
  scriptJson: { motionPrompt: 'she turns the wand slowly to show its head', durationSeconds: 5 },
  aiDisclosure: true,
  modelTier: 'wan27-atlas',
  targetPlatforms: ['instagram'],
  stage: 'clip',
  status: 'queued',
  providerRequestIds: {} as Record<string, unknown>,
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
  scenesJson: null,
  sceneStateJson: null,
  ...over,
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  state.selectResults = []
  state.inserts = []
  state.updates = []
  vi.stubEnv('ATLAS_CLOUD_API_KEY', 'test-atlas-key')
  vi.stubEnv('WAVESPEED_API_KEY', '')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  configMock.mockResolvedValue({
    team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
    autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 4,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function expectRunpodUntouched(): void {
  expect(runpod.submitRunpodVideo).not.toHaveBeenCalled()
  expect(runpod.getRunpodStatus).not.toHaveBeenCalled()
  expect(runpod.getRunpodResult).not.toHaveBeenCalled()
  expect(runpod.cancelRunpod).not.toHaveBeenCalled()
  for (const call of fetchMock.mock.calls) expect(String(call[0])).not.toMatch(/runpod/)
}

describe('Atlas clip: submit -> awaiting_provider -> done -> blobPut (wan27-atlas)', () => {
  it('tick 1 submits to Atlas and parks awaiting_provider with the prediction handle', async () => {
    state.selectResults = [[jobRow()], [{ id: 55, blobUrl: FRAME }]]
    fetchMock.mockResolvedValueOnce(json({ code: 200, message: '', data: { id: PRED_ID, status: 'processing', outputs: null, urls: { get: PRED_URL } } }))

    const r = await advanceInflightVideoJobs()

    expect(r.failed).toBe(0)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ATLAS}/model/generateVideo`)
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'alibaba/wan-2.7/image-to-video', image: FRAME, duration: 5, resolution: '720P' })
    const parked = state.updates.find(u => u['status'] === 'awaiting_provider')
    expect(parked?.['providerRequestIds']).toEqual({ clip: HANDLE })
    expect(Number(parked?.['costUsd'])).toBeCloseTo(estimateVideoCostUsd('atlascloud/wan-2.7-i2v', 5), 6)
    expect(logVideoCostMock).toHaveBeenCalledWith(expect.objectContaining({ feature: 'video-clip', model: 'atlascloud/wan-2.7-i2v', seconds: 5 }))
    expect(blobPutMock).not.toHaveBeenCalled()
    expectRunpodUntouched()
  })

  it('tick 2 waits while Atlas reports processing, then pending (InfiniteTalk reports pending after processing)', async () => {
    for (const s of ['processing', 'pending']) {
      state.selectResults = [[jobRow({ status: 'awaiting_provider', providerRequestIds: { clip: HANDLE } })]]
      fetchMock.mockResolvedValueOnce(prediction(s))
      const r = await advanceInflightVideoJobs()
      expect(r.failed).toBe(0)
    }
    expect(state.inserts).toHaveLength(0)
    expect(blobPutMock).not.toHaveBeenCalled()
    expectRunpodUntouched()
  })

  it('tick 3 sees completed and downloads + blobPuts the mp4 in the same tick, then hands off to lipsync', async () => {
    state.selectResults = [[jobRow({ status: 'awaiting_provider', providerRequestIds: { clip: HANDLE } })]]
    fetchMock
      .mockResolvedValueOnce(prediction('completed', [OUT_MP4])) // status
      .mockResolvedValueOnce(prediction('completed', [OUT_MP4])) // result
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24]))) // the mp4 itself
    blobPutMock.mockResolvedValue({ url: 'https://x.public.blob.vercel-storage.com/video/job-atlas/clip-abc.mp4' })

    const r = await advanceInflightVideoJobs()

    expect(r.failed).toBe(0)
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([PRED_URL, PRED_URL, OUT_MP4])
    expect(blobPutMock).toHaveBeenCalledWith('video/job-atlas/clip.mp4', expect.any(Buffer), { contentType: 'video/mp4' })
    expect(state.inserts.find(i => i['purpose'] === 'clip')).toMatchObject({
      kind: 'video',
      blobUrl: 'https://x.public.blob.vercel-storage.com/video/job-atlas/clip-abc.mp4',
      sourceModel: 'atlascloud/wan-2.7-i2v',
    })
    expect(state.updates.some(u => u['stage'] === 'lipsync' && u['status'] === 'queued')).toBe(true)
    expectRunpodUntouched()
  })

  it('a failed prediction fails the job with the provider message', async () => {
    state.selectResults = [[jobRow({ status: 'awaiting_provider', providerRequestIds: { clip: HANDLE } })]]
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: { id: PRED_ID, model: 'alibaba/wan-2.7/image-to-video', status: 'failed', error: 'CUDA out of memory' } }))

    const r = await advanceInflightVideoJobs()

    expect(r.failed).toBe(1)
    expect(state.updates.map(u => String(u['error'] ?? '')).join(' ')).toMatch(/atlascloud video generation failed: atlas: CUDA out of memory/)
    expectRunpodUntouched()
  })

  it('polls a mirror-issued handle on Wavespeed even though the tier names Atlas', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', 'ws-key')
    const ws = { requestId: 'ws0000000001', statusUrl: 'https://api.wavespeed.ai/api/v3/predictions/ws0000000001/result', responseUrl: 'https://api.wavespeed.ai/api/v3/predictions/ws0000000001/result' }
    state.selectResults = [[jobRow({ modelTier: 'wan22turbo-atlas', status: 'awaiting_provider', providerRequestIds: { clip: ws } })]]
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: { id: 'ws0000000001', status: 'processing' } }))

    const r = await advanceInflightVideoJobs()

    expect(r.failed).toBe(0)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(ws.statusUrl)
    expectRunpodUntouched()
  })
})

describe('Atlas avatar: InfiniteTalk keeps the ElevenLabs step and hands the audio URL to Atlas', () => {
  it('TTS -> blobPut speech -> submit {image, audio} -> parks awaiting_provider', async () => {
    const job = jobRow({
      modelTier: 'infinitetalk-atlas',
      presenter: 'emma',
      scriptJson: { presenterLine: 'This is the mini wand. It fits in a coat pocket.' },
    })
    state.selectResults = [[job], [{ id: 55, blobUrl: FRAME }]]
    ttsMock.mockResolvedValue({ audio: Buffer.from('mp3'), alignment: null })
    probeMock.mockResolvedValue(9.4)
    blobPutMock.mockResolvedValueOnce({ url: 'https://x.public.blob.vercel-storage.com/video/job-atlas/speech-0.mp3' })
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: { id: PRED_ID, status: 'processing' } }))

    const r = await advanceInflightVideoJobs()

    expect(r.failed).toBe(0)
    expect(ttsMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ATLAS}/model/generateVideo`)
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'atlascloud/infinitetalk',
      image: FRAME,
      audio: 'https://x.public.blob.vercel-storage.com/video/job-atlas/speech-0.mp3',
      resolution: '720p',
    })
    const parked = state.updates.find(u => u['status'] === 'awaiting_provider')
    expect(parked?.['providerRequestIds']).toEqual({ clip: HANDLE })
    expect(logVideoCostMock).toHaveBeenCalledWith(expect.objectContaining({ feature: 'video-avatar', model: 'atlascloud/infinitetalk', seconds: 10 }))
    expectRunpodUntouched()
  })
})
