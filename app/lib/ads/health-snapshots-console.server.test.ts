/**
 * The Signals and Breakdowns page readers (ticket #16686) with an in-memory
 * snapshot store. db.server is stubbed; these two readers never touch it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/ad-metrics.server', () => ({ currentBreakEven: vi.fn() }))

import type { SnapshotKind, SnapshotRow } from './health-snapshots-core'
import type { SnapshotStore } from './health-snapshots.server'
import { loadBreakdownsPage, loadSignalsPage } from './health-snapshots-console.server'

const NOW = new Date('2026-10-20T12:00:00Z')

function store(rows: SnapshotRow[], fail = false): SnapshotStore {
  return {
    insert: async () => [],
    since: async (since: Date, channel: string | null, kinds?: SnapshotKind[]) => {
      if (fail) throw new Error('relation "ad_health_snapshots" does not exist')
      return rows.filter(r => Date.parse(r.observedAt) >= since.getTime() && (!channel || r.channel === channel) && (!kinds || kinds.includes(r.kind)))
    },
    latest: async (channel: string, kind: SnapshotKind) => {
      if (fail) throw new Error('relation "ad_health_snapshots" does not exist')
      return rows.filter(r => r.channel === channel && r.kind === kind).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null
    },
  }
}

const row = (kind: SnapshotKind, observedAt: string, payload: Record<string, unknown>, source = 'graph'): SnapshotRow =>
  ({ id: 1, channel: 'meta', kind, observedAt, payload, source, createdAt: observedAt })

describe('loadSignalsPage', () => {
  it('is all empty panels with no snapshots', async () => {
    const p = await loadSignalsPage(NOW, { store: store([]) })
    expect(p).toMatchObject({ account: null, activity: null, errors: null, opportunity: null, anomaly: null, failed: [] })
  })

  it('reads each kind with its age and flags a problem account', async () => {
    const p = await loadSignalsPage(NOW, {
      store: store([
        row('account', '2026-10-20T11:05:00Z', { accountStatus: 9, disableReason: 0 }),
        row('activity', '2026-10-20T11:05:00Z', { windowHours: 24, items: [{ event_time: '2026-10-20T10:00:00Z', actor_name: 'Mike', outOfBand: true, why: 'made by Mike' }] }),
        row('errors', '2026-10-19T08:00:00Z', { items: [{ message: 'Ad rejected' }] }, 'routine'),
      ]),
    })
    expect(p.account?.data.problem?.title).toBe('Meta ad account is IN_GRACE_PERIOD')
    expect(p.account?.age).toMatchObject({ age: '55 minutes ago', stale: false })
    expect(p.activity?.data.outOfBandCount).toBe(1)
    expect(p.errors?.data[0]?.message).toBe('Ad rejected')
    expect(p.errors?.source).toBe('routine')
  })

  it('a missing table reads as failed, not as a crash', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = await loadSignalsPage(NOW, { store: store([], true) })
    err.mockRestore()
    expect(p.failed).toEqual(['account', 'activity', 'errors', 'opportunity', 'anomaly'])
    expect(p.account).toBeNull()
  })
})

describe('loadBreakdownsPage', () => {
  it('builds one panel per dimension from the newest snapshot, with the floor applied', async () => {
    const rows = [
      row('breakdown', '2026-10-19T09:05:00Z', {
        dimension: 'gender', since: '2026-10-12', until: '2026-10-18',
        rows: [
          { adsetId: 's1', slice: 'female', spendCents: 6000, leads: 10 },
          { adsetId: 's1', slice: 'male', spendCents: 3000, leads: 30 },
          { adsetId: 's2', slice: 'unknown', spendCents: 1000, leads: 0 },
        ],
      }),
      row('breakdown', '2026-10-12T09:05:00Z', { dimension: 'gender', rows: [] }),
      row('breakdown', '2026-10-19T09:05:00Z', { dimension: 'age', rows: [] }),
    ]
    const p = await loadBreakdownsPage(NOW, { store: store(rows) })
    expect(p.panels.map(x => x.dimension)).toEqual(['age', 'gender'])
    const g = p.panels[1]!
    expect(g).toMatchObject({ since: '2026-10-12', until: '2026-10-18', adsets: 2, totalSpendCents: 10_000, totalLeads: 40 })
    expect(g.slices.map(s => [s.slice, s.meetsFloor])).toEqual([['female', true], ['male', false], ['unknown', false]])
  })

  it('no snapshots is an empty page', async () => {
    expect((await loadBreakdownsPage(NOW, { store: store([]) })).panels).toEqual([])
  })
})
