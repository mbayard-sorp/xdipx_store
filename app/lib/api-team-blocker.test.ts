/**
 * Route-level guard for POST /api/team/blocker's op:'file' pre-check added in
 * ticket #8028: a probe-required category (every BLOCKER_CATEGORIES value
 * except console/decision) with neither a real nor a derivable verifyProbe
 * nor an explicit overrideNoProbeReason is rejected with 400 before
 * fileBlocker is ever called, mirroring the existing CONFIRMED-title
 * pre-check in the same route.
 *
 * Mocks `~/lib/owner-blockers.server` entirely, sourcing the pure pieces
 * (BLOCKER_CATEGORIES, probeGapReason, suggestProbeFor) from
 * `~/lib/owner-blockers-core` -- which has no db.server import at all -- so
 * this suite never touches the real owner-blockers.server.ts module (and
 * therefore never its top-level `import { db } from '~/lib/db.server'`).
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))

const fileBlockerMock = vi.hoisted(() => vi.fn(async () => ({ id: 1, created: true, reopened: false })))

vi.mock('~/lib/owner-blockers.server', async () => {
  const core = await import('~/lib/owner-blockers-core')
  return {
    BLOCKER_CATEGORIES: core.BLOCKER_CATEGORIES,
    PROBES: {},
    probeGapReason: core.probeGapReason,
    suggestProbeFor: core.suggestProbeFor,
    titleClaimsConfirmed: core.titleClaimsConfirmed,
    fileBlocker: fileBlockerMock,
    clearBlocker: vi.fn(async () => true),
    dismissBlocker: vi.fn(async () => true),
    listOpenBlockers: vi.fn(async () => []),
    listRecentlyCleared: vi.fn(async () => []),
    verifyBlockers: vi.fn(async () => ({ checked: 0, autoCleared: 0, stillBlocked: 0, unknown: 0 })),
  }
})

import { action } from '~/routes/api.team.blocker'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/blocker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  fileBlockerMock.mockClear()
})

describe("op:'file' rejects a probe-required category with no probe and no override (#8028)", () => {
  it('400s for the default category (other) with neither verifyProbe nor override', async () => {
    const res = await post({ op: 'file', dedupeKey: 'x', title: 'y' })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/should carry a verifyProbe/i)
    expect(fileBlockerMock).not.toHaveBeenCalled()
  })

  it('400s for an explicit probe-required category too', async () => {
    const res = await post({ op: 'file', dedupeKey: 'x', title: 'y', category: 'valve' })
    expect(res.status).toBe(400)
    expect(fileBlockerMock).not.toHaveBeenCalled()
  })

  it('200s when overrideNoProbeReason is supplied', async () => {
    const res = await post({
      op: 'file', dedupeKey: 'x', title: 'y',
      overrideNoProbeReason: 'no automated check exists for this yet',
    })
    expect(res.status).toBe(200)
    expect(fileBlockerMock).toHaveBeenCalledWith(
      expect.objectContaining({ overrideNoProbeReason: 'no automated check exists for this yet' }),
    )
  })

  it('200s when verifyProbe is supplied for a required category', async () => {
    const res = await post({
      op: 'file', dedupeKey: 'x', title: 'y', category: 'valve', verifyProbe: 'setting_true',
    })
    expect(res.status).toBe(200)
    expect(fileBlockerMock).toHaveBeenCalled()
  })

  it('200s when a probe is derivable (merge category + PR sourceRef)', async () => {
    const res = await post({
      op: 'file', dedupeKey: 'x', title: 'y', category: 'merge',
      sourceRef: 'https://github.com/x/y/pull/42',
    })
    expect(res.status).toBe(200)
    expect(fileBlockerMock).toHaveBeenCalled()
  })

  it('200s for the console carve-out with no probe at all', async () => {
    const res = await post({ op: 'file', dedupeKey: 'x', title: 'y', category: 'console' })
    expect(res.status).toBe(200)
  })

  it('200s for the decision carve-out with no probe at all', async () => {
    const res = await post({ op: 'file', dedupeKey: 'x', title: 'y', category: 'decision' })
    expect(res.status).toBe(200)
  })
})
