/**
 * Ticket #16411: the /admin/ads overview loader, empty and populated.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included (same
 * note as admin-socials-compose-locked.test.ts).
 *
 * The loader's only data call is loadOverview(). It is swapped here for the
 * real loadOverview run against an in-memory source, so the test covers the
 * route wiring and the assembly together without a database or Meta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/lib/session.server', () => ({ requireAdmin: requireAdminMock }))

const sourceRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('~/lib/ads/console.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/console.server')>('~/lib/ads/console.server')
  return {
    ...actual,
    loadOverview: (_src: unknown, now?: Date) => actual.loadOverview(sourceRef.current as Parameters<typeof actual.loadOverview>[0], now),
  }
})

import { loader } from '~/routes/admin.ads._index'
import { computeBreakEven } from '~/lib/ad-metrics-core'
import type { OverviewSource } from '~/lib/ads/console.server'

function source(over: Partial<OverviewSource> = {}): OverviewSource {
  return {
    settings: async () => ({ spendEnabled: false, dailyCapCents: 2000, monthlyCapCents: 60000, leadCplCeilingCents: 800 }),
    breakEven: async () => computeBreakEven(3065, 45),
    insightsByDay: async () => [],
    attributedByDay: async () => [],
    entityStatusCounts: async () => [],
    problemEntities: async () => [],
    freshness: async () => ({ lastEntitySyncAt: null, lastInsightsPullAt: null }),
    ruleEventsSince: async () => [],
    pendingActionCount: async () => 0,
    channelHealth: async () => null,
    ...over,
  }
}

async function run() {
  const request = new Request('https://xdipx.com/admin/ads')
  return loader({ request, params: {}, context: {} } as unknown as Parameters<typeof loader>[0])
}

describe('admin.ads._index loader', () => {
  beforeEach(() => { requireAdminMock.mockClear() })

  it('guards with requireAdmin', async () => {
    sourceRef.current = source()
    await run()
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
  })

  it('returns the empty state: zeros, no alerts, simulation on', async () => {
    sourceRef.current = source()
    const { overview, now } = await run()
    expect(typeof now).toBe('string')
    expect(overview.simulation).toBe(true)
    expect(overview.spend).toEqual({ todayCents: 0, yesterdayCents: 0, monthCents: 0 })
    expect(overview.alerts).toEqual([])
    expect(overview.tokenHealth).toBeNull()
  })

  it('returns the populated state with a disapproval alert', async () => {
    const today = new Date().toISOString().slice(0, 10)
    sourceRef.current = source({
      insightsByDay: async () => [{ day: today, spendCents: 500, leads: 2 }],
      entityStatusCounts: async () => [{ level: 'ad', effectiveStatus: 'DISAPPROVED', n: 1 }],
      problemEntities: async () => [{
        platform: 'meta', accountId: 'act_1', level: 'ad', externalId: '42', name: 'img01',
        effectiveStatus: 'DISAPPROVED', reviewFeedback: null,
      }],
    })
    const { overview } = await run()
    expect(overview.spend?.todayCents).toBe(500)
    expect(overview.windows?.today.cplCents).toBe(250)
    expect(overview.counts?.ad.problems).toBe(1)
    expect(overview.alerts[0]).toMatchObject({ kind: 'entity', severity: 'alert', href: expect.stringContaining('selected_ad_ids=42') })
  })
})
