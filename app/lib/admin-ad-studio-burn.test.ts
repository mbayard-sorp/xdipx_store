/**
 * Ticket #16413: the Ad Studio burn bar reads the same spend, cap and valve
 * as the ads console top bar (loadTopBar over the insights mirror), so the
 * two bars never disagree about today. Orders today still come from
 * getAdBurn, which the console bar does not show.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/session.server', () => ({ requireAdmin: vi.fn(async () => {}) }))

const sourceRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('~/lib/ads/console.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/console.server')>('~/lib/ads/console.server')
  return {
    ...actual,
    loadTopBar: () => actual.loadTopBar(sourceRef.current as Parameters<typeof actual.loadTopBar>[0]),
  }
})

const burnRef = vi.hoisted(() => ({
  current: { ok: true, day: '', spendCents: 999 as number | null, ordersToday: 3 as number | null, dailyCapCents: 1, spendEnabled: true },
}))
vi.mock('~/lib/ad-burn.server', () => ({ getAdBurn: vi.fn(async () => burnRef.current) }))
vi.mock('~/lib/ad-ideas.server', () => ({ countToRate: vi.fn(async () => 2), countCreativesToRate: vi.fn(async () => 1) }))
vi.mock('~/lib/ad-spend.server', () => ({ getSimulationExit: vi.fn(async () => null) }))

import { loader } from '~/routes/admin.ad-studio'
import { loader as consoleLoader } from '~/routes/admin.ads'

const today = new Date().toISOString().slice(0, 10)

function source(insights: () => Promise<Array<{ day: string; spendCents: number; leads: number }>>) {
  return {
    settings: async () => ({ spendEnabled: false, dailyCapCents: 2000, monthlyCapCents: 60000, leadCplCeilingCents: 800 }),
    insightsByDay: insights,
  }
}

function args(url: string) {
  return { request: new Request(url), params: {}, context: {} } as never
}

describe('admin.ad-studio burn bar', () => {
  it('shows the console top bar spend, cap and valve, not the creative metrics', async () => {
    sourceRef.current = source(async () => [{ day: today, spendCents: 1234, leads: 2 }, { day: today, spendCents: 66, leads: 0 }])
    const { burn } = await loader(args('https://xdipx.com/admin/ad-studio/ideas'))
    const { bar } = await consoleLoader(args('https://xdipx.com/admin/ads'))
    expect(burn.spendCents).toBe(1300)
    expect(burn.spendCents).toBe(bar.spendTodayCents)
    expect(burn.dailyCapCents).toBe(bar.dailyCapCents)
    expect(burn.spendEnabled).toBe(bar.spendEnabled)
    expect(burn.ok).toBe(true)
    expect(burn.ordersToday).toBe(3)
  })

  it('says spend unknown when the insights read fails, like the console bar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sourceRef.current = source(async () => { throw new Error('neon down') })
    const { burn } = await loader(args('https://xdipx.com/admin/ad-studio/ideas'))
    expect(burn.ok).toBe(false)
    expect(burn.spendCents).toBeNull()
    expect(burn.dailyCapCents).toBe(2000)
  })

  it('shows orders unknown when the orders read fails', async () => {
    sourceRef.current = source(async () => [])
    burnRef.current = { ...burnRef.current, ok: false, spendCents: null, ordersToday: null }
    const { burn } = await loader(args('https://xdipx.com/admin/ad-studio/ideas'))
    expect(burn.ordersToday).toBeNull()
    expect(burn.spendCents).toBe(0)
    expect(burn.ok).toBe(true)
  })
})
