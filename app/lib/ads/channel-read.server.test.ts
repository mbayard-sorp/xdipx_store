import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import { summarizeChannelInsights } from './channel-read.server'

const row = (level: string, externalId: string, spendCents: number) => ({
  level, externalId, day: '2026-11-01', spendCents, impressions: 10, clicks: 1,
})

describe('summarizeChannelInsights', () => {
  it('counts ad level only when both levels exist, so spend is not doubled', () => {
    const s = summarizeChannelInsights([row('ad', 'a', 100), row('ad', 'b', 50), row('campaign', 'c', 150)])
    expect(s.level).toBe('ad')
    expect(s.totals.spendCents).toBe(150)
    expect(Object.keys(s.byExternalId)).toEqual(['a', 'b'])
  })

  it('falls back to campaign level and sums days', () => {
    const s = summarizeChannelInsights([row('campaign', 'c', 100), row('campaign', 'c', 25)])
    expect(s.level).toBe('campaign')
    expect(s.byExternalId['c']).toEqual({ spendCents: 125, impressions: 20, clicks: 2 })
  })

  it('reads an empty mirror as zero, not a failure', () => {
    expect(summarizeChannelInsights([]).totals).toEqual({ spendCents: 0, impressions: 0, clicks: 0 })
  })
})
