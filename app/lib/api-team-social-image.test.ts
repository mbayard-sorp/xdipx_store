/**
 * Guard tests for POST /api/team/social-image (ticket #4133). The generation
 * functions are mocked; what's under test is the route contract: field
 * validation, the money gate, and exact pass-through to
 * generateAndUploadSocialImage / generateCastComposite.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateMock = vi.hoisted(() => vi.fn())
const genMock = vi.hoisted(() => vi.fn())
const castMock = vi.hoisted(() => vi.fn())
const logImageCostMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: gateMock,
}))
vi.mock('~/lib/social-media.server', () => ({
  // Real values: the route validates the archetype against this list.
  SOCIAL_ARCHETYPES: ['scene', 'cast', 'metaphor', 'macro', 'plate'],
  generateAndUploadSocialImage: genMock,
  generateCastComposite: castMock,
}))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))
vi.mock('~/lib/token-log.server', () => ({
  logImageCost: logImageCostMock,
}))

import { action } from '~/routes/api.team.social-image'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/social-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const validGenerate = {
  op: 'generate',
  prompt: 'nightstand still, warm daylight',
  handle: 'we-vibe-chorus',
  archetype: 'scene',
  mood: 'nightstand',
  date: '2026-08-18',
  imageSize: { width: 1080, height: 1350 },
  refImageUrl: 'https://cdn.shopify.com/files/real-packshot.jpg',
}

const validCast = {
  op: 'cast',
  prompt: 'held in hand, editorial',
  handle: 'we-vibe-chorus',
  mood: 'daylight',
  date: '2026-08-18',
  presenterImageUrl: 'https://cdn/presenter.jpg',
  productImageUrl: 'https://cdn/product.jpg',
  scale: 'palm',
}

beforeEach(() => {
  vi.clearAllMocks()
  logImageCostMock.mockResolvedValue(undefined)
  gateMock.mockResolvedValue({ ok: true })
  genMock.mockResolvedValue({
    url: 'https://cdn.shopify.com/files/social-we-vibe-chorus-scene-nightstand-20260818.jpg',
    filename: 'social-we-vibe-chorus-scene-nightstand-20260818.jpg',
    provider: 'fal',
    model: 'flux',
  })
  castMock.mockResolvedValue({
    urls: ['https://cdn.shopify.com/files/social-we-vibe-chorus-cast-daylight-20260818-1.jpg'],
    filenames: ['social-we-vibe-chorus-cast-daylight-20260818-1.jpg'],
    costs: [{ costKey: 'fal/flux-2-edit', count: 1 }],
    requestIds: ['req-1'],
  })
})

describe('generate', () => {
  it('passes validated fields through and returns the generation result', async () => {
    const res = await post(validGenerate)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ provider: 'fal' })
    expect(genMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'nightstand still, warm daylight',
      handle: 'we-vibe-chorus',
      archetype: 'scene',
      mood: 'nightstand',
      date: '2026-08-18',
      imageSize: { width: 1080, height: 1350 },
      refImageUrl: 'https://cdn.shopify.com/files/real-packshot.jpg',
    }))
    // The route owns the spend row now, not the CLI (#8032: a sandbox call
    // with no node_modules never reaches the CLI's own spend step, so this
    // route must log its own cost or a sandbox-originated run bills for free).
    expect(genMock.mock.calls[0]![0]).toHaveProperty('logCost', true)
  })

  it('rejects a missing prompt', async () => {
    const res = await post({ ...validGenerate, prompt: undefined })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown archetype', async () => {
    const res = await post({ ...validGenerate, archetype: 'billboard' })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed date', async () => {
    const res = await post({ ...validGenerate, date: '08/18/2026' })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('returns 403 with the gate payload when the money gate says no', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post(validGenerate)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'gated', reason: 'over_budget' })
    expect(genMock).not.toHaveBeenCalled()
  })
})

describe('generate spend', () => {
  it('does not log spend when the provider generated nothing (#8032)', async () => {
    genMock.mockResolvedValue({ url: null, filename: 'x.jpg', provider: 'none', model: 'none' })
    const res = await post(validGenerate)
    expect(res.status).toBe(200)
    // generateAndUploadSocialImage owns the "did it actually bill" decision
    // internally via logCost:true; the route itself never calls logImageCost
    // for the generate op, only for cast (see below).
    expect(logImageCostMock).not.toHaveBeenCalled()
  })
})

describe('cast', () => {
  it('passes references and scale through to generateCastComposite', async () => {
    const res = await post(validCast)
    expect(res.status).toBe(200)
    expect((await res.json() as { urls: string[] }).urls).toHaveLength(1)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://cdn/presenter.jpg',
      productImageUrl: 'https://cdn/product.jpg',
      scale: 'palm',
    }))
  })

  it('logs one spend row per surviving candidate (#8032)', async () => {
    const res = await post(validCast)
    expect(res.status).toBe(200)
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images',
      model: 'fal/flux-2-edit',
      count: 1,
      caller: 'social-media-manager',
      refId: 'social-we-vibe-chorus-cast-daylight-20260818-1.jpg',
      requestId: 'req-1',
    }))
  })

  it('logs a remainder row for a billed candidate dropped by rehost/vision-gate', async () => {
    castMock.mockResolvedValue({
      urls: ['https://cdn.shopify.com/files/only-survivor.jpg'],
      filenames: ['only-survivor.jpg'],
      costs: [{ costKey: 'fal/flux-2-edit', count: 2 }],
      requestIds: ['req-1'],
    })
    await post(validCast)
    // One row for the surviving candidate, one remainder row for the billed
    // candidate that got dropped (framesBilled 2 - urls.length 1 = 1).
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images', model: 'fal/flux-2-edit', count: 1, refId: 'only-survivor.jpg',
    }))
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images', model: 'fal/flux-2-edit', count: 1,
    }))
    expect(logImageCostMock).not.toHaveBeenCalledWith(expect.objectContaining({ refId: expect.anything(), count: 2 }))
    expect(logImageCostMock).toHaveBeenCalledTimes(2)
  })

  it('logs the stage-1 plate cost when the composite built one', async () => {
    castMock.mockResolvedValue({
      urls: ['https://cdn.shopify.com/files/frame.jpg'],
      filenames: ['frame.jpg'],
      costs: [{ costKey: 'fal/flux-2-edit', count: 1 }, { costKey: 'qwen/plate', count: 1 }],
      requestIds: ['req-1'],
      plateRequestId: 'req-plate-1',
    })
    await post(validCast)
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images', model: 'qwen/plate', count: 1, requestId: 'req-plate-1',
    }))
  })

  it('rejects a cast op without a presenter reference', async () => {
    const res = await post({ ...validCast, presenterImageUrl: undefined })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
  })
})

describe('method + op guards', () => {
  it('rejects a non-POST method', async () => {
    const request = new Request('http://localhost/api/team/social-image', { method: 'GET' })
    const res = await action({ request, params: {}, context: {} } as never) as Response
    expect(res.status).toBe(405)
  })

  it('rejects an unknown op', async () => {
    const res = await post({ ...validGenerate, op: 'delete' })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
    expect(castMock).not.toHaveBeenCalled()
  })
})
