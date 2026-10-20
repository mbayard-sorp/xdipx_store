/**
 * Ticket #16436: the /admin/ads/experiments loader and action.
 *
 * Lives in app/lib, not next to the route: anything in app/routes is picked
 * up by flatRoutes/typegen as a route module, tests included.
 *
 * loadExperimentsPage is swapped for the real one run against in-memory
 * deps, so the test covers the route wiring, the metric sums and the floors
 * together. This is the ticket's DONE WHEN: an experiment under the floor
 * renders as not readable, one over it shows the arm comparison.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const adminRef = vi.hoisted(() => ({ current: { role: 'owner', email: 'owner@xdipx.com' } as { role: string; email: string } | null }))
vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
  getAdminUser: async () => adminRef.current,
}))

const depsRef = vi.hoisted(() => ({ current: null as unknown }))
const createMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/ads/experiments.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/experiments.server')>('~/lib/ads/experiments.server')
  return {
    ...actual,
    loadExperimentsPage: (status: Parameters<typeof actual.loadExperimentsPage>[0]) =>
      actual.loadExperimentsPage(status, depsRef.current as Parameters<typeof actual.loadExperimentsPage>[1], new Date('2026-10-19T12:00:00Z')),
    createExperiment: createMock,
  }
})

import { action, loader } from '~/routes/admin.ads.experiments'
import type { AdExperimentRow, ExperimentsPageDeps } from '~/lib/ads/experiments.server'

const arms = [
  { label: 'Question', platform: 'meta', level: 'ad' as const, externalId: '111' },
  { label: 'Benefit', platform: 'meta', level: 'ad' as const, externalId: '222' },
]

function row(id: number, status: AdExperimentRow['status'], startsAt: Date | null): AdExperimentRow {
  return {
    id, hypothesis: `H${id}`, variable: 'hook', arms, primaryMetric: 'cpl', minSpendCents: 4000,
    startsAt, endsAt: null, status, verdict: null, decidedBy: null, notes: null,
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
  }
}

/** Per-experiment numbers keyed by ad id. Experiment 1 is under the floor, 2 is over it. */
function deps(rows: AdExperimentRow[], byAd: Record<string, { spendCents: number; impressions: number; leads: number }>): ExperimentsPageDeps {
  return {
    store: {
      list: async status => rows.filter(r => !status || r.status === status),
      get: async () => null,
      insert: async () => { throw new Error('unused') },
      update: async () => null,
    },
    metrics: {
      adsUnder: async arm => [arm.externalId],
      insightTotals: async (_p, ids) => byAd[ids[0]!] ?? { spendCents: 0, impressions: 0, leads: 0 },
      creativeIdsFor: async () => [],
      creativeTotals: async () => ({ orders: 0, netRevenueCents: 0 }),
    },
    entities: {
      options: async () => [{ value: 'meta|ad|111', label: 'Ad: Question (meta)', level: 'ad' }],
    },
  }
}

async function runLoader(url = 'https://xdipx.com/admin/ads/experiments') {
  return loader({ request: new Request(url), params: {}, context: {} } as unknown as Parameters<typeof loader>[0])
}

describe('admin.ads.experiments loader', () => {
  beforeEach(() => {
    requireAdminMock.mockClear()
    adminRef.current = { role: 'owner', email: 'owner@xdipx.com' }
  })

  it('guards with requireAdmin and returns the empty state', async () => {
    depsRef.current = deps([], {})
    const out = await runLoader()
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
    expect(out.cards).toEqual([])
    expect(out.options).toHaveLength(1)
    expect(out.isOwner).toBe(true)
  })

  it('shows an under-floor experiment as not readable and an over-floor one with a leader', async () => {
    const started = new Date('2026-10-12T00:00:00Z')
    // Experiment 1 reads ads 111/222 at low volume; experiment 2 reuses the
    // same ids, so give each its own store and run twice.
    depsRef.current = deps([row(1, 'running', started)], {
      111: { spendCents: 2000, impressions: 900, leads: 3 },
      222: { spendCents: 2500, impressions: 1100, leads: 4 },
    })
    const under = await runLoader()
    const c1 = under.cards[0]!.comparison
    expect(c1.arms.every(a => !a.readable)).toBe(true)
    expect(c1.arms[0]!.reason).toContain('3 of 10 leads')
    expect(c1.leaderIndex).toBeNull()

    depsRef.current = deps([row(2, 'running', started)], {
      111: { spendCents: 6000, impressions: 4000, leads: 20 },
      222: { spendCents: 6000, impressions: 4200, leads: 12 },
    })
    const over = await runLoader()
    const c2 = over.cards[0]!.comparison
    expect(c2.allReadable).toBe(true)
    expect(c2.arms.map(a => a.value)).toEqual([300, 500])
    expect(c2.leaderIndex).toBe(0)
  })

  it('applies the status filter', async () => {
    depsRef.current = deps([row(1, 'planned', null), row(2, 'running', new Date('2026-10-12T00:00:00Z'))], {})
    const out = await runLoader('https://xdipx.com/admin/ads/experiments?status=planned')
    expect(out.status).toBe('planned')
    expect(out.cards.map(c => c.experiment.id)).toEqual([1])
    expect(out.cards[0]!.comparison.arms[0]!.reason).toBe('not started')
  })
})

describe('admin.ads.experiments action', () => {
  function post(fields: Record<string, string | string[]>) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one)
    const request = new Request('https://xdipx.com/admin/ads/experiments', { method: 'POST', body: fd })
    return action({ request, params: {}, context: {} } as unknown as Parameters<typeof action>[0])
  }

  beforeEach(() => { createMock.mockReset() })

  it('refuses writes from a non-owner admin', async () => {
    adminRef.current = { role: 'admin', email: 'helper@xdipx.com' }
    const out = await post({ intent: 'start', id: '1' })
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('Only the owner') })
  })

  it('creates a planned experiment from the form', async () => {
    adminRef.current = { role: 'owner', email: 'owner@xdipx.com' }
    createMock.mockResolvedValue({ id: 7 })
    const out = await post({
      intent: 'create', hypothesis: 'Question beats benefit', variable: 'hook', primaryMetric: 'cpl', minSpend: '40', notes: '',
      armChoice: ['meta|ad|111', 'meta|ad|222'], armLabel: ['Question', 'Benefit'],
    })
    expect(out).toEqual({ ok: true, intent: 'create', id: 7 })
    expect(createMock.mock.calls[0]![0].arms).toHaveLength(2)
  })

  it('returns the validation error for one arm', async () => {
    adminRef.current = { role: 'owner', email: 'owner@xdipx.com' }
    const out = await post({
      intent: 'create', hypothesis: 'x', variable: 'hook', primaryMetric: 'cpl', minSpend: '', notes: '',
      armChoice: ['meta|ad|111', ''], armLabel: ['', ''],
    })
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('at least 2 arms') })
    expect(createMock).not.toHaveBeenCalled()
  })
})
