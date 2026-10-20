/**
 * Ticket #16430: the /admin/ads/actions loader and action.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 *
 * The actions-view functions are swapped for the real ones bound to an
 * in-memory store, so these tests cover the route wiring and the view
 * together without a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const getAdminUserMock = vi.hoisted(() => vi.fn(async () => ({ id: 'u1', neonAuthUserId: '', email: 'mike@xdipx.com', name: 'Mike', role: 'owner' })))
vi.mock('~/lib/session.server', () => ({ requireAdmin: requireAdminMock, getAdminUser: getAdminUserMock }))

const storeRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('~/lib/ads/actions-view.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/actions-view.server')>('~/lib/ads/actions-view.server')
  const store = () => storeRef.current as import('~/lib/ads/actions-view.server').ActionsViewStore
  return {
    ...actual,
    loadActions: (o: Parameters<typeof actual.loadActions>[0] = {}) => actual.loadActions({ ...o, store: store() }),
    approveAction: (id: number, email: string) => actual.approveAction(id, email, { store: store() }),
    rejectAction: (id: number, email: string, note?: string | null) => actual.rejectAction(id, email, note, { store: store() }),
  }
})

import { action, loader } from '~/routes/admin.ads.actions'
import type { ActionsViewStore } from '~/lib/ads/actions-view.server'
import type { AdActionRow } from '~/lib/ads/ledger.server'
import { assertLegalTransition, type AdActionStatus } from '~/lib/ads/ledger-core'

function row(id: number, status: AdActionStatus): AdActionRow {
  return {
    id, idempotencyKey: `k${id}`, platform: 'meta', targetLevel: 'ad', targetExternalId: `ad-${id}`,
    verb: 'resume', params: null, before: { status: 'PAUSED' }, after: { status: 'ACTIVE' },
    proposedBy: 'rule:R4', reason: 'Revive', ruleEventId: null, tier: 'approve', status,
    approvedBy: null, approvedAt: null, appliedAt: null, platformResponse: null, error: null,
    expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 19, 0, id)),
  }
}

function memory(rows: AdActionRow[]) {
  const ledger = new Map(rows.map(r => [r.id, r]))
  const store: ActionsViewStore = {
    list: async (statuses, limit) => [...ledger.values()].filter(r => statuses.includes(r.status)).sort((a, b) => b.id - a.id).slice(0, limit),
    counts: async () => {
      const out: Partial<Record<AdActionStatus, number>> = {}
      for (const r of ledger.values()) out[r.status] = (out[r.status] ?? 0) + 1
      return out
    },
    entities: async () => [],
    head: async id => { const r = ledger.get(id); return r ? { id, status: r.status, expiresAt: r.expiresAt } : null },
    transition: async (id, to, actor, extra = {}) => {
      const r = ledger.get(id)!
      assertLegalTransition(id, r.status, to)
      r.status = to
      r.approvedBy = actor
      if (extra.error !== undefined) r.error = extra.error
      return r
    },
  }
  return { store, ledger }
}

type LoaderArgs = Parameters<typeof loader>[0]
type ActionArgs = Parameters<typeof action>[0]

function get(url: string) {
  return loader({ request: new Request(url), params: {}, context: {} } as unknown as LoaderArgs)
}

function post(fields: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.set(k, v)
  const request = new Request('https://xdipx.com/admin/ads/actions', { method: 'POST', body })
  return action({ request, params: {}, context: {} } as unknown as ActionArgs)
}

describe('admin.ads.actions loader', () => {
  beforeEach(() => { requireAdminMock.mockClear() })

  it('guards with requireAdmin and defaults to the Pending tab', async () => {
    storeRef.current = memory([row(1, 'proposed'), row(2, 'dry_run')]).store
    const data = await get('https://xdipx.com/admin/ads/actions')
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
    expect(data.tab).toBe('pending')
    expect(data.rows.map(r => r.id)).toEqual([1])
    expect(data.counts).toEqual({ pending: 1, dry_run: 1, applied: 0, failed: 0 })
    expect(data.pendingCount).toBe(1)
  })

  it('reads the tab from the query string and ignores junk', async () => {
    storeRef.current = memory([row(1, 'proposed'), row(2, 'dry_run'), row(3, 'rejected')]).store
    expect((await get('https://xdipx.com/admin/ads/actions?tab=dry_run')).rows.map(r => r.id)).toEqual([2])
    expect((await get('https://xdipx.com/admin/ads/actions?tab=failed')).rows.map(r => r.status)).toEqual(['rejected'])
    expect((await get('https://xdipx.com/admin/ads/actions?tab=nope')).tab).toBe('pending')
  })

  it('returns an empty page when the ledger is empty', async () => {
    storeRef.current = memory([]).store
    const data = await get('https://xdipx.com/admin/ads/actions?tab=dry_run')
    expect(data.rows).toEqual([])
    expect(data.pendingCount).toBe(0)
  })
})

describe('admin.ads.actions action', () => {
  beforeEach(() => { requireAdminMock.mockClear(); getAdminUserMock.mockClear() })

  it('approves a proposed row as the signed-in admin', async () => {
    const m = memory([row(1, 'proposed')])
    storeRef.current = m.store
    expect(await post({ intent: 'approve', id: '1' })).toEqual({ ok: true, id: 1, status: 'approved' })
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
    expect(m.ledger.get(1)).toMatchObject({ status: 'approved', approvedBy: 'mike@xdipx.com' })
  })

  it('rejects with a note, then refuses to approve the rejected row', async () => {
    const m = memory([row(2, 'proposed')])
    storeRef.current = m.store
    expect(await post({ intent: 'reject', id: '2', note: 'wait a week' })).toEqual({ ok: true, id: 2, status: 'rejected' })
    expect(m.ledger.get(2)).toMatchObject({ status: 'rejected', approvedBy: 'mike@xdipx.com', error: 'Rejected: wait a week' })
    const again = await post({ intent: 'approve', id: '2' })
    expect(again).toMatchObject({ ok: false, code: 'rejected' })
    expect(m.ledger.get(2)!.status).toBe('rejected')
  })

  it('refuses a dry_run row and an unknown intent', async () => {
    const m = memory([row(3, 'dry_run')])
    storeRef.current = m.store
    expect(await post({ intent: 'approve', id: '3' })).toMatchObject({ ok: false, code: 'dry_run' })
    expect(await post({ intent: 'apply', id: '3' })).toMatchObject({ ok: false })
    expect(m.ledger.get(3)!.status).toBe('dry_run')
  })
})
