import { describe, expect, it } from 'vitest'
import { aggregateLeadFunnel, UNSET, type FunnelLead, type FunnelOrder } from './lead-funnel-report'

const start = new Date('2026-09-18T00:00:00Z')
const lead = (id: string, content: string | null, interest: string | null, at: string): FunnelLead => ({
  profileId: id, utmContent: content, interest, capturedAt: at,
})
const order = (id: string, at: string, value: number): FunnelOrder => ({ profileId: id, at, value })

describe('aggregateLeadFunnel', () => {
  const leads = [
    lead('a', 'ad1', 'wands', '2026-10-01T10:00:00Z'),
    lead('b', 'ad1', 'for-two', '2026-10-02T10:00:00Z'),
    lead('c', 'ad2', 'wands', '2026-10-03T10:00:00Z'),
    lead('d', null, null, '2026-10-04T10:00:00Z'),
  ]

  it('groups leads by utm_content and interest', () => {
    const r = aggregateLeadFunnel(leads, [], { start })
    expect(r.totals.leads).toBe(4)
    expect(r.byUtmContent.find(x => x.key === 'ad1')?.leads).toBe(2)
    expect(r.byUtmContent.find(x => x.key === UNSET)?.leads).toBe(1)
    expect(r.byInterest.find(x => x.key === 'wands')?.leads).toBe(2)
  })

  it('computes lead-to-order rate and revenue sum', () => {
    const r = aggregateLeadFunnel(leads, [
      order('a', '2026-10-05T00:00:00Z', 40),
      order('a', '2026-10-06T00:00:00Z', 10.5),
      order('c', '2026-10-07T00:00:00Z', 25),
    ], { start })
    const ad1 = r.byUtmContent.find(x => x.key === 'ad1')!
    expect(ad1.convertedLeads).toBe(1)
    expect(ad1.orders).toBe(2)
    expect(ad1.revenue).toBe(50.5)
    expect(ad1.leadToOrderRate).toBe(0.5)
    expect(r.totals.revenue).toBe(75.5)
    expect(r.totals.leadToOrderRate).toBe(0.5)
  })

  it('does not count an order placed before lead_captured_at', () => {
    const r = aggregateLeadFunnel(leads, [order('a', '2026-09-30T00:00:00Z', 99)], { start })
    expect(r.totals.convertedLeads).toBe(0)
    expect(r.totals.revenue).toBe(0)
  })

  it('ignores leads captured outside the window and handles empty input', () => {
    const r = aggregateLeadFunnel([lead('z', 'old', null, '2026-01-01T00:00:00Z')], [], { start })
    expect(r.totals.leads).toBe(0)
    expect(r.totals.leadToOrderRate).toBe(0)
    expect(r.byUtmContent).toEqual([])
  })
})
