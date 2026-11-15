import { describe, expect, it } from 'vitest'
import { maxHourlyCostCents, parseCampaignStatRows, parseSiteRows, parseVariationRows, toCampaignRows } from './placements-core'

// Shapes read live from /statistics/a/site and /a/campaign on 2026-11-15.
const SITE_A = { site_hostname: 'rat.xxx', impressions: 2237, clicks: 0, value: 2.87099, cost: 0.0287099, ctr: 0 }
const SITE_B = { site_hostname: 'hog.tv', impressions: 43, clicks: 1, value: 0.084224, cost: 0.00084224, ctr: 2.3255813953488373 }

describe('parseSiteRows', () => {
  it('reads cost in dollars into cents and recomputes ctr as a percent', () => {
    const rows = parseSiteRows([SITE_B])
    expect(rows[0]).toMatchObject({ hostname: 'hog.tv', impressions: 43, clicks: 1, costCents: 0 })
    expect(rows[0]!.ctrPct).toBeCloseTo(2.3256, 3)
  })

  it('sums a hostname split across pages and sorts by cost', () => {
    const rows = parseSiteRows([
      { site_hostname: 'A.com', impressions: 1000, clicks: 1, cost: 1.5 },
      SITE_A,
      { site_hostname: 'a.com', impressions: 500, clicks: 0, cost: 0.75 },
    ])
    expect(rows.map(r => r.hostname)).toEqual(['a.com', 'rat.xxx'])
    expect(rows[0]).toMatchObject({ impressions: 1500, clicks: 1, costCents: 225 })
  })

  it('skips rows with no hostname and non-objects', () => {
    expect(parseSiteRows([{ impressions: 5 }, null, 'x', { site_hostname: '  ', impressions: 1 }])).toEqual([])
  })
})

describe('parseVariationRows', () => {
  it('stamps each row with its campaign and sums repeats', () => {
    const rows = parseVariationRows('8774050', [
      { idvariation: 157351362, impressions: 100, clicks: 1, cost: 0.5 },
      { idvariation: 157351362, impressions: 50, clicks: 0, cost: 0.25 },
      { impressions: 9 },
    ])
    expect(rows).toEqual([{ id: '157351362', campaignId: '8774050', impressions: 150, clicks: 1, costCents: 75 }])
  })
})

describe('campaign stat rows and hours', () => {
  it('keys campaign stats by id', () => {
    const m = parseCampaignStatRows([{ idcampaign: 8774050, impressions: 158087, clicks: 33, cost: 9.29716725 }])
    expect(m.get('8774050')).toEqual({ impressions: 158087, clicks: 33, costCents: 930 })
  })

  it('takes the busiest hour', () => {
    expect(maxHourlyCostCents([{ hour: 2, cost: 0.13 }, { hour: 13, cost: 1.02 }, { hour: 4, cost: 0.53 }])).toBe(102)
    expect(maxHourlyCostCents([])).toBeNull()
  })

  it('joins stats, live status and hours, filling gaps', () => {
    const rows = toCampaignRows(
      new Map([['1', { impressions: 10, clicks: 1, costCents: 5 }]]),
      new Map([['1', 'ACTIVE']]),
      new Map([['1', 700]]),
      ['1', '2'],
    )
    expect(rows).toEqual([
      { id: '1', status: 'ACTIVE', impressions: 10, clicks: 1, costCents: 5, maxHourlySpendCents: 700 },
      { id: '2', status: 'UNKNOWN', impressions: 0, clicks: 0, costCents: 0, maxHourlySpendCents: null },
    ])
  })
})
