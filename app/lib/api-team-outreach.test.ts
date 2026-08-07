/**
 * Guard tests for POST /api/team/outreach, the outreach executor surface.
 *
 * The one invariant under test: a prospect's status can only move through the
 * 'queue' op and its eligibility guard. The upsert path must NEVER apply a
 * caller-supplied status to an existing row, because "upsert with
 * status:'queued'" would otherwise flip a replied_positive/rejected/landed
 * prospect straight back to queued and let a later send re-email a human who
 * already answered or was ruled out.
 *
 * db.server, team.server, and outreach.server are mocked at import time; the
 * real database is production and the send path talks to live SMTP.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Recorded writes, reset per test.
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
vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/outreach.server', () => ({ sendOutreachEmail: vi.fn() }))
const probeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/outreach-inbox.server', () => ({ probeOutreachImap: probeMock }))

// Lives in app/lib rather than next to the route: anything in app/routes is
// picked up by flatRoutes/typegen as a route module, tests included.
import { action } from '~/routes/api.team.outreach'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/outreach', {
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

describe('upsert-prospect on an existing row', () => {
  // The exploit this closes: an agent calling upsert-prospect with
  // status:'queued' on a prospect that already replied or was rejected,
  // bypassing the queue op's 409 guard, then sending to it.
  it('ignores a caller-supplied status entirely, so a replied/rejected/landed row cannot be re-queued', async () => {
    for (const _terminal of ['replied_positive', 'rejected', 'landed']) {
      state.selectResults = [[{ id: 5 }]]
      state.updates = []
      const res = await post({
        op: 'upsert-prospect',
        domain: 'example.com',
        status: 'queued',
        notes: 'trying to sneak back into the queue',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: 5, created: false })
      expect(state.updates).toHaveLength(1)
      const set = state.updates[0]!
      expect(set).not.toHaveProperty('status')
      expect(set['notes']).toBe('trying to sneak back into the queue')
      expect(set['updatedAt']).toBeInstanceOf(Date)
    }
  })

  it('still applies contact fields and notes on update', async () => {
    state.selectResults = [[{ id: 7 }]]
    await post({
      op: 'upsert-prospect',
      domain: 'example.com',
      contactEmail: 'editor@example.com',
      name: 'Example Mag',
    })
    const set = state.updates[0]!
    expect(set['contactEmail']).toBe('editor@example.com')
    expect(set['name']).toBe('Example Mag')
    expect(set).not.toHaveProperty('status')
  })
})

describe('upsert-prospect on a new row', () => {
  it('honors a valid status at CREATE', async () => {
    state.selectResults = [[]] // no existing row
    const res = await post({ op: 'upsert-prospect', domain: 'new.example.com', status: 'researching' })
    expect(await res.json()).toEqual({ id: 101, created: true })
    expect(state.inserts[0]!['status']).toBe('researching')
  })

  it('defaults status to new when absent', async () => {
    state.selectResults = [[]]
    await post({ op: 'upsert-prospect', domain: 'new.example.com' })
    expect(state.inserts[0]!['status']).toBe('new')
  })
})

describe('queue op eligibility guard', () => {
  it('409s for replied_positive, rejected, and landed, writing nothing', async () => {
    for (const status of ['replied_positive', 'rejected', 'landed', 'sent', 'replied_negative', 'bounced']) {
      state.selectResults = [[{ id: 3, status }]]
      state.updates = []
      const res = await post({ op: 'queue', id: 3 })
      expect(res.status).toBe(409)
      expect(state.updates).toHaveLength(0)
    }
  })

  it('queues an eligible prospect', async () => {
    for (const status of ['new', 'researching']) {
      state.selectResults = [[{ id: 4, status }]]
      state.updates = []
      const res = await post({ op: 'queue', id: 4 })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, id: 4 })
      expect(state.updates[0]!['status']).toBe('queued')
    }
  })

  it('404s for an unknown prospect', async () => {
    state.selectResults = [[]]
    const res = await post({ op: 'queue', id: 999 })
    expect(res.status).toBe(404)
  })
})

describe('probe op', () => {
  it('returns the probe result verbatim with status 200 on success', async () => {
    probeMock.mockResolvedValueOnce({
      ok: true,
      host: 'imap.zoho.com',
      port: 993,
      user: 'he***@xdipx.com',
      mailbox: 'INBOX',
      messages: 7,
    })
    const res = await post({ op: 'probe' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      host: 'imap.zoho.com',
      port: 993,
      user: 'he***@xdipx.com',
      mailbox: 'INBOX',
      messages: 7,
    })
  })

  it('still returns 200 on a probe failure; the ok field carries the verdict', async () => {
    probeMock.mockResolvedValueOnce({ ok: false, stage: 'auth', error: 'LOGIN rejected' })
    const res = await post({ op: 'probe' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, stage: 'auth', error: 'LOGIN rejected' })
  })
})
