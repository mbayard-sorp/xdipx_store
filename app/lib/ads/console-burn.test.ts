/** Burn to date (ticket #16686): assembleBurn in console-core. */
import { describe, expect, it } from 'vitest'

import { computeBreakEven } from '~/lib/ad-metrics-core'
import { assembleBurn, burnFigures, type ChannelDay } from './console-core'

const NOW = new Date('2026-10-20T12:00:00Z')
const BE = computeBreakEven(3065, 45)

const day = (platform: string, d: string, spendCents: number, leads = 0, orders = 0, netRevenueCents = 0): ChannelDay =>
  ({ platform, day: d, spendCents, leads, orders, netRevenueCents })

describe('burnFigures', () => {
  it('computes CPL, CAC and contribution at the margin; ratios are null with nothing under them', () => {
    expect(burnFigures([day('meta', '2026-10-20', 1000, 4, 1, 3000)], 45)).toEqual({
      spendCents: 1000, leads: 4, cplCents: 250, orders: 1, cacCents: 1000, netRevenueCents: 3000, contributionCents: 350,
    })
    expect(burnFigures([day('meta', '2026-10-20', 359)], 45)).toMatchObject({ cplCents: null, cacCents: null, contributionCents: -359 })
  })
})

describe('assembleBurn', () => {
  it('counts each channel from its own first spend and over the last 28 days', () => {
    const days = [
      day('meta', '2026-08-01', 0, 0, 2, 6000), // orders before Meta ever spent: not Meta's.
      day('meta', '2026-09-01', 500, 1),
      day('meta', '2026-10-10', 359, 0, 1, 2500),
      day('microsoft', '2026-10-19', 200, 2),
      day('meta', '2026-10-21', 999), // tomorrow: ignored.
    ]
    const b = assembleBurn(days, BE, NOW)
    expect(b.rows.map(r => [r.platform, r.firstSpendDay])).toEqual([['meta', '2026-09-01'], ['microsoft', '2026-10-19']])
    const meta = b.rows[0]!
    expect(meta.sinceFirst).toMatchObject({ spendCents: 859, leads: 1, orders: 1, netRevenueCents: 2500 })
    expect(meta.sinceFirst.contributionCents).toBe(Math.round(2500 * 0.45) - 859)
    expect(meta.d28).toMatchObject({ spendCents: 359, leads: 0, orders: 1 })
    expect(b.total.firstSpendDay).toBe('2026-09-01')
    expect(b.total.sinceFirst).toMatchObject({ spendCents: 1059, leads: 3, orders: 1 })
    expect(b.total.d28).toMatchObject({ spendCents: 559, leads: 2 })
    expect(b.breakEven.cpaCents).toBe(1379)
  })

  it('a channel with orders and no spend shows them with no first-spend day', () => {
    const b = assembleBurn([day('csv', '2026-10-15', 0, 0, 1, 3000)], BE, NOW)
    expect(b.rows[0]).toMatchObject({ platform: 'csv', firstSpendDay: null, sinceFirst: { spendCents: 0, orders: 0 }, d28: { orders: 1 } })
  })

  it('no rows at all is an empty burn, not zeros pretending to be data', () => {
    const b = assembleBurn([], BE, NOW)
    expect(b.rows).toEqual([])
    expect(b.total.firstSpendDay).toBeNull()
  })
})
