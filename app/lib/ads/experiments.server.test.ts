/**
 * Ticket #16436: experiment status transitions and metric sums, against an
 * in-memory store and source. No database.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  ExperimentConflictError,
  ExperimentNotFoundError,
  abandonExperiment,
  createExperiment,
  decideExperiment,
  loadExperimentMetrics,
  startExperiment,
  type AdExperimentRow,
  type ExperimentMetricsSource,
  type ExperimentStore,
} from './experiments.server'
import { IllegalExperimentTransitionError, type NewExperimentInput } from './experiments-core'

const NOW = new Date('2026-10-19T12:00:00Z')

function memoryStore(): ExperimentStore & { rows: Map<number, AdExperimentRow> } {
  const rows = new Map<number, AdExperimentRow>()
  let next = 1
  return {
    rows,
    async list(status) { return [...rows.values()].filter(r => !status || r.status === status) },
    async get(id) { return rows.get(id) ?? null },
    async insert(input) {
      const row: AdExperimentRow = {
        id: next++, hypothesis: input.hypothesis, variable: input.variable, arms: input.arms,
        primaryMetric: input.primaryMetric, minSpendCents: input.minSpendCents, startsAt: null, endsAt: null,
        status: 'planned', verdict: null, decidedBy: null, notes: input.notes, createdAt: NOW, updatedAt: NOW,
      }
      rows.set(row.id, row)
      return row
    },
    async update(id, fromStatus, patch) {
      const row = rows.get(id)
      if (!row || row.status !== fromStatus) return null
      const updated = { ...row, ...patch, updatedAt: NOW }
      rows.set(id, updated)
      return updated
    },
  }
}

const INPUT: NewExperimentInput = {
  hypothesis: 'Question hook beats benefit hook.',
  variable: 'hook',
  primaryMetric: 'cpl',
  minSpendCents: 4000,
  notes: null,
  arms: [
    { label: 'A', platform: 'meta', level: 'ad', externalId: '111' },
    { label: 'B', platform: 'meta', level: 'adset', externalId: '900' },
  ],
}

describe('experiment status transitions', () => {
  it('creates as planned, then runs, then decides with a verdict', async () => {
    const store = memoryStore()
    const row = await createExperiment(INPUT, store)
    expect(row.status).toBe('planned')

    const running = await startExperiment(row.id, store, NOW)
    expect(running.status).toBe('running')
    expect(running.startsAt).toEqual(NOW)

    const later = new Date(NOW.getTime() + 86_400_000)
    const decided = await decideExperiment(row.id, '  A wins on CPL. Kill B.  ', 'owner@xdipx.com', store, later)
    expect(decided).toMatchObject({ status: 'decided', verdict: 'A wins on CPL. Kill B.', decidedBy: 'owner@xdipx.com' })
    expect(decided.endsAt).toEqual(later)
  })

  it('refuses decide from planned', async () => {
    const store = memoryStore()
    const row = await createExperiment(INPUT, store)
    await expect(decideExperiment(row.id, 'too early', 'owner', store)).rejects.toBeInstanceOf(IllegalExperimentTransitionError)
    expect(store.rows.get(row.id)?.status).toBe('planned')
  })

  it('refuses decide with an empty verdict', async () => {
    const store = memoryStore()
    const row = await createExperiment(INPUT, store)
    await startExperiment(row.id, store, NOW)
    await expect(decideExperiment(row.id, '   ', 'owner', store)).rejects.toThrow(/verdict/)
  })

  it('abandons from planned and leaves ends_at empty', async () => {
    const store = memoryStore()
    const row = await createExperiment(INPUT, store)
    const out = await abandonExperiment(row.id, 'owner', store, NOW)
    expect(out.status).toBe('abandoned')
    expect(out.endsAt).toBeNull()
  })

  it('abandons from running and closes the window', async () => {
    const store = memoryStore()
    const row = await createExperiment(INPUT, store)
    await startExperiment(row.id, store, NOW)
    const out = await abandonExperiment(row.id, 'owner', store, NOW)
    expect(out.status).toBe('abandoned')
    expect(out.endsAt).toEqual(NOW)
  })

  it('refuses to restart a decided or abandoned experiment', async () => {
    const store = memoryStore()
    const row = await createExperiment(INPUT, store)
    await abandonExperiment(row.id, 'owner', store, NOW)
    await expect(startExperiment(row.id, store)).rejects.toBeInstanceOf(IllegalExperimentTransitionError)
  })

  it('throws not found and conflict', async () => {
    const store = memoryStore()
    await expect(startExperiment(99, store)).rejects.toBeInstanceOf(ExperimentNotFoundError)
    const row = await createExperiment(INPUT, store)
    const racing: ExperimentStore = { ...store, update: async () => null }
    await expect(startExperiment(row.id, racing)).rejects.toBeInstanceOf(ExperimentConflictError)
  })
})

describe('loadExperimentMetrics', () => {
  function source(): ExperimentMetricsSource & { calls: unknown[] } {
    const calls: unknown[] = []
    return {
      calls,
      async adsUnder(arm) { return arm.level === 'ad' ? [arm.externalId] : ['901', '902'] },
      async insightTotals(platform, adIds, from, to) {
        calls.push({ platform, adIds, from, to })
        return { spendCents: 1000 * adIds.length, impressions: 500 * adIds.length, leads: 3 * adIds.length }
      },
      async creativeIdsFor(_p, adIds) { return adIds.map(Number) },
      async creativeTotals(ids) { return { orders: ids.length, netRevenueCents: 2500 * ids.length } },
    }
  }

  it('sums each arm between starts_at and now, rolling ad sets up from their ads', async () => {
    const src = source()
    const out = await loadExperimentMetrics(
      { arms: INPUT.arms, startsAt: new Date('2026-10-12T09:00:00Z'), endsAt: null }, src, NOW,
    )
    expect(out[0]!.metrics).toEqual({ spendCents: 1000, impressions: 500, leads: 3, orders: 1, netRevenueCents: 2500 })
    expect(out[1]!.metrics).toEqual({ spendCents: 2000, impressions: 1000, leads: 6, orders: 2, netRevenueCents: 5000 })
    expect(src.calls[0]).toMatchObject({ from: '2026-10-12', to: '2026-10-19' })
  })

  it('stops at ends_at for a decided experiment', async () => {
    const src = source()
    await loadExperimentMetrics(
      { arms: INPUT.arms, startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-10T00:00:00Z') }, src, NOW,
    )
    expect(src.calls[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-10' })
  })

  it('returns zeros for a planned experiment without querying', async () => {
    const src = source()
    const out = await loadExperimentMetrics({ arms: INPUT.arms, startsAt: null, endsAt: null }, src, NOW)
    expect(out.every(a => a.metrics.spendCents === 0)).toBe(true)
    expect(src.calls).toHaveLength(0)
  })
})
