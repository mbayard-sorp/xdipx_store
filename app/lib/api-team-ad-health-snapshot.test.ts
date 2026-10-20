/**
 * POST /api/team/ad-health-snapshot (ticket #16686). The snapshot store is an
 * in-memory fake, so no database is touched.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, nextId: 1, fail: false }))

vi.mock('~/lib/ads/health-snapshots.server', async () => {
  const core = await import('~/lib/ads/health-snapshots-core')
  return {
    recordSnapshot: vi.fn(async (input: Record<string, unknown>) => {
      if (h.fail) throw new Error('relation "ad_health_snapshots" does not exist')
      const at = (input['observedAt'] as Date).toISOString()
      const row = { id: h.nextId++, ...input, observedAt: at, createdAt: at }
      h.rows.push(row)
      return row
    }),
    latestSnapshots: vi.fn(async (channel: string | null) => {
      const rows = h.rows.filter(r => !channel || r['channel'] === channel) as never[]
      return { snapshots: core.latestPerKind(rows), breakdowns: core.latestPerDimension(rows) }
    }),
  }
})

import { action } from '~/routes/api.team.ad-health-snapshot'
import { assertTeamAuth } from '~/lib/team.server'

function post(body: unknown, method = 'POST') {
  return action({
    request: new Request('https://xdipx.com/api/team/ad-health-snapshot', {
      method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>
}

const NOW_ISO = new Date(Date.now() - 60_000).toISOString()

beforeEach(() => {
  h.rows = []
  h.nextId = 1
  h.fail = false
})

describe('POST /api/team/ad-health-snapshot', () => {
  it('checks the team token', async () => {
    await post({ op: 'latest' })
    expect(assertTeamAuth).toHaveBeenCalled()
  })

  it('records a snapshot and echoes it without the payload', async () => {
    const res = await post({
      op: 'record', channel: 'meta', kind: 'pixel', observedAt: NOW_ISO,
      payload: { events: [{ event: 'Lead', emq: 4.2, count24h: 1, count7d: 1 }] },
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; snapshot: Record<string, unknown> }
    expect(json.ok).toBe(true)
    expect(json.snapshot).toMatchObject({ id: 1, channel: 'meta', kind: 'pixel', source: 'routine', observedAt: NOW_ISO })
    expect(json.snapshot['payload']).toBeUndefined()
    expect(h.rows).toHaveLength(1)
  })

  it('returns the latest per kind and per breakdown dimension', async () => {
    await post({ op: 'record', channel: 'meta', kind: 'errors', observedAt: NOW_ISO, payload: { items: [] }, source: 'mcp' })
    await post({ op: 'record', channel: 'meta', kind: 'breakdown', observedAt: NOW_ISO, payload: { dimension: 'age', rows: [] } })
    await post({ op: 'record', channel: 'meta', kind: 'breakdown', observedAt: NOW_ISO, payload: { dimension: 'gender', rows: [] } })
    const res = await post({ op: 'latest', channel: 'meta' })
    const json = await res.json() as { ok: boolean; snapshots: Array<{ kind: string }>; breakdowns: Array<{ payload: { dimension: string } }> }
    expect(json.ok).toBe(true)
    expect(json.snapshots.map(s => s.kind)).toEqual(['breakdown', 'errors'])
    expect(json.breakdowns.map(b => b.payload.dimension)).toEqual(['age', 'gender'])
  })

  it.each([
    [{ op: 'delete' }, /op must be/],
    [{ op: 'record', channel: 'meta', kind: 'weather', observedAt: NOW_ISO, payload: {} }, /kind must be one of/],
    [{ op: 'record', channel: 'meta', kind: 'pixel', observedAt: 'soon', payload: {} }, /observedAt/],
    [{ op: 'record', channel: 'meta', kind: 'pixel', observedAt: NOW_ISO }, /payload/],
    [{ op: 'latest', channel: 'Not A Channel' }, /channel/],
  ])('400 on a bad body %#', async (body, msg) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(msg)
    expect(h.rows).toHaveLength(0)
  })

  it('405 on anything but POST', async () => {
    const res = await post(null, 'PUT')
    expect(res.status).toBe(405)
  })

  it('a store failure is a 500 through apiError', async () => {
    h.fail = true
    const res = await post({ op: 'record', channel: 'meta', kind: 'pixel', observedAt: NOW_ISO, payload: {} })
    expect(res.status).toBe(500)
  })
})
