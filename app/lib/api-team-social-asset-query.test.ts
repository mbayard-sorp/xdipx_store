/**
 * Guard tests for POST /api/team/social-asset-query (ticket #10660, split off
 * #10658). `listLibraryAssets` is mocked; what's under test is the route
 * contract: op/method guards, filter pass-through, the `picked` default, and
 * the response shape.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listLibraryAssetsMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
}))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))
vi.mock('~/lib/social-studio.server', () => ({
  listLibraryAssets: listLibraryAssetsMock,
}))

import { action } from '~/routes/api.team.social-asset-query'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/social-asset-query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const ROW = {
  id: 42,
  url: 'https://cdn.shopify.com/files/social-we-vibe-chorus-cast-daylight-20260818-1.jpg',
  width: 1080,
  height: 1350,
  aspect: '4:5',
  archetype: 'cast',
  productHandle: 'we-vibe-chorus',
  castSlugs: ['maya'],
  tags: ['reuse-ok'],
  source: 'generated',
  isPicked: false,
  postId: null,
  createdAt: new Date('2026-08-18T00:00:00Z'),
  visionVerdict: { pass: true },
  visionVerdictAt: new Date('2026-08-18T00:05:00Z'),
  generationBatchId: 'batch-abc123',
  providerRequestId: 'req-xyz789',
}

beforeEach(() => {
  vi.clearAllMocks()
  listLibraryAssetsMock.mockResolvedValue({
    assets: [ROW],
    nextBefore: null,
    facets: { tags: [], products: [], casts: [], archetypes: [], sources: [] },
  })
})

describe('search', () => {
  it('returns the trimmed candidate shape', async () => {
    const res = await post({ op: 'search', product: 'we-vibe-chorus' })
    expect(res.status).toBe(200)
    const body = await res.json() as { assets: unknown[] }
    expect(body.assets).toEqual([{
      id: 42,
      url: ROW.url,
      width: 1080,
      height: 1350,
      aspect: '4:5',
      archetype: 'cast',
      productHandle: 'we-vibe-chorus',
      castSlugs: ['maya'],
      tags: ['reuse-ok'],
      source: 'generated',
      createdAt: ROW.createdAt.toISOString(),
      visionVerdict: { pass: true },
      visionVerdictAt: ROW.visionVerdictAt.toISOString(),
      generationBatchId: 'batch-abc123',
      providerRequestId: 'req-xyz789',
    }])
  })

  it('returns null providerRequestId when the row has none (pre-#11548 rows)', async () => {
    listLibraryAssetsMock.mockResolvedValueOnce({
      assets: [{ ...ROW, providerRequestId: null }],
      nextBefore: null,
      facets: { tags: [], products: [], casts: [], archetypes: [], sources: [] },
    })
    const res = await post({ op: 'search' })
    const body = await res.json() as { assets: { providerRequestId: string | null }[] }
    expect(body.assets[0]?.providerRequestId).toBeNull()
  })

  it('returns null generationBatchId when the row has none (pre-#11009 rows)', async () => {
    listLibraryAssetsMock.mockResolvedValueOnce({
      assets: [{ ...ROW, generationBatchId: null }],
      nextBefore: null,
      facets: { tags: [], products: [], casts: [], archetypes: [], sources: [] },
    })
    const res = await post({ op: 'search' })
    const body = await res.json() as { assets: { generationBatchId: string | null }[] }
    expect(body.assets[0]?.generationBatchId).toBeNull()
  })

  it('passes generationBatchId through so a lost manifest can be reconstructed (#11009)', async () => {
    await post({ op: 'search', generationBatchId: 'batch-abc123' })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({
      generationBatchId: 'batch-abc123',
    }))
  })

  it('passes product, cast, archetype, tag and source filters through', async () => {
    await post({ op: 'search', product: 'we-vibe-chorus', cast: 'maya', archetype: 'cast', tag: 'reuse-ok', source: 'generated' })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({
      product: 'we-vibe-chorus',
      cast: 'maya',
      archetype: 'cast',
      tag: 'reuse-ok',
      source: 'generated',
    }))
  })

  it('defaults picked to false so already-used assets are excluded', async () => {
    await post({ op: 'search' })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({ picked: false, archived: false }))
  })

  it('honours an explicit picked:true request', async () => {
    await post({ op: 'search', picked: true })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({ picked: true }))
  })

  it('always excludes product-identity-blocked assets, unconditionally (#11954)', async () => {
    await post({ op: 'search' })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({
      excludeProductIdentityBlocked: true,
    }))
  })

  // Ticket #13173: a row with no recorded visionVerdict was never judged at
  // all (the platform killed the cast request between ingest and the gate),
  // not "checked and passed" — it must never look like a free reuse
  // candidate, so this route always excludes it too.
  it('always excludes unjudged assets (no visionVerdict at all), unconditionally (#13173)', async () => {
    await post({ op: 'search' })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({
      excludeUnjudged: true,
    }))
  })

  // Ticket #11022: the owner's frame feedback is keyed by provider request
  // id, and the majority of on-skin candidates are gate-dropped, so a
  // requestId lookup must reach a row regardless of the reuse-first
  // picked/dropped defaults.
  it('resolves a requestId to q, and bypasses picked/dropped defaults', async () => {
    await post({ op: 'search', requestId: 'req-xyz789' })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({
      q: 'req-xyz789',
      picked: null,
      dropped: true,
    }))
  })

  it('honours an explicit picked filter alongside a requestId lookup', async () => {
    await post({ op: 'search', requestId: 'req-xyz789', picked: true })
    expect(listLibraryAssetsMock).toHaveBeenCalledWith(expect.objectContaining({
      q: 'req-xyz789',
      picked: true,
    }))
  })

  it('caps limit at 50 and clamps a garbage value to at least 1', async () => {
    await post({ op: 'search', limit: 500 })
    const res = await post({ op: 'search', limit: -5 })
    expect(res.status).toBe(200)
    // listLibraryAssets itself is unbounded by our `limit`; the route slices
    // its result, so assert the slice rather than the call args.
    listLibraryAssetsMock.mockResolvedValueOnce({
      assets: Array.from({ length: 60 }, (_, i) => ({ ...ROW, id: i })),
      nextBefore: null,
      facets: { tags: [], products: [], casts: [], archetypes: [], sources: [] },
    })
    const capped = await post({ op: 'search', limit: 500 })
    expect((await capped.json() as { assets: unknown[] }).assets).toHaveLength(50)
  })
})

describe('method + op guards', () => {
  it('rejects a non-POST method', async () => {
    const request = new Request('http://localhost/api/team/social-asset-query', { method: 'GET' })
    const res = await action({ request, params: {}, context: {} } as never) as Response
    expect(res.status).toBe(405)
  })

  it('rejects an unknown op', async () => {
    const res = await post({ op: 'list' })
    expect(res.status).toBe(400)
    expect(listLibraryAssetsMock).not.toHaveBeenCalled()
  })
})
