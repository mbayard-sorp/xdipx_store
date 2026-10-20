import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  approveAction, describeTarget, describeValue, loadActions, parseTab, rejectAction,
  type ActionsViewStore, type MirrorEntity,
} from './actions-view.server'
import { IllegalAdActionTransitionError, assertLegalTransition, type AdActionStatus } from './ledger-core'
import type { AdActionRow } from './ledger.server'
import type { TransitionExtra } from './ledger.server'

const NOW = new Date('2026-10-19T12:00:00Z')

let nextId = 1
function row(over: Partial<AdActionRow> = {}): AdActionRow {
  const id = over.id ?? nextId++
  return {
    id,
    idempotencyKey: `k${id}`,
    platform: 'meta',
    targetLevel: 'ad',
    targetExternalId: 'ad-1',
    verb: 'pause',
    params: null,
    before: { status: 'ACTIVE' },
    after: { status: 'PAUSED' },
    proposedBy: 'rule:R1',
    reason: 'Pause: $35.00 spent in 7d, 0 orders, R1',
    ruleEventId: null,
    tier: 'auto',
    status: 'proposed',
    approvedBy: null,
    approvedAt: null,
    appliedAt: null,
    platformResponse: null,
    error: null,
    expiresAt: null,
    createdAt: new Date(NOW.getTime() - id * 60_000),
    ...over,
  }
}

const MIRROR: MirrorEntity[] = [
  { platform: 'meta', level: 'campaign', externalId: 'c-1', parentExternalId: null, name: 'Leads | Curious', creativeId: null },
  { platform: 'meta', level: 'adset', externalId: 'as-1', parentExternalId: 'c-1', name: 'Broad 25-54', creativeId: null },
  { platform: 'meta', level: 'ad', externalId: 'ad-1', parentExternalId: 'as-1', name: 'img07', creativeId: 412 },
  { platform: 'meta', level: 'ad', externalId: 'ad-2', parentExternalId: 'as-1', name: null, creativeId: null },
]

