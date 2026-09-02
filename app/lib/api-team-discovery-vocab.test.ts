/**
 * Guard tests for GET /api/team/discovery-vocab (ticket #5631). The index
 * fetch is mocked; what's under test is the route contract: auth, the
 * response shape, and the empty-index passthrough.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { describe, expect, it, vi } from 'vitest'

const getIndexMock = vi.hoisted(() => vi.fn())
const authMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: authMock,
}))
vi.mock('~/lib/discovery.server', () => ({
  getDiscoveryIndex: getIndexMock,
  computeVocabCounts: (index: unknown[]) =>
    index.length === 0 ? [] : [{ group: 'mood', tag: 'playful', productCount: index.length }],
}))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

import { loader } from '~/routes/api.team.discovery-vocab'

function get(): Promise<Response> {
  const request = new Request('http://localhost/api/team/discovery-vocab')
  return loader({ request, params: {}, context: {} } as never) as Promise<Response>
}

describe('GET /api/team/discovery-vocab', () => {
  it('checks team auth before anything else', async () => {
    getIndexMock.mockResolvedValueOnce([{}, {}])
    await get()
    expect(authMock).toHaveBeenCalledTimes(1)
  })

  it('returns per-tag counts and the index size', async () => {
    getIndexMock.mockResolvedValueOnce([{}, {}, {}])
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      counts: [{ group: 'mood', tag: 'playful', productCount: 3 }],
      indexSize: 3,
    })
  })

  it('returns an empty counts array on a cold cache miss rather than throwing', async () => {
    getIndexMock.mockResolvedValueOnce([])
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ counts: [], indexSize: 0 })
  })

  it('reports a lookup failure via apiError rather than a raw 500', async () => {
    getIndexMock.mockRejectedValueOnce(new Error('kv down'))
    const res = await get()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('kv down')
  })
})
