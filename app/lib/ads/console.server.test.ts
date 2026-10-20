import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import { computeBreakEven } from '~/lib/ad-metrics-core'
import {
  ENTITY_STALE_MS, adsManagerLink, feedbackText, loadOverview, loadTopBar, r7State,
  type OverviewSource, type ProblemEntityRow,
} from './console.server'

const NOW = new Date('2026-10-19T15:00:00Z')

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

describe('loadOverview with an empty database', () => {
  it('reads all zeros, raises no alerts and labels everything simulation', async () => {
    const o = await loadOverview(source(), NOW)
    expect(o.simulation).toBe(true)
    expect(o.spend).toEqual({ todayCents: 0, yesterdayCents: 0, monthCents: 0 })
    expect(o.windows?.d7).toMatchObject({ spendCents: 0, leads: 0, cplCents: null, orders: 0, cpaCents: null, netRoas: null })
    expect(o.windows?.d30.cplCents).toBeNull()
    expect(o.counts).toEqual({
      campaign: { total: 0, active: 0, problems: 0 },
      adset: { total: 0, active: 0, problems: 0 },
      ad: { total: 0, active: 0, problems: 0 },
    })
    expect(o.pace).toMatchObject({ projectedCents: 0, projectedPct: 0, daysElapsed: 19, daysInMonth: 31 })
    expect(o.freshness).toMatchObject({ lastEntitySyncAt: null, entityStale: false, insightsStale: false })
    expect(o.r7.state).toBe('armed')
    expect(o.pendingActions).toBe(0)
    expect(o.tokenHealth).toBeNull()
    expect(o.alerts).toEqual([])
    expect(o.failed).toEqual([])
  })

  it('drops the simulation label once spend is on', async () => {
    const o = await loadOverview(source({
      settings: async () => ({ spendEnabled: true, dailyCapCents: 2000, monthlyCapCents: 60000, leadCplCeilingCents: 800 }),
    }), NOW)
    expect(o.simulation).toBe(false)
  })

  it('turns a failed read into unknown, not zero, and names it', async () => {
    const o = await loadOverview(source({ insightsByDay: async () => { throw new Error('boom') } }), NOW)
    expect(o.spend).toBeNull()
    expect(o.windows).toBeNull()
    expect(o.pace).toBeNull()
    expect(o.failed).toEqual(['insights'])
    expect(o.alerts).toEqual([])
  })
})