/** In-memory ledger plus mirror. transition enforces the real status machine. */
function memoryStore(rows: AdActionRow[], mirror: MirrorEntity[] = MIRROR) {
  const ledger = new Map(rows.map(r => [r.id, { ...r }]))
  const entityCalls: string[][] = []
  const store: ActionsViewStore = {
    async list(statuses, limit) {
      return [...ledger.values()]
        .filter(r => statuses.includes(r.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .slice(0, limit)
    },
    async counts() {
      const out: Partial<Record<AdActionStatus, number>> = {}
      for (const r of ledger.values()) out[r.status] = (out[r.status] ?? 0) + 1
      return out
    },
    async entities(ids) {
      entityCalls.push([...ids])
      return mirror.filter(e => ids.includes(e.externalId))
    },
    async head(id) {
      const r = ledger.get(id)
      return r ? { id: r.id, status: r.status, expiresAt: r.expiresAt } : null
    },
    async transition(id, to, actor, extra: TransitionExtra = {}) {
      const r = ledger.get(id)
      if (!r) throw new IllegalAdActionTransitionError(id, null, to)
      assertLegalTransition(id, r.status, to)
      r.status = to
      if (to === 'approved' || to === 'rejected') { r.approvedBy = actor; r.approvedAt = NOW }
      if (extra.error !== undefined) r.error = extra.error
      return { ...r }
    },
  }
  return { store, ledger, entityCalls }
}

describe('parseTab', () => {
  it('defaults to pending and accepts the four tabs', () => {
    expect(parseTab(null)).toBe('pending')
    expect(parseTab('bogus')).toBe('pending')
    expect(parseTab('dry_run')).toBe('dry_run')
    expect(parseTab('failed')).toBe('failed')
  })
})

describe('loadActions', () => {
  const rows = [
    row({ id: 1, status: 'proposed', tier: 'approve', verb: 'set_budget', targetLevel: 'adset', targetExternalId: 'as-1', before: { dailyBudgetCents: 1000 }, after: { dailyBudgetCents: 1200 }, proposedBy: 'rule:R5' }),
    row({ id: 2, status: 'dry_run' }),
    row({ id: 3, status: 'applied', appliedAt: NOW, platformResponse: { success: true } }),
    row({ id: 4, status: 'approved', approvedBy: 'mike@xdipx.com', approvedAt: NOW }),
    row({ id: 5, status: 'failed', error: 'Meta said (#100) invalid parameter' }),
    row({ id: 6, status: 'rejected', approvedBy: 'mike@xdipx.com', approvedAt: NOW }),
    row({ id: 7, status: 'expired' }),
    row({ id: 8, status: 'proposed', proposedBy: 'agent:paid-media-buyer', targetExternalId: 'ad-404' }),
  ]

  it('filters each tab to its statuses, newest first, with counts for every tab', async () => {
    const { store } = memoryStore(rows)
    const pending = await loadActions({ tab: 'pending', store, now: NOW })
    expect(pending.rows.map(r => r.id)).toEqual([1, 8])
    expect(pending.counts).toEqual({ pending: 2, dry_run: 1, applied: 2, failed: 3 })
    expect(pending.pendingCount).toBe(2)

    expect((await loadActions({ tab: 'dry_run', store, now: NOW })).rows.map(r => r.id)).toEqual([2])
    expect((await loadActions({ tab: 'applied', store, now: NOW })).rows.map(r => r.id)).toEqual([3, 4])
    const failed = await loadActions({ tab: 'failed', store, now: NOW })
    expect(failed.rows.map(r => [r.id, r.statusLabel])).toEqual([[5, 'Failed'], [6, 'Rejected'], [7, 'Expired']])
    expect(failed.rows[0]!.outcome).toBe('Meta said (#100) invalid parameter')
  })

  it('names the target through the mirror and carries the creative id for an ad', async () => {
    const { store, entityCalls } = memoryStore([row({ id: 20, targetExternalId: 'ad-1' }), row({ id: 21, targetLevel: 'adset', targetExternalId: 'as-1' })])
    const page = await loadActions({ store, now: NOW })
    const ad = page.rows.find(r => r.id === 20)!
    expect(ad.target.label).toBe('Leads | Curious > Broad 25-54 > img07')
    expect(ad.creativeId).toBe(412)
    const adset = page.rows.find(r => r.id === 21)!
    expect(adset.target.label).toBe('Leads | Curious > Broad 25-54')
    expect(adset.creativeId).toBeNull()
    // Target, then ad set, then campaign: three hops at most, nothing asked twice.
    expect(entityCalls.flat().sort()).toEqual(['ad-1', 'as-1', 'c-1'])
  })

  it('falls back to the external id when a name or the whole entity is missing', async () => {
    const { store } = memoryStore([row({ id: 30, targetExternalId: 'ad-2' }), row({ id: 31, targetExternalId: 'ad-404' })])
    const page = await loadActions({ store, now: NOW })
    expect(page.rows.find(r => r.id === 30)!.target.label).toBe('Leads | Curious > Broad 25-54 > ad-2')
    const missing = page.rows.find(r => r.id === 31)!
    expect(missing.target).toMatchObject({ label: 'ad ad-404', inMirror: false })
  })

  it('shows proposer, reason, tier and readable before and after', async () => {
    const { store } = memoryStore([rows[0]!])
    const [r] = (await loadActions({ store, now: NOW })).rows
    expect(r).toMatchObject({
      proposedBy: 'rule:R5', tier: 'approve', tierLabel: 'B: one tap', verbLabel: 'Set budget',
      before: '$10.00 a day', after: '$12.00 a day', decidable: true, lockedReason: null,
    })
  })

  it('marks dry-run, rejected and past-expiry rows as not decidable', async () => {
    const { store } = memoryStore([
      row({ id: 40, status: 'proposed', expiresAt: new Date(NOW.getTime() - 1) }),
    ])
    const [expired] = (await loadActions({ store, now: NOW })).rows
    expect(expired!.decidable).toBe(false)
    expect(expired!.lockedReason).toMatch(/expiry/)
  })
})

describe('describeValue and describeTarget', () => {
  it('formats budgets, statuses and anything else', () => {
    expect(describeValue({ lifetimeBudgetCents: 50000 })).toBe('$500.00 lifetime')
    expect(describeValue({ status: 'PAUSED' })).toBe('PAUSED')
    expect(describeValue({ budgetMultiplier: 1.2 })).toBe('{"budgetMultiplier":1.2}')
    expect(describeValue(null)).toBeNull()
    expect(describeValue({})).toBeNull()
  })

  it('does not join entities across platforms', () => {
    const mirror = new Map([['google|ad-1', { ...MIRROR[2]!, platform: 'google' }]])
    expect(describeTarget('meta', 'ad', 'ad-1', mirror).target.inMirror).toBe(false)
  })
})

describe('approveAction and rejectAction', () => {
  it('approve moves proposed to approved and stamps the admin', async () => {
    const { store, ledger } = memoryStore([row({ id: 50 })])
    const res = await approveAction(50, 'mike@xdipx.com', { store, now: NOW })
    expect(res).toEqual({ ok: true, id: 50, status: 'approved' })
    expect(ledger.get(50)).toMatchObject({ status: 'approved', approvedBy: 'mike@xdipx.com', approvedAt: NOW })
  })

  it('reject moves proposed to rejected, keeps the decider and the one-line note', async () => {
    const { store, ledger } = memoryStore([row({ id: 51 })])
    const res = await rejectAction(51, 'mike@xdipx.com', '  too early,\n wait for 7d data ', { store, now: NOW })
    expect(res).toEqual({ ok: true, id: 51, status: 'rejected' })
    expect(ledger.get(51)).toMatchObject({ status: 'rejected', approvedBy: 'mike@xdipx.com', error: 'Rejected: too early, wait for 7d data' })
  })

  it('reject without a note leaves error alone', async () => {
    const { store, ledger } = memoryStore([row({ id: 52 })])
    await rejectAction(52, 'mike@xdipx.com', '', { store, now: NOW })
    expect(ledger.get(52)!.error).toBeNull()
  })

  it('a rejected row cannot be approved', async () => {
    const { store, ledger } = memoryStore([row({ id: 53 })])
    await rejectAction(53, 'mike@xdipx.com', null, { store, now: NOW })
    const res = await approveAction(53, 'mike@xdipx.com', { store, now: NOW })
    expect(res).toMatchObject({ ok: false, id: 53, code: 'rejected' })
    expect(ledger.get(53)!.status).toBe('rejected')
  })

  it('a dry_run row is not approvable', async () => {
    const { store, ledger } = memoryStore([row({ id: 54, status: 'dry_run' })])
    const res = await approveAction(54, 'mike@xdipx.com', { store, now: NOW })
    expect(res).toMatchObject({ ok: false, code: 'dry_run' })
    expect(ledger.get(54)!.status).toBe('dry_run')
  })

  it('refuses rows that are already decided, applied, expired, missing or past expiry', async () => {
    const { store } = memoryStore([
      row({ id: 55, status: 'approved' }),
      row({ id: 56, status: 'applied' }),
      row({ id: 57, status: 'expired' }),
      row({ id: 58, status: 'proposed', expiresAt: new Date(NOW.getTime() - 1000) }),
    ])
    expect(await approveAction(55, 'm', { store, now: NOW })).toMatchObject({ ok: false, code: 'not_pending' })
    expect(await rejectAction(56, 'm', null, { store, now: NOW })).toMatchObject({ ok: false, code: 'not_pending' })
    expect(await approveAction(57, 'm', { store, now: NOW })).toMatchObject({ ok: false, code: 'expired' })
    expect(await approveAction(58, 'm', { store, now: NOW })).toMatchObject({ ok: false, code: 'expired' })
    expect(await approveAction(999, 'm', { store, now: NOW })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await approveAction(Number.NaN, 'm', { store, now: NOW })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('turns a lost race into a typed refusal', async () => {
    const { store } = memoryStore([row({ id: 59 })])
    const raced: ActionsViewStore = {
      ...store,
      transition: async (id, to) => { throw new IllegalAdActionTransitionError(id, 'proposed', to) },
    }
    expect(await approveAction(59, 'm', { store: raced, now: NOW })).toMatchObject({ ok: false, code: 'raced' })
  })
})
