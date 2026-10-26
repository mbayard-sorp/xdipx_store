/**
 * Ticket #17788: POST /api/team/seo-cluster-merge runs an approved SEO
 * cluster merge map server-side so no agent session needs direct rights to
 * execute scripts/merge-seo-clusters.ts. Covers auth, the valve gate, body
 * validation, and that `apply` is only ever true when explicitly requested.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assertTeamAuth: vi.fn(),
  getPipelineSetting: vi.fn(async (_key: string) => 'true'),
  applySeoClusterMergeMap: vi.fn(async (_map: unknown, opts: { apply: boolean }) => ({
    applied: opts.apply,
    entries: [],
    totals: { keywordRefsRepointed: 0, clustersArchived: 0 },
  })),
}))
const assertTeamAuth = h.assertTeamAuth
const getPipelineSetting = h.getPipelineSetting
const applySeoClusterMergeMap = h.applySeoClusterMergeMap

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: h.assertTeamAuth }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: h.getPipelineSetting }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ ok: false, error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))
vi.mock('~/lib/seo-cluster-merge.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/seo-cluster-merge.server')>('~/lib/seo-cluster-merge.server')
  return {
    isSeoClusterMergeMap: actual.isSeoClusterMergeMap,
    applySeoClusterMergeMap: h.applySeoClusterMergeMap,
  }
})

import { action } from '~/routes/api.team.seo-cluster-merge'

function post(body: unknown): Request {
  return new Request('https://xdipx.com/api/team/seo-cluster-merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  assertTeamAuth.mockClear()
  getPipelineSetting.mockClear().mockResolvedValue('true')
  applySeoClusterMergeMap.mockClear()
})

describe('action', () => {
  it('checks team auth before anything else', async () => {
    await action({ request: post({ map: [{ canonical: 'a', absorb: ['b'] }] }) } as never)
    expect(assertTeamAuth).toHaveBeenCalledTimes(1)
  })

  it('403s when seo_curation_enabled is off', async () => {
    getPipelineSetting.mockResolvedValue('false')
    const res = await action({ request: post({ map: [{ canonical: 'a', absorb: ['b'] }] }) } as never)
    expect((res as Response).status).toBe(403)
    expect(applySeoClusterMergeMap).not.toHaveBeenCalled()
  })

  it('400s on a malformed body instead of calling the executor', async () => {
    const res = await action({ request: post({ map: [{ canonical: 'a' }] }) } as never)
    expect((res as Response).status).toBe(400)
    expect(applySeoClusterMergeMap).not.toHaveBeenCalled()
  })

  it('400s on an empty map', async () => {
    const res = await action({ request: post({ map: [] }) } as never)
    expect((res as Response).status).toBe(400)
  })

  it('400s on invalid JSON', async () => {
    const req = new Request('https://xdipx.com/api/team/seo-cluster-merge', { method: 'POST', body: 'not json' })
    const res = await action({ request: req } as never)
    expect((res as Response).status).toBe(400)
  })

  it('defaults apply to false (dry run) when omitted', async () => {
    const res = await action({ request: post({ map: [{ canonical: 'a', absorb: ['b'] }] }) } as never)
    const json = await (res as Response).json()
    expect(applySeoClusterMergeMap).toHaveBeenCalledWith([{ canonical: 'a', absorb: ['b'] }], { apply: false })
    expect(json.ok).toBe(true)
    expect(json.result.applied).toBe(false)
  })

  it('passes apply:true only when the body explicitly asks for it', async () => {
    await action({ request: post({ map: [{ canonical: 'a', absorb: ['b'] }], apply: true }) } as never)
    expect(applySeoClusterMergeMap).toHaveBeenCalledWith([{ canonical: 'a', absorb: ['b'] }], { apply: true })
  })

  it('does not treat a truthy non-boolean apply value as true', async () => {
    await action({ request: post({ map: [{ canonical: 'a', absorb: ['b'] }], apply: 'yes' }) } as never)
    expect(applySeoClusterMergeMap).toHaveBeenCalledWith([{ canonical: 'a', absorb: ['b'] }], { apply: false })
  })

  it('returns a 500-shaped error response if the executor throws', async () => {
    applySeoClusterMergeMap.mockRejectedValueOnce(new Error('Sanity not configured'))
    const res = await action({ request: post({ map: [{ canonical: 'a', absorb: ['b'] }] }) } as never)
    expect((res as Response).status).toBe(500)
  })
})
