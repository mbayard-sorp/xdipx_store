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
const getBlockerByIdMock = vi.hoisted(() => vi.fn(async (_id: number) => null as unknown))
const countOpenBlockersMock = vi.hoisted(() => vi.fn(async () => 0))
const listOpenBlockersMock = vi.hoisted(() => vi.fn(async (_limit?: number) => [] as unknown[]))
const listRecentlyClearedMock = vi.hoisted(() => vi.fn(async (_days?: number) => [] as unknown[]))

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
    getBlockerById: getBlockerByIdMock,
    countOpenBlockers: countOpenBlockersMock,
    listOpenBlockers: listOpenBlockersMock,
    listRecentlyCleared: listRecentlyClearedMock,
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
  getBlockerByIdMock.mockClear()
  getBlockerByIdMock.mockResolvedValue(null)
  countOpenBlockersMock.mockClear()
  countOpenBlockersMock.mockResolvedValue(0)
  listOpenBlockersMock.mockClear()
  listOpenBlockersMock.mockResolvedValue([])
  listRecentlyClearedMock.mockClear()
  listRecentlyClearedMock.mockResolvedValue([])
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

/**
 * Ticket #19942. A routine told to check "is blocker N still open?" before
 * re-filing could not: {op:'get',id:649} 400'd as an unknown op, and
 * listOpenBlockers's 50-row cap meant row 51+ never appeared in a list
 * either. Both are fixed at the route layer here; the DB-level row shape is
 * covered in owner-blockers.server.ts's own suite.
 */
describe("op:'get' answers a specific id directly, in any status (#19942)", () => {
  it('400s with no id', async () => {
    const res = await post({ op: 'get' })
    expect(res.status).toBe(400)
    expect(getBlockerByIdMock).not.toHaveBeenCalled()
  })

  it('404s for an id that does not exist, rather than 400ing as an unknown op', async () => {
    const res = await post({ op: 'get', id: 649 })
    expect(res.status).toBe(404)
    expect(getBlockerByIdMock).toHaveBeenCalledWith(649)
  })

  it('200s with the row when found, regardless of its status', async () => {
    getBlockerByIdMock.mockResolvedValue({ id: 649, status: 'cleared', title: 'the /admin/socials screenshots' })
    const res = await post({ op: 'get', id: 649 })
    expect(res.status).toBe(200)
    const body = await res.json() as { blocker: { id: number; status: string } }
    expect(body.blocker.status).toBe('cleared')
  })
})

describe("op:'list' forwards a caller limit and reports totalOpen so truncation is visible (#19942)", () => {
  it('defaults to limit 50 and surfaces totalOpen alongside open', async () => {
    countOpenBlockersMock.mockResolvedValue(3)
    listOpenBlockersMock.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    const res = await post({ op: 'list' })
    expect(listOpenBlockersMock).toHaveBeenCalledWith(50)
    const body = await res.json() as { open: unknown[]; totalOpen: number }
    expect(body.open).toHaveLength(3)
    expect(body.totalOpen).toBe(3)
  })

  it('a 51st open row is reachable with a raised limit, and totalOpen says there is more behind a lower one', async () => {
    const fiftyOne = Array.from({ length: 51 }, (_, i) => ({ id: i + 1 }))
    countOpenBlockersMock.mockResolvedValue(51)
    listOpenBlockersMock.mockImplementation(async (limit = 50) => fiftyOne.slice(0, limit))

    const capped = await post({ op: 'list' })
    const cappedBody = await capped.json() as { open: unknown[]; totalOpen: number }
    expect(cappedBody.open).toHaveLength(50)
    expect(cappedBody.totalOpen).toBe(51) // truncation visible: totalOpen > open.length

    const raised = await post({ op: 'list', limit: 100 })
    expect(listOpenBlockersMock).toHaveBeenCalledWith(100)
    const raisedBody = await raised.json() as { open: unknown[]; totalOpen: number }
    expect(raisedBody.open).toHaveLength(51)
    expect(raisedBody.open[50]).toEqual({ id: 51 })
  })

  it('clamps an absurd limit rather than passing it straight to the query', async () => {
    await post({ op: 'list', limit: 999999 })
    expect(listOpenBlockersMock).toHaveBeenCalledWith(500)
  })

  it('forwards clearedDays to listRecentlyCleared only when includeCleared is set', async () => {
    await post({ op: 'list', includeCleared: true, clearedDays: 30 })
    expect(listRecentlyClearedMock).toHaveBeenCalledWith(30)

    listRecentlyClearedMock.mockClear()
    await post({ op: 'list' })
    expect(listRecentlyClearedMock).not.toHaveBeenCalled()
  })
})
