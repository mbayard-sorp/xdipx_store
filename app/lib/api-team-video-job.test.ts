/**
 * Guard tests for POST /api/team/video-job's enqueue-set op and the new tier
 * validation. The pipeline itself is mocked; what's under test is the route
 * contract: field validation, the money gate, and exact pass-through to
 * enqueueVideoJobSet.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateMock = vi.hoisted(() => vi.fn())
const enqueueMock = vi.hoisted(() => vi.fn())
const enqueueSetMock = vi.hoisted(() => vi.fn())
const configMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: gateMock,
  getTeamConfig: configMock,
  getValve: vi.fn().mockResolvedValue(false),
  VALVE_KEYS: { videoAutopublish: 'video_team_autopublish' },
}))
vi.mock('~/lib/video-pipeline.server', () => ({
  enqueueVideoJob: enqueueMock,
  enqueueVideoJobSet: enqueueSetMock,
  listVideoJobs: vi.fn().mockResolvedValue([]),
  estimateJobCostUsd: vi.fn().mockReturnValue(1),
  findReusableSceneFrame: vi.fn().mockResolvedValue(null),
}))
vi.mock('~/lib/sanity.server', () => ({ getApprovedCastMembers: vi.fn().mockResolvedValue([]) }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
vi.mock('~/lib/db.server', () => ({ db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

import { action } from '~/routes/api.team.video-job'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/video-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const validSet = {
  op: 'enqueue-set',
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'none',
  modelTier: 'kling25-pro',
  baseScriptJson: { framePrompt: 'archetype B', motionPrompt: 'slow push', voiceover: '{{hook}} explained' },
  durationSeconds: 5,
  targetPlatforms: ['instagram'],
  hooks: ['Hook one', 'Hook two', 'Hook three'],
}

beforeEach(() => {
  vi.clearAllMocks()
  gateMock.mockResolvedValue({ ok: true })
  configMock.mockResolvedValue({ enabled: true, dailyCents: 2000, maxCostCents: 600, maxVariantsPerSet: 4 })
  enqueueSetMock.mockResolvedValue({
    variantGroupId: 'vg-1',
    totalEstCostUsd: 1.4,
    jobs: [{ jobId: 'j1', estCostUsd: 0.47, axes: { hook: 'Hook one' } }],
  })
  enqueueMock.mockResolvedValue({ jobId: 'j1', estCostUsd: 0.47 })
})

describe('enqueue-set', () => {
  it('passes validated fields through to enqueueVideoJobSet and returns its result', async () => {
    const res = await post(validSet)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ variantGroupId: 'vg-1' })
    expect(enqueueSetMock).toHaveBeenCalledWith(expect.objectContaining({
      productHandle: 'satin-wand',
      formula: 'myth-busting',
      modelTier: 'kling25-pro',
      durationSeconds: 5,
      hooks: ['Hook one', 'Hook two', 'Hook three'],
      targetPlatforms: ['instagram'],
    }))
  })

  it('rejects an empty hooks array', async () => {
    const res = await post({ ...validSet, hooks: [] })
    expect(res.status).toBe(400)
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('rejects malformed presenters entries', async () => {
    const res = await post({ ...validSet, presenters: ['emma', 'Robert; DROP'] })
    expect(res.status).toBe(400)
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('returns 403 with the gate payload when the money gate says no', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post(validSet)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'gated', reason: 'over_budget' })
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })
})

describe('lipsync tier validation', () => {
  it('rejects enqueue without presenterLine', async () => {
    const res = await post({
      op: 'enqueue',
      productHandle: 'satin-wand',
      formula: 'the-one-thing',
      presenter: 'emma',
      modelTier: 'sync-lipsync',
      scriptJson: { framePrompt: 'archetype C', motionPrompt: 'hold', talkingHead: true },
      durationSeconds: 5,
      targetPlatforms: ['instagram'],
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/presenterLine/)
  })

  it('rejects enqueue with presenter none', async () => {
    const res = await post({
      op: 'enqueue',
      productHandle: 'satin-wand',
      formula: 'the-one-thing',
      presenter: 'none',
      modelTier: 'sync-lipsync',
      scriptJson: { presenterLine: 'One thing matters.', framePrompt: 'C', motionPrompt: 'hold' },
      durationSeconds: 5,
      targetPlatforms: ['instagram'],
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/presenter/)
  })

  it('rejects enqueue without durationSeconds (lipsync line must fit a fixed clip)', async () => {
    const res = await post({
      op: 'enqueue',
      productHandle: 'satin-wand',
      formula: 'the-one-thing',
      presenter: 'emma',
      modelTier: 'sync-lipsync',
      scriptJson: { presenterLine: 'One thing matters.', framePrompt: 'C', motionPrompt: 'hold' },
      targetPlatforms: ['instagram'],
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/durationSeconds/)
  })
})

describe('config', () => {
  it('exposes tones, maxVariantsPerSet, and the sync-lipsync model', async () => {
    const res = await post({ op: 'config' })
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json['tones']).toEqual(['warm', 'playful', 'direct', 'hushed'])
    expect(json['maxVariantsPerSet']).toBe(4)
    expect(json['endcardEnabled']).toBe(false)
    const models = json['models'] as Record<string, { lipsync: boolean }>
    expect(models['sync-lipsync']).toBeTruthy()
    expect(models['sync-lipsync']!.lipsync).toBe(true)
  })
})
