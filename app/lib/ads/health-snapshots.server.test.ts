/**
 * runSignalPulls and latestSnapshots against an in-memory store and fake
 * Graph reads. No database, no network.
 */
import { describe, expect, it, vi } from 'vitest'

import type { MetaAccountSnapshot, MetaBreakdownRow, MetaSignalReads } from './channels/meta/adapter.server'
import type { SnapshotKind, SnapshotRecordInput, SnapshotRow } from './health-snapshots-core'
import {
  ACCOUNT_PAGE_KEY, breakdownRange, isBreakdownRun, latestSnapshots, recordSnapshot, runSignalPulls, type SnapshotStore,
} from './health-snapshots.server'

// Tuesday hourly, and Sunday at the 09:00 UTC restatement hour.
const TUE = new Date('2026-10-20T12:05:00Z')
const SUN = new Date('2026-10-25T09:05:00Z')

function memoryStore() {
  const rows: SnapshotRow[] = []
  let id = 1
  const store: SnapshotStore = {
    async insert(input: SnapshotRecordInput[]) {
      const out = input.map(r => ({
        id: id++, channel: r.channel, kind: r.kind, observedAt: r.observedAt.toISOString(),
        payload: r.payload, source: r.source, createdAt: r.observedAt.toISOString(),
      }))
      rows.push(...out)
      return out
    },
    async since(since: Date, channel: string | null, kinds?: SnapshotKind[]) {
      return rows.filter(r => Date.parse(r.observedAt) >= since.getTime()
        && (!channel || r.channel === channel) && (!kinds || kinds.includes(r.kind)))
    },
    async latest(channel: string, kind: SnapshotKind) {
      return rows.filter(r => r.channel === channel && r.kind === kind)
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null
    },
  }
  return { rows, store }
}

const ACTIVE: MetaAccountSnapshot = {
  accountId: 'act_920738511029316', name: 'xdipx', accountStatus: 1, disableReason: 0, currency: 'USD',
  amountSpentCents: 359, spendCapCents: null, balanceCents: 0,
}

function fakeReads(over: Partial<MetaSignalReads> = {}) {
  const breakdown = vi.fn(async (_r: { since: string; until: string }, b: readonly string[]): Promise<MetaBreakdownRow[]> => [
    { adsetId: 's1', adsetName: 'Lead set', slice: b.map(() => 'x').join(' / '), spendCents: 359, impressions: 900, linkClicks: 12, leads: 0 },
  ])
  const reads: MetaSignalReads = {
    configured: () => true,
    account: vi.fn(async () => ACTIVE),
    whoAmI: vi.fn(async () => ({ id: '111', name: 'xdipx system user' })),
    activities: vi.fn(async () => [
      { event_time: '2026-10-20T10:00:00+0000', actor_id: '111', actor_name: 'xdipx system user', object_id: 'c1', event_type: 'update_campaign_run_status' },
      { event_time: '2026-10-20T11:00:00+0000', actor_id: '333', actor_name: 'Shopify', application_name: 'Shopify', object_id: 'c9', event_type: 'update_campaign_run_status' },
    ]),
    breakdown,
    ...over,
  }
  return { reads, breakdown }
}

function deps(now: Date, reads: MetaSignalReads, store: SnapshotStore) {
  const fileBlocker = vi.fn(async () => ({ id: 7, created: true, reopened: false }))
  const clearBlocker = vi.fn(async () => true)
  return {
    d: { now: () => now, reads, store, fileBlocker, clearBlocker, ledgerApplied: async () => [] },
    fileBlocker, clearBlocker,
  }
}

