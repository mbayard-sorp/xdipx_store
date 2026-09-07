/**
 * Guard tests for POST /api/team/event, focused on the `finish` field added in
 * ticket #8027: an optional same-request run-finish riding the LAST retro
 * `record` call, so a session death between "post the retro events" and "call
 * /api/team/run separately to close it" can no longer leave a run that did
 * real, completed work sitting until the idle reaper marks it 'auto-expired'.
 *
 * team.server is mocked at import time; the real database is production.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  isTeamId: (t: unknown) => t === 'strategy' || t === 'video' || t === 'social',
  recordEvent: vi.fn(async () => {}),
  updateRun: vi.fn(async () => {}),
  listRecentEvents: vi.fn(async () => []),
}))

import { action } from '~/routes/api.team.event'
import { recordEvent, updateRun } from '~/lib/team.server'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('op:record without finish (unchanged behavior)', () => {
  it('records the event and never calls updateRun', async () => {
    const res = await post({ op: 'record', runId: 42, summary: 'did a thing' })
    expect(res.status).toBe(200)
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: 42, summary: 'did a thing' }))
    expect(updateRun).not.toHaveBeenCalled()
  })
})

describe('op:record with finish (#8027)', () => {
  it('records the event and finishes the run in the same request', async () => {
    const res = await post({
      op: 'record',
      runId: 666,
      summary: 'retro: episode 12 rendered, $0.42 spent',
      phase: 'retro',
      finish: { status: 'succeeded', summary: 'episode 12 rendered clean' },
    })
    expect(res.status).toBe(200)
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: 666, phase: 'retro' }))
    expect(updateRun).toHaveBeenCalledWith(666, {
      finished: true,
      status: 'succeeded',
      summary: 'episode 12 rendered clean',
    })
  })

  it('always sets finished:true even when finish carries no other field', async () => {
    await post({ op: 'record', runId: 7, summary: 'x', finish: {} })
    expect(updateRun).toHaveBeenCalledWith(7, { finished: true })
  })

  it('drops an unrecognized status rather than passing it through', async () => {
    await post({ op: 'record', runId: 7, summary: 'x', finish: { status: 'not-a-real-status' } })
    expect(updateRun).toHaveBeenCalledWith(7, { finished: true })
  })

  it('carries error and prUrl through when present', async () => {
    await post({
      op: 'record', runId: 7, summary: 'x',
      finish: { status: 'failed', error: 'RunPod pod stray', prUrl: 'https://github.com/x/y/pull/1' },
    })
    expect(updateRun).toHaveBeenCalledWith(7, {
      finished: true,
      status: 'failed',
      error: 'RunPod pod stray',
      prUrl: 'https://github.com/x/y/pull/1',
    })
  })

  it('ignores a non-object finish rather than throwing', async () => {
    const res = await post({ op: 'record', runId: 7, summary: 'x', finish: 'succeeded' })
    expect(res.status).toBe(200)
    expect(updateRun).not.toHaveBeenCalled()
  })
})

describe('unchanged behavior', () => {
  it('405s a non-POST method', async () => {
    const request = new Request('http://localhost/api/team/event', { method: 'GET' })
    const res = (await action({ request, params: {}, context: {} } as never)) as Response
    expect(res.status).toBe(405)
  })

  it('400s an unknown op', async () => {
    expect((await post({ op: 'frobnicate' })).status).toBe(400)
  })

  it('400s op:record without runId or summary', async () => {
    expect((await post({ op: 'record', summary: 'x' })).status).toBe(400)
    expect((await post({ op: 'record', runId: 1 })).status).toBe(400)
  })
})
