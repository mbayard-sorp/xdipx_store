/**
 * Guard tests for POST /api/team/calendar's 'setStatus' op.
 *
 * Two invariants under test. (1) A team-token setStatus call may only change the
 * status of a row whose name starts with 'IG: '. Any other row — a homepage
 * promo, a holiday, anything the social routine has no business touching — must
 * be refused with 403 and left un-written. The guard lives both in a pre-check
 * and in the LIKE on the UPDATE's WHERE clause; these tests assert the observable
 * behaviour (no write) rather than the internal query shape. (2) The status change
 * must be a legal edge of the calendar state machine (planned->active|skipped,
 * active->done); anything else is a 409 with no write (ticket #3030).
 *
 * db.server and team.server are mocked at import time; the real database is
 * production.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain['where'] = () => chain
    chain['orderBy'] = () => chain
    chain['limit'] = () => Promise.resolve(state.selectResults.shift() ?? [])
    return chain
  }
  return {
    db: {
      select: () => ({ from: () => selectChain() }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            state.updates.push(set)
            return Promise.resolve()
          },
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            state.inserts.push(v)
            return Promise.resolve([{ id: 101 }])
          },
        }),
      }),
    },
  }
})
vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  listCalendar: vi.fn(),
  proposeCalendarEvent: vi.fn(),
}))

// Lives in app/lib rather than next to the route: anything in app/routes is
// picked up by flatRoutes/typegen as a route module, tests included.
import { action } from '~/routes/api.team.calendar'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/calendar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  state.selectResults = []
  state.updates = []
  state.inserts = []
})

describe('setStatus IG guard', () => {
  it('walks every legal transition of an IG-prefixed row (ticket #3030)', async () => {
    const legal: Array<[string, string]> = [
      ['planned', 'active'],
      ['planned', 'skipped'],
      ['active', 'done'],
    ]
    for (const [from, to] of legal) {
      state.selectResults = [[{ id: 22, name: 'IG: The Vibrator Field Guide', status: from }]]
      state.updates = []
      const res = await post({ op: 'setStatus', id: 22, status: to })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, id: 22, status: to })
      expect(state.updates).toHaveLength(1)
      expect(state.updates[0]!['status']).toBe(to)
      expect(state.updates[0]!['updatedAt']).toBeInstanceOf(Date)
    }
  })

  it('refuses an illegal transition with 409 and writes nothing (ticket #3030)', async () => {
    // Reopen a finished campaign, revive a skipped one, skip a state, walk
    // backwards, and the same-status no-op — none is a declared edge.
    const illegal: Array<[string, string]> = [
      ['done', 'planned'],
      ['done', 'active'],
      ['skipped', 'active'],
      ['planned', 'done'],
      ['active', 'planned'],
      ['active', 'active'],
    ]
    for (const [from, to] of illegal) {
      state.selectResults = [[{ id: 22, name: 'IG: The Vibrator Field Guide', status: from }]]
      state.updates = []
      const res = await post({ op: 'setStatus', id: 22, status: to })
      expect(res.status).toBe(409)
      expect(state.updates).toHaveLength(0)
    }
  })

  it('refuses a non-IG row with 403 and writes nothing', async () => {
    for (const name of ['August Reset', 'Valentine\'s Day', 'Spring refresh', 'IG:no-space']) {
      state.selectResults = [[{ id: 5, name, status: 'planned' }]]
      state.updates = []
      const res = await post({ op: 'setStatus', id: 5, status: 'active' })
      expect(res.status).toBe(403)
      expect(state.updates).toHaveLength(0)
    }
  })

  it('404s for an unknown row, writing nothing', async () => {
    state.selectResults = [[]]
    const res = await post({ op: 'setStatus', id: 999, status: 'active' })
    expect(res.status).toBe(404)
    expect(state.updates).toHaveLength(0)
  })

  it('400s for an invalid status, without touching the database', async () => {
    const res = await post({ op: 'setStatus', id: 22, status: 'archived' })
    expect(res.status).toBe(400)
    expect(state.selectResults).toHaveLength(0) // never consumed a select
    expect(state.updates).toHaveLength(0)
  })

  it('400s for a non-positive or non-integer id', async () => {
    for (const id of [0, -1, 1.5, 'abc']) {
      const res = await post({ op: 'setStatus', id, status: 'active' })
      expect(res.status).toBe(400)
    }
    expect(state.updates).toHaveLength(0)
  })
})
