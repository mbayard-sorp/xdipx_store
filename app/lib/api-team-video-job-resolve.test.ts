/**
 * POST /api/team/video-job provider request id ops (ticket #11552): the
 * 'resolve' op's shape and not-found case, and providerRequestIds on
 * list/get with the re-host bookkeeping key removed. The route and the real
 * lookup module run; db and the pipeline are mocked.
 *
 * Lives in app/lib: anything in app/routes is picked up as a route module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue = vi.hoisted(() => ({ results: [] as unknown[][] }))
vi.mock('~/lib/db.server', () => {
  const chain = () => {
    const c: Record<string, unknown> = {
      then: (res: (v: unknown[]) => void, rej?: (e: unknown) => void) =>
        Promise.resolve(selectQueue.results.shift() ?? []).then(res, rej),
    }
    c['where'] = () => c
    c['limit'] = () => c
    c['orderBy'] = () => c
    return c
  }
  return { db: { select: () => ({ from: () => chain() }) } }
})
vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: vi.fn(),
  getTeamConfig: vi.fn(),
  getValve: vi.fn().mockResolvedValue(false),
  VALVE_KEYS: { videoAutopublish: 'video_team_autopublish' },
}))
const listMock = vi.hoisted(() => vi.fn())
const withoutRehostMock = vi.hoisted(() => vi.fn((h: Record<string, unknown>) => {
  const copy = { ...h }
  delete copy['download_attempts']
  return copy
}))
vi.mock('~/lib/video-pipeline.server', () => ({
  enqueueVideoJob: vi.fn(),
  enqueueVideoJobSet: vi.fn(),
  listVideoJobs: listMock,
  estimateJobCostUsd: vi.fn(),
  findReusableSceneFrame: vi.fn(),
  isMultiSceneScript: () => false,
  PRESENTER_RE: /^(none|emma|friend:[a-z0-9-]+)$/,
  withoutRehostAttempts: withoutRehostMock,
}))
vi.mock('~/lib/sanity.server', () => ({ getApprovedCastMembers: vi.fn().mockResolvedValue([]), presenterPhotoUrlForCrop: vi.fn() }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
vi.mock('~/lib/shopify.server', () => ({ getProductStockCheck: vi.fn() }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_s: string, err: unknown) => new Response(String(err), { status: 500 }),
}))
vi.mock('~/lib/video-episodes.server', () => ({ assertEpisodeMatchesScript: vi.fn(), linkEpisodeToJob: vi.fn() }))

import { action } from '~/routes/api.team.video-job'

const RID = '79378e06c97e4a88a0fb433c29a9d9a2'
const ATLAS_URL = `https://api.atlascloud.ai/api/v1/model/prediction/${RID}`
const HANDLE = { requestId: RID, statusUrl: ATLAS_URL, responseUrl: ATLAS_URL }

const call = (body: unknown) => action({
  request: new Request('http://x/api/team/video-job', { method: 'POST', body: JSON.stringify(body) }),
  params: {},
  context: {},
} as never) as Promise<Response>

const job = (over: Record<string, unknown> = {}) => ({
  id: 42, jobId: 'job-42', productHandle: 'le-wand', formula: 'myth-busting', presenter: 'emma',
  modelTier: 'wan27-atlas', stage: 'done', status: 'done', costUsd: '1.20',
  providerRequestIds: { clip: HANDLE, download_attempts: 2 },
  scriptJson: {}, scenesJson: null, sceneStateJson: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.results = []
})

describe("op 'resolve'", () => {
  it('maps a request id to job, episode, stage, tier and the matching assets', async () => {
    const created = new Date('2026-09-20T00:00:00Z')
    selectQueue.results = [
      [job()],                                        // jobs by handle (GIN jsonpath)
      [{ videoJobId: 42, purpose: 'clip' }],          // media_assets by provider_request_id
      [{ id: 7, videoJobId: 42 }],                    // video_episodes
      [
        { id: 900, purpose: 'clip', blobUrl: 'https://b/clip.mp4', sourceModel: 'atlascloud/wan-2.7-i2v', providerRequestId: RID, createdAt: created, videoJobId: 42 },
        { id: 901, purpose: 'poster', blobUrl: 'https://b/poster.jpg', sourceModel: null, providerRequestId: null, createdAt: created, videoJobId: 42 },
      ],
    ]
    const res = await call({ op: 'resolve', providerRequestId: RID })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      found: true,
      providerRequestId: RID,
      matches: [{
        jobRowId: 42,
        jobId: 'job-42',
        episodeId: 7,
        stage: 'clip',
        jobStage: 'done',
        status: 'done',
        tier: 'wan27-atlas',
        provider: 'atlas',
        assets: [{ id: 900, purpose: 'clip', blobUrl: 'https://b/clip.mp4', sourceModel: 'atlascloud/wan-2.7-i2v', providerRequestId: RID, createdAt: created.toISOString() }],
      }],
    })
  })

  it('resolves a scene frame id that only lives on the asset row', async () => {
    selectQueue.results = [
      [],                                                   // no job handle carries it
      [{ videoJobId: 42, purpose: 'scene_frame' }],
      [job({ providerRequestIds: {} })],                    // job fetched by asset link
      [],                                                   // no episode
      [{ id: 12, purpose: 'scene_frame', blobUrl: 'https://b/f.jpg', sourceModel: 'fal-ai/x', providerRequestId: 'framereq1', createdAt: new Date(), videoJobId: 42 }],
    ]
    const body = await (await call({ op: 'resolve', providerRequestId: 'framereq1' })).json()
    expect(body.matches[0]).toMatchObject({ jobId: 'job-42', episodeId: null, stage: 'scene_frame', assets: [{ id: 12 }] })
  })

  it('returns 404 found:false when nothing matches', async () => {
    selectQueue.results = [[], []]
    const res = await call({ op: 'resolve', providerRequestId: 'deadbeef00' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ found: false, providerRequestId: 'deadbeef00', matches: [] })
  })

  it('refuses a missing or malformed id with 400 before any query', async () => {
    expect((await call({ op: 'resolve' })).status).toBe(400)
    expect((await call({ op: 'resolve', providerRequestId: 'x"; drop' })).status).toBe(400)
  })
})

describe("providerRequestIds on 'list' and 'get'", () => {
  const row = { job: job(), frames: [], finalUrl: null, posterUrl: null }

  it('list exposes the handles without the re-host bookkeeping key', async () => {
    listMock.mockResolvedValue([row])
    selectQueue.results = [[]] // social_posts fan-out
    const body = await (await call({ op: 'list' })).json()
    expect(withoutRehostMock).toHaveBeenCalled()
    expect(body.jobs[0].providerRequestIds).toEqual({ clip: HANDLE })
  })

  it('get returns one job with the same field, and 404s an unknown id', async () => {
    listMock.mockResolvedValueOnce([row])
    selectQueue.results = [[]]
    const body = await (await call({ op: 'get', jobId: 'job-42' })).json()
    expect(listMock).toHaveBeenCalledWith(1, { jobId: 'job-42' })
    expect(body.job.providerRequestIds).toEqual({ clip: HANDLE })

    listMock.mockResolvedValueOnce([])
    expect((await call({ op: 'get', jobId: 'nope' })).status).toBe(404)
  })
})