describe('runSignalPulls', () => {
  it('without a token records nothing and says why', async () => {
    const m = memoryStore()
    const { reads } = fakeReads({ configured: () => false })
    const r = await runSignalPulls({ now: () => TUE, reads, store: m.store })
    expect(r.configured).toBe(false)
    expect(r.account).toEqual({ ok: 'skipped', reason: expect.stringContaining('META_ADS_ACCESS_TOKEN') })
    expect(m.rows).toEqual([])
  })

  it('an ACTIVE account stores the reading and clears the page; activity is stored with verdicts', async () => {
    const m = memoryStore()
    const { reads, breakdown } = fakeReads()
    const { d, fileBlocker, clearBlocker } = deps(TUE, reads, m.store)
    const r = await runSignalPulls(d)
    expect(r.account).toMatchObject({ ok: true, detail: { accountStatus: 1, statusName: 'ACTIVE' } })
    expect(fileBlocker).not.toHaveBeenCalled()
    expect(clearBlocker).toHaveBeenCalledWith(ACCOUNT_PAGE_KEY, expect.stringContaining('ACTIVE'))
    expect(m.rows.map(x => x.kind)).toEqual(['account', 'activity'])
    const act = m.rows.find(x => x.kind === 'activity')!.payload
    expect(act['outOfBandCount']).toBe(1)
    expect((act['items'] as Array<{ outOfBand: boolean }>).map(i => i.outOfBand)).toEqual([false, true])
    expect(act['systemUser']).toEqual({ id: '111', name: 'xdipx system user' })
    expect(breakdown).not.toHaveBeenCalled()
    expect(r.breakdowns).toMatchObject({ ok: 'skipped' })
  })

  it('pages the owner when the account is not ACTIVE', async () => {
    const m = memoryStore()
    const { reads } = fakeReads({ account: async () => ({ ...ACTIVE, accountStatus: 3, disableReason: 0 }) })
    const { d, fileBlocker, clearBlocker } = deps(TUE, reads, m.store)
    const r = await runSignalPulls(d)
    expect(fileBlocker).toHaveBeenCalledTimes(1)
    const filed = (fileBlocker.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    expect(filed['dedupeKey']).toBe(ACCOUNT_PAGE_KEY)
    expect(filed['title']).toBe('Ads: Meta ad account is UNSETTLED')
    expect(String(filed['detail'])).toMatch(/payment failed/)
    expect(filed['priority']).toBe(1)
    expect(clearBlocker).not.toHaveBeenCalled()
    expect(r.page).toMatchObject({ filed: true, key: ACCOUNT_PAGE_KEY })
  })

  it('one read failing does not stop the others', async () => {
    const m = memoryStore()
    const { reads } = fakeReads({ account: async () => { throw new Error('Graph GET act refused: (#200) permission') } })
    const { d } = deps(TUE, reads, m.store)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runSignalPulls(d)
    err.mockRestore()
    expect(r.account).toEqual({ ok: false, error: expect.stringContaining('permission') })
    expect(r.activity).toMatchObject({ ok: true })
    expect(m.rows.map(x => x.kind)).toEqual(['activity'])
  })

  it('a ledger row on the same object near the change makes it ours', async () => {
    const m = memoryStore()
    const { reads } = fakeReads()
    const { d } = deps(TUE, reads, m.store)
    await runSignalPulls({ ...d, ledgerApplied: async () => [{ id: 5, externalId: 'c9', appliedAt: '2026-10-20T11:02:00Z' }] })
    expect(m.rows.find(x => x.kind === 'activity')!.payload['outOfBandCount']).toBe(0)
  })

  it('pulls placement, age and gender on the Sunday restatement run only', async () => {
    const m = memoryStore()
    const { reads, breakdown } = fakeReads()
    const { d } = deps(SUN, reads, m.store)
    const r = await runSignalPulls({ ...d, restatement: true })
    expect(breakdown.mock.calls.map(c => c[1])).toEqual([['publisher_platform', 'platform_position'], ['age'], ['gender']])
    expect(breakdown.mock.calls[0]![0]).toEqual({ since: '2026-10-18', until: '2026-10-24' })
    const rows = m.rows.filter(x => x.kind === 'breakdown')
    expect(rows.map(x => x.payload['dimension'])).toEqual(['placement', 'age', 'gender'])
    expect(rows[0]!.source).toBe('graph')
    expect(r.breakdowns).toMatchObject({ ok: true, detail: { rows: { placement: 1, age: 1, gender: 1 } } })

    expect(isBreakdownRun(SUN, false)).toBe(false)
    expect(isBreakdownRun(TUE, true)).toBe(false)
    expect(breakdownRange(SUN)).toEqual({ since: '2026-10-18', until: '2026-10-24' })
  })
})

describe('recordSnapshot and latestSnapshots', () => {
  it('records and returns the newest per kind and per breakdown dimension', async () => {
    const m = memoryStore()
    const at = (iso: string) => new Date(iso)
    await recordSnapshot({ channel: 'meta', kind: 'pixel', observedAt: at('2026-10-19T09:00:00Z'), payload: { v: 1 }, source: 'routine' }, { store: m.store })
    await recordSnapshot({ channel: 'meta', kind: 'pixel', observedAt: at('2026-10-20T09:00:00Z'), payload: { v: 2 }, source: 'routine' }, { store: m.store })
    await recordSnapshot({ channel: 'meta', kind: 'breakdown', observedAt: at('2026-10-19T09:00:00Z'), payload: { dimension: 'age' }, source: 'graph' }, { store: m.store })
    await recordSnapshot({ channel: 'meta', kind: 'breakdown', observedAt: at('2026-10-19T09:00:00Z'), payload: { dimension: 'gender' }, source: 'graph' }, { store: m.store })
    // Older than the 15-day lookback: not returned.
    await recordSnapshot({ channel: 'meta', kind: 'errors', observedAt: at('2026-09-01T09:00:00Z'), payload: {}, source: 'routine' }, { store: m.store })

    const out = await latestSnapshots('meta', { store: m.store, now: () => TUE })
    expect(out.snapshots.map(s => [s.kind, s.payload['v'] ?? s.payload['dimension']])).toEqual([['breakdown', 'age'], ['pixel', 2]])
    expect(out.breakdowns.map(s => s.payload['dimension'])).toEqual(['age', 'gender'])
  })
})
