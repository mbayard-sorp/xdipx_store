/**
 * Guard tests for POST /api/team/run, focused on the two read ops added in
 * ticket #3235: { op:'get', id } and { op:'list', team?, status?, sinceDays?,
 * limit? }. These exist so a cloud session can identify the specific run row
 * holding a team's concurrency lock — a run that GET /api/team/status hides the
 * moment a newer run starts, because that endpoint only returns the most-recent
 * run per team.
 *
 * db.server and team.server are mocked at import time; the real database is
 * production. The db mock records the arguments passed to the query builder so
 * we can assert the route filters and clamps at the DB layer, not just that it
 * echoes rows back.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  wheres: [] as unknown[],
  orderBys: [] as unknown[],
  limits: [] as unknown[],
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain['where'] = (cond: unknown) => {
      state.wheres.push(cond)
      return chain
    }
    chain['orderBy'] = (o: unknown) => {
      state.orderBys.push(o)
      return chain
    }
    chain['limit'] = (n: unknown) => {
      state.limits.push(n)
      return Promise.resolve(state.selectResults.shift() ?? [])
    }
    return chain
  }
  return { db: { select: () => ({ from: () => selectChain() }) } }
})

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  isTeamId: (t: unknown) =>
    t === 'strategy' || t === 'homepage' || t === 'content' || t === 'social' || t === 'product',
  startRun: vi.fn(async () => 1),
  updateRun: vi.fn(async () => {}),
}))

import { action, RUN_LIST_MAX } from '~/routes/api.team.run'
import { updateRun } from '~/lib/team.server'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  state.selectResults = []
  state.wheres = []
  state.orderBys = []
  state.limits = []
  vi.clearAllMocks()
})

describe('op:get', () => {
  it('returns the run row by id regardless of recency', async () => {
    const row = { id: 318, team: 'strategy', status: 'running' }
    state.selectResults = [[row]]
    const res = await post({ op: 'get', id: 318 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run: row })
    // by-id query is a single-row lookup, not a recency-bounded list.
    expect(state.wheres).toHaveLength(1)
    expect(state.limits).toEqual([1])
  })

  it('returns run:null when the id does not exist', async () => {
    state.selectResults = [[]]
    const res = await post({ op: 'get', id: 999999 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run: null })
  })

  it('400s when id is missing or not a number', async () => {
    expect((await post({ op: 'get' })).status).toBe(400)
    expect((await post({ op: 'get', id: '318' })).status).toBe(400)
  })
})

describe('op:list', () => {
  it('returns rows under runs, newest-first, with no filter when none given', async () => {
    const rows = [{ id: 3 }, { id: 2 }, { id: 1 }]
    state.selectResults = [rows]
    const res = await post({ op: 'list' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: rows })
    // no team/status/sinceDays => where called with undefined (no predicate).
    expect(state.wheres).toEqual([undefined])
    expect(state.orderBys).toHaveLength(1)
    expect(state.limits).toEqual([25])
  })

  it('applies a DB-level predicate when team+status are given', async () => {
    // This is the fix's point: status is filtered in the query, so an older
    // still-running run is found even when newer runs exist for the team.
    state.selectResults = [[{ id: 318, team: 'strategy', status: 'running' }]]
    const res = await post({ op: 'list', team: 'strategy', status: 'running' })
    expect(res.status).toBe(200)
    expect(state.wheres[0]).toBeDefined()
    expect(state.wheres[0]).not.toBeUndefined()
  })

  it('400s on an unknown team', async () => {
    const res = await post({ op: 'list', team: 'not-a-team' })
    expect(res.status).toBe(400)
    // rejected before any query ran.
    expect(state.limits).toHaveLength(0)
  })

  it('clamps limit to RUN_LIST_MAX', async () => {
    state.selectResults = [[]]
    await post({ op: 'list', limit: 99999 })
    expect(state.limits).toEqual([RUN_LIST_MAX])
  })

  it('floors limit to at least 1', async () => {
    state.selectResults = [[]]
    await post({ op: 'list', limit: 0 })
    expect(state.limits).toEqual([1])
  })
})

describe('unchanged behavior', () => {
  it('405s a non-POST method', async () => {
    const request = new Request('http://localhost/api/team/run', { method: 'GET' })
    const res = (await action({ request, params: {}, context: {} } as never)) as Response
    expect(res.status).toBe(405)
  })

  it('400s an unknown op', async () => {
    expect((await post({ op: 'frobnicate' })).status).toBe(400)
  })

  it('still starts a run on op:start', async () => {
    const res = await post({ op: 'start', team: 'strategy', runType: 'dev' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1 })
  })
})

// ticket #9336: `update` used to be cast straight into RunUpdate with no
// runtime check, letting a caller write a status string outside the type
// union (live rows show 'completed'/'success'/'done'/'finished') and letting
// a terminal status land with finished_at never stamped. parseRunUpdate
// closes both gaps the same way api.team.event.tsx's parseFinish already
// does for the `finish` payload (#8027).
describe('op:update status validation (#9336)', () => {
  it('accepts a valid terminal status and always stamps finished', async () => {
    const res = await post({ op: 'update', id: 42, update: { status: 'succeeded' } })
    expect(res.status).toBe(200)
    expect(updateRun).toHaveBeenCalledWith(42, { status: 'succeeded', finished: true })
  })

  it('rejects an out-of-enum status instead of passing it through', async () => {
    const res = await post({ op: 'update', id: 42, update: { status: 'completed' } })
    expect(res.status).toBe(400)
    expect(updateRun).not.toHaveBeenCalled()
  })

  it('does not force finished on a status:"running" update', async () => {
    const res = await post({ op: 'update', id: 42, update: { status: 'running' } })
    expect(res.status).toBe(200)
    expect(updateRun).toHaveBeenCalledWith(42, { status: 'running' })
  })

  it('still honors an explicit finished:true independent of status', async () => {
    await post({ op: 'update', id: 42, update: { finished: true } })
    expect(updateRun).toHaveBeenCalledWith(42, { finished: true })
  })

  it('passes through the other known fields unchanged', async () => {
    await post({
      op: 'update',
      id: 42,
      update: {
        status: 'failed',
        currentPhase: 'collect',
        currentAgent: 'rr7-engineer',
        summary: 'hit a snag',
        prUrl: 'https://github.com/x/y/pull/1',
        error: 'boom',
        incrementAttempt: true,
      },
    })
    expect(updateRun).toHaveBeenCalledWith(42, {
      status: 'failed',
      finished: true,
      currentPhase: 'collect',
      currentAgent: 'rr7-engineer',
      summary: 'hit a snag',
      prUrl: 'https://github.com/x/y/pull/1',
      error: 'boom',
      incrementAttempt: true,
    })
  })

  it('defaults to an empty update when `update` is absent', async () => {
    const res = await post({ op: 'update', id: 42 })
    expect(res.status).toBe(200)
    expect(updateRun).toHaveBeenCalledWith(42, {})
  })
})

describe('op:start phase stamp (#5431b)', () => {
  it('stamps a default currentPhase so the row is never created with phase NULL', async () => {
    await post({ op: 'start', team: 'social', runType: 'social' })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'run-start' })
  })

  it('honors a caller-supplied phase instead of the default', async () => {
    await post({ op: 'start', team: 'social', runType: 'social', phase: 'gate-check' })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'gate-check' })
  })

  it('stamps currentAgent too when the caller supplies one', async () => {
    await post({ op: 'start', team: 'social', runType: 'social', phase: 'gate-check', agent: 'social-media-manager' })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'gate-check', currentAgent: 'social-media-manager' })
  })

  it('falls back to the default phase on an oversized or non-string phase', async () => {
    await post({ op: 'start', team: 'social', runType: 'social', phase: 'x'.repeat(49) })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'run-start' })
  })
})
