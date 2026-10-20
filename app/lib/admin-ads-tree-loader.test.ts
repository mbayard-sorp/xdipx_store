/**
 * Ticket #16412: the /admin/ads/tree loader.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included (same
 * note as admin-ads-overview-loader.test.ts).
 *
 * loadTree() is swapped for the real loadTree run against an in-memory
 * source, so the test covers the route wiring, the search params and the
 * assembly together without a database or Meta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/lib/session.server', () => ({ requireAdmin: requireAdminMock }))

const sourceRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('~/lib/ads/tree.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/tree.server')>('~/lib/ads/tree.server')
  return {
    ...actual,
    loadTree: (opts: Parameters<typeof actual.loadTree>[0], _src: unknown, now?: Date) =>
      actual.loadTree(opts, sourceRef.current as Parameters<typeof actual.loadTree>[1], now),
  }
})

import { loader } from '~/routes/admin.ads.tree'
import { computeBreakEven } from '~/lib/ad-metrics-core'
import type { TreeEntityRow, TreeSource } from '~/lib/ads/tree.server'

function ent(over: Partial<TreeEntityRow> & Pick<TreeEntityRow, 'level' | 'externalId'>): TreeEntityRow {
  return {
    platform: 'meta', accountId: 'act_1', parentExternalId: null, name: over.externalId,
    status: 'ACTIVE', effectiveStatus: 'ACTIVE', objective: null,
    dailyBudgetCents: null, lifetimeBudgetCents: null, creativeId: null, ...over,
  }
}

function source(over: Partial<TreeSource> = {}): TreeSource {
  return {
    settings: async () => ({ spendEnabled: false, leadCplCeilingCents: 800 }),
    breakEven: async () => computeBreakEven(3065, 45),
    entities: async () => [],
    insights: async () => [],
    creativeDays: async () => [],
    creatives: async () => [],
    lastSyncedAt: async () => null,
    ...over,
  }
}

async function run(qs = '') {
  const request = new Request(`https://xdipx.com/admin/ads/tree${qs}`)
  return loader({ request, params: {}, context: {} } as unknown as Parameters<typeof loader>[0])
}

describe('admin.ads.tree loader', () => {
  beforeEach(() => { requireAdminMock.mockClear() })

  it('guards with requireAdmin', async () => {
    sourceRef.current = source()
    await run()
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
  })

  it('returns the empty mirror state', async () => {
    sourceRef.current = source()
    const { page, now } = await run()
    expect(typeof now).toBe('string')
    expect(page.roots).toEqual([])
    expect(page.totals).toEqual({ campaigns: 0, adsets: 0, ads: 0, removedHidden: 0 })
    expect(page.simulation).toBe(true)
    expect(page.filters).toEqual({ platform: null, status: 'all', campaignId: null })
    expect(page.failed).toEqual([])
  })

  it('builds the populated tree and applies the search params', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const creativeIdsAsked: number[][] = []
    sourceRef.current = source({
      entities: async () => [
        ent({ level: 'campaign', externalId: 'c1', name: 'Leads', dailyBudgetCents: 2000 }),
        ent({ level: 'adset', externalId: 's1', parentExternalId: 'c1' }),
        ent({ level: 'ad', externalId: 'a1', parentExternalId: 's1', creativeId: 5, effectiveStatus: 'DISAPPROVED' }),
        ent({ level: 'ad', externalId: 'a2', parentExternalId: 's1' }),
        ent({ level: 'campaign', externalId: 'c2' }),
      ],
      insights: async () => [{ level: 'ad', externalId: 'a1', day: today, spendCents: 600, impressions: 100, clicks: 4, leads: 2 }],
      creativeDays: async (ids) => { creativeIdsAsked.push(ids); return [{ creativeId: 5, day: today, orders: 1, netRevenueCents: 1800 }] },
      creatives: async () => [{ id: 5, ideaId: 9 }],
    })
    const { page } = await run('?status=disapproved&campaign=c1')
    expect(creativeIdsAsked).toEqual([[5]])
    expect(page.filters).toEqual({ platform: null, status: 'disapproved', campaignId: 'c1' })
    expect(page.roots.map(r => r.key)).toEqual(['campaign:c1'])
    const ad = page.roots[0]!.children[0]!.children[0]!
    expect(ad.key).toBe('ad:a1')
    expect(ad.d1.spendCents).toBe(600)
    expect(ad.d7.cplCents).toBe(300)
    expect(ad.orders7?.netRoas).toBeCloseTo(3, 5)
    expect(ad.studioHref).toBe('/admin/ad-studio/creatives?idea=9&view=all')
    expect(ad.adsManagerHref).toContain('selected_ad_ids=a1')
    expect(page.roots[0]!.d7.spendCents).toBe(600)
    expect(page.campaigns).toHaveLength(2)
  })

  it('a failed insights read names itself instead of showing $0 as fact', async () => {
    sourceRef.current = source({
      entities: async () => [ent({ level: 'campaign', externalId: 'c1' })],
      insights: async () => { throw new Error('neon down') },
    })
    const { page } = await run()
    expect(page.failed).toEqual(['insights'])
    expect(page.roots).toHaveLength(1)
  })

  it('a failed mirror read throws to the error boundary', async () => {
    sourceRef.current = source({ entities: async () => { throw new Error('neon down') } })
    await expect(run()).rejects.toThrow('neon down')
  })
})
