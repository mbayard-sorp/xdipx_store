import { describe, expect, it } from 'vitest'
import {
  ARRIVALS_MIN_BILLED_CLICKS, CAMPAIGN_HOURLY_SPEND_CENTS, ctrPct, evaluateKillRules, type CampaignRow, type KillRuleInput,
} from './kill-rules-core'

const SET = ['1', '2']
const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({ id: '1', status: 'ACTIVE', impressions: 100, clicks: 1, ...over })
const run = (over: Partial<KillRuleInput> = {}) =>
  evaluateKillRules({ campaignIds: SET, sites: [], variations: [], campaigns: [], arrivals: null, ...over })

describe('ctrPct', () => {
  it('is a percent and never NaN', () => {
    expect(ctrPct(1, 200)).toBe(0.5)
    expect(ctrPct(0, 0)).toBe(0)
  })
})

describe('site rules', () => {
  it('blocks 2000 impressions with no clicks, on every campaign in the set', () => {
    const [a, ...rest] = run({ sites: [{ hostname: 'Rat.XXX', impressions: 2000, clicks: 0 }] })
    expect(rest).toEqual([])
    expect(a).toMatchObject({ kind: 'block_site', rule: 'site_zero_click', hostname: 'rat.xxx', campaignIds: ['1', '2'] })
  })

  it('leaves 1999 impressions with no clicks alone', () => {
    expect(run({ sites: [{ hostname: 'a.com', impressions: 1999, clicks: 0 }] })).toEqual([])
  })

  it('does not block a site that clicked, under the CTR floor only at 5000 impressions', () => {
    // 4999 impressions, 1 click: not enough volume for the CTR rule.
    expect(run({ sites: [{ hostname: 'a.com', impressions: 4999, clicks: 1 }] })).toEqual([])
    // 5000 impressions, 1 click: 0.02% exactly is not under the floor.
    expect(run({ sites: [{ hostname: 'a.com', impressions: 5000, clicks: 1 }] })).toEqual([])
    // 5001 impressions, 1 click: 0.01999% is under it.
    const hit = run({ sites: [{ hostname: 'a.com', impressions: 5001, clicks: 1 }] })
    expect(hit).toHaveLength(1)
    expect(hit[0]).toMatchObject({ rule: 'site_low_ctr' })
  })

  it('does not block a healthy site', () => {
    expect(run({ sites: [{ hostname: 'good.com', impressions: 90000, clicks: 40 }] })).toEqual([])
  })

  it('names one rule per site when both would fire', () => {
    const hits = run({ sites: [{ hostname: 'a.com', impressions: 9000, clicks: 0 }] })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ rule: 'site_zero_click' })
  })
})

describe('variation rule', () => {
  it('pauses a variation with 5000 impressions and no clicks', () => {
    const hits = run({
      variations: [{ id: '9', campaignId: '1', impressions: 5000, clicks: 0 }, { id: '8', campaignId: '1', impressions: 4999, clicks: 0 }, { id: '7', campaignId: '1', impressions: 9000, clicks: 2 }],
      campaigns: [campaign()],
    })
    expect(hits).toEqual([expect.objectContaining({ kind: 'pause_variation', variationId: '9', campaignId: '1' })])
  })

  it('skips a variation whose campaign is already paused', () => {
    expect(run({
      variations: [{ id: '9', campaignId: '1', impressions: 6000, clicks: 0 }],
      campaigns: [campaign({ status: 'PAUSED' })],
    })).toEqual([])
  })
})

describe('campaign rules', () => {
  it('pauses 20000 impressions at CTR under 0.03%', () => {
    const hits = run({ campaigns: [campaign({ impressions: 20000, clicks: 5 })] })
    expect(hits).toEqual([expect.objectContaining({ kind: 'pause_campaign', rule: 'campaign_low_ctr', campaignId: '1' })])
  })

  it('leaves a campaign at exactly 0.03% or under 20000 impressions alone', () => {
    expect(run({ campaigns: [campaign({ impressions: 20000, clicks: 6 })] })).toEqual([])
    expect(run({ campaigns: [campaign({ impressions: 19999, clicks: 0 })] })).toEqual([])
  })

  it('pauses on more than $5 in one hour, not on exactly $5, and skips an unread hour', () => {
    expect(run({ campaigns: [campaign({ maxHourlySpendCents: CAMPAIGN_HOURLY_SPEND_CENTS + 1 })] }))
      .toEqual([expect.objectContaining({ rule: 'campaign_hourly_spend' })])
    expect(run({ campaigns: [campaign({ maxHourlySpendCents: CAMPAIGN_HOURLY_SPEND_CENTS })] })).toEqual([])
    expect(run({ campaigns: [campaign({ maxHourlySpendCents: null })] })).toEqual([])
  })

  it('never pauses a campaign that is not running', () => {
    expect(run({ campaigns: [campaign({ status: 'PAUSED', impressions: 90000, clicks: 0, maxHourlySpendCents: 9999 })] })).toEqual([])
  })

  it('names one rule per campaign', () => {
    const hits = run({ campaigns: [campaign({ impressions: 50000, clicks: 0, maxHourlySpendCents: 9999 })] })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ rule: 'campaign_low_ctr' })
  })
})

describe('arrivals rule', () => {
  const billed = (id: string, clicks: number) => campaign({ id, impressions: 1000, clicks })

  it('is skipped when arrivals are null', () => {
    expect(run({ campaigns: [billed('1', 500)], arrivals: null })).toEqual([])
  })

  it('pauses at 50 billed clicks with fewer than half arriving', () => {
    const hits = run({ campaigns: [billed('1', ARRIVALS_MIN_BILLED_CLICKS)], arrivals: { '1': 24 } })
    expect(hits).toEqual([expect.objectContaining({ kind: 'pause_campaign', rule: 'arrivals_shortfall', campaignId: '1' })])
  })

  it('leaves exactly half, and fewer than 50 billed clicks, alone', () => {
    expect(run({ campaigns: [billed('1', 50)], arrivals: { '1': 25 } })).toEqual([])
    expect(run({ campaigns: [billed('1', 49)], arrivals: { '1': 0 } })).toEqual([])
  })

  it('reads a single total against the whole set', () => {
    const campaigns = [billed('1', 30), billed('2', 30)]
    const hits = run({ campaigns, arrivals: 20 })
    expect(hits.map(h => h.kind === 'pause_campaign' && h.campaignId)).toEqual(['1', '2'])
    expect(run({ campaigns, arrivals: 30 })).toEqual([])
  })

  it('skips a campaign the per-campaign record does not mention', () => {
    expect(run({ campaigns: [billed('1', 80)], arrivals: { '2': 0 } })).toEqual([])
  })
})

describe('brakes only', () => {
  it('every action is a block or a pause', () => {
    const hits = run({
      sites: [{ hostname: 'a.com', impressions: 3000, clicks: 0 }],
      variations: [{ id: '9', campaignId: '1', impressions: 6000, clicks: 0 }],
      campaigns: [campaign({ impressions: 30000, clicks: 0 })],
    })
    expect(new Set(hits.map(h => h.kind))).toEqual(new Set(['block_site', 'pause_variation', 'pause_campaign']))
  })
})
