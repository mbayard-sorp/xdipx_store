/**
 * Guard tests for POST /api/homepage-team/run op:'start' (#5604).
 *
 * The legacy dashboard run endpoint returned immediately after startRun()
 * without stamping current_phase, so a run started through it could auto-expire
 * with current_phase NULL -- the same "phase: unknown" log-monitor alert class
 * the twin api.team.run.tsx already fixed in #5431. This mirrors that fix and
 * its guard tests here.
 *
 * homepage-team.server is mocked at import time (the real one talks to the
 * production database). Lives in app/lib rather than next to the route:
 * anything under app/routes is picked up by flatRoutes/typegen as a route
 * module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/homepage-team.server', () => ({
  assertTeamAuth: vi.fn(),
  startRun: vi.fn(async () => 1),
  updateRun: vi.fn(async () => {}),
}))

import { action } from '~/routes/api.homepage-team.run'
import { updateRun } from '~/lib/homepage-team.server'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/homepage-team/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('op:start phase stamp (#5604)', () => {
  it('stamps a default currentPhase so the row is never created with phase NULL', async () => {
    const res = await post({ op: 'start', runType: 'merchandise' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1 })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'run-start' })
  })

  it('honors a caller-supplied phase instead of the default', async () => {
    await post({ op: 'start', runType: 'design', phase: 'gate-check' })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'gate-check' })
  })

  it('stamps currentAgent too when the caller supplies one', async () => {
    await post({ op: 'start', runType: 'manual', phase: 'gate-check', agent: 'homepage-orchestrator' })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'gate-check', currentAgent: 'homepage-orchestrator' })
  })

  it('falls back to the default phase on an oversized or non-string phase', async () => {
    await post({ op: 'start', runType: 'merchandise', phase: 'x'.repeat(49) })
    expect(updateRun).toHaveBeenCalledWith(1, { currentPhase: 'run-start' })
  })
})

describe('unchanged behavior', () => {
  it('still returns the new run id on op:start', async () => {
    const res = await post({ op: 'start' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1 })
  })

  it('405s a non-POST method', async () => {
    const request = new Request('http://localhost/api/homepage-team/run', { method: 'GET' })
    const res = (await action({ request, params: {}, context: {} } as never)) as Response
    expect(res.status).toBe(405)
  })

  it('400s an unknown op', async () => {
    expect((await post({ op: 'frobnicate' })).status).toBe(400)
  })
})