describe('loadOverview with a populated mirror', () => {
  const disapproved: ProblemEntityRow = {
    platform: 'meta', accountId: 'act_920738511029316', level: 'ad', externalId: '120001',
    name: 'img07 curious door', effectiveStatus: 'DISAPPROVED',
    reviewFeedback: { global: { 'Adult Products or Services': 'Ads must not promote adult products.' } },
  }

  const populated = source({
    insightsByDay: async () => [
      { day: '2026-10-19', spendCents: 1700, leads: 4 },
      { day: '2026-10-18', spendCents: 1500, leads: 3 },
      { day: '2026-10-13', spendCents: 1000, leads: 1 }, // inside 7d
      { day: '2026-10-01', spendCents: 2000, leads: 2 }, // month start, inside 30d
      { day: '2026-09-25', spendCents: 900, leads: 0 }, // inside 30d, last month
    ],
    attributedByDay: async () => [
      { day: '2026-10-18', orders: 1, netRevenueCents: 3065 },
      { day: '2026-10-01', orders: 1, netRevenueCents: 2500 },
    ],
    entityStatusCounts: async () => [
      { level: 'campaign', effectiveStatus: 'ACTIVE', n: 1 },
      { level: 'adset', effectiveStatus: 'ACTIVE', n: 2 },
      { level: 'ad', effectiveStatus: 'ACTIVE', n: 3 },
      { level: 'ad', effectiveStatus: 'DISAPPROVED', n: 1 },
      { level: 'ad', effectiveStatus: 'MISSING', n: 5 },
    ],
    problemEntities: async () => [disapproved],
    freshness: async () => ({
      lastEntitySyncAt: new Date(NOW.getTime() - ENTITY_STALE_MS - 3_600_000), // 9h ago
      lastInsightsPullAt: new Date(NOW.getTime() - 30 * 60_000),
    }),
    pendingActionCount: async () => 2,
  })

  it('sums spend by window and paces the month', async () => {
    const o = await loadOverview(populated, NOW)
    expect(o.spend).toEqual({ todayCents: 1700, yesterdayCents: 1500, monthCents: 6200 })
    expect(o.windows?.d7.spendCents).toBe(4200)
    expect(o.windows?.d30.spendCents).toBe(7100)
    // 6200 over 19 days, straight-lined to 31.
    expect(o.pace?.projectedCents).toBe(Math.round((6200 / 19) * 31))
    expect(o.pace?.projectedPct).toBe(Math.round((Math.round((6200 / 19) * 31) / 60000) * 100))
  })

  it('works out CPL and CPA per window', async () => {
    const o = await loadOverview(populated, NOW)
    expect(o.windows?.today).toMatchObject({ leads: 4, cplCents: 425 })
    expect(o.windows?.d7).toMatchObject({ leads: 8, cplCents: 525, orders: 1, cpaCents: 4200 })
    expect(o.windows?.d30).toMatchObject({ leads: 10, cplCents: 710, orders: 2, cpaCents: 3550, netRevenueCents: 5565 })
    expect(o.windows?.d30.netRoas).toBeCloseTo(5565 / 7100)
    expect(o.breakEven.cpaCents).toBe(1379)
  })

  it('counts live entities and leaves MISSING rows out', async () => {
    const o = await loadOverview(populated, NOW)
    expect(o.counts?.ad).toEqual({ total: 4, active: 3, problems: 1 })
    expect(o.counts?.campaign).toEqual({ total: 1, active: 1, problems: 0 })
  })

  it('raises the disapproval with its feedback and an Ads Manager link, then the stale sync', async () => {
    const o = await loadOverview(populated, NOW)
    expect(o.alerts.map(a => a.key)).toEqual(['entity:meta:120001', 'stale:entities', 'r7:near', 'pending'])
    const [d] = o.alerts
    expect(d).toMatchObject({ severity: 'alert', kind: 'entity' })
    expect(d?.title).toContain('img07 curious door')
    expect(d?.detail).toBe('Adult Products or Services: Ads must not promote adult products.')
    expect(d?.href).toBe('https://adsmanager.facebook.com/adsmanager/manage/ads?act=920738511029316&selected_ad_ids=120001')
    expect(o.freshness?.entityStale).toBe(true)
    expect(o.freshness?.insightsStale).toBe(false)
    expect(o.alerts.find(a => a.key === 'stale:entities')?.title).toBe('Last entity sync was 9 hours ago')
  })

  it('reports token trouble when a reading exists', async () => {
    const o = await loadOverview(source({
      channelHealth: async () => [{ channel: 'meta', checkedAt: NOW.toISOString(), state: 'expiring', expiresAt: '2026-10-30T00:00:00Z', error: null }],
    }), NOW)
    expect(o.tokenHealth).toHaveLength(1)
    expect(o.alerts).toEqual([expect.objectContaining({ key: 'token:meta', severity: 'warn', detail: 'Expires 2026-10-30.' })])
  })
})

describe('r7State', () => {
  const fired = { id: 7, ruleId: 'R7', action: 'pause', detail: { sentence: 'R7 paused all: spend passed the cap' }, firedAt: NOW }
  it('is fired when an R7 pause has no undo', () => {
    expect(r7State([fired], 0, 2000)).toEqual({ state: 'fired', sentence: 'R7 paused all: spend passed the cap' })
  })
  it('is armed again once the pause is undone', () => {
    const undo = { id: 8, ruleId: 'MAN', action: 'undo', detail: { undoes: 7 }, firedAt: NOW }
    expect(r7State([fired, undo], 100, 2000).state).toBe('armed')
  })
  it('is near at 80% of the cap', () => {
    expect(r7State([], 1600, 2000).state).toBe('near')
    expect(r7State([], 1599, 2000).state).toBe('armed')
  })
})

describe('helpers', () => {
  it('links campaigns and ad sets to their own Ads Manager views', () => {
    expect(adsManagerLink({ platform: 'meta', accountId: 'act_1', level: 'campaign', externalId: '9' }))
      .toBe('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1&selected_campaign_ids=9')
    expect(adsManagerLink({ platform: 'meta', accountId: '1', level: 'adset', externalId: '9' }))
      .toBe('https://adsmanager.facebook.com/adsmanager/manage/adsets?act=1&selected_adset_ids=9')
    expect(adsManagerLink({ platform: 'microsoft', accountId: '1', level: 'ad', externalId: '9' })).toBeNull()
  })
  it('flattens review feedback and returns null for none', () => {
    expect(feedbackText(null)).toBeNull()
    expect(feedbackText({})).toBeNull()
  })
  it('top bar sums today and says unknown when the read fails', async () => {
    const bar = await loadTopBar(source({ insightsByDay: async () => [{ day: '2026-10-19', spendCents: 1234, leads: 1 }] }), NOW)
    expect(bar).toEqual({ spendTodayCents: 1234, dailyCapCents: 2000, spendEnabled: false })
    const failed = await loadTopBar(source({ insightsByDay: async () => { throw new Error('x') } }), NOW)
    expect(failed.spendTodayCents).toBeNull()
  })
})
