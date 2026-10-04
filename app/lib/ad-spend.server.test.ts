import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  audit: [] as Array<Record<string, unknown>>,
  invalidated: 0,
  tables: new Map<unknown, Array<Record<string, unknown>>>(),
}))

vi.mock('~/lib/team.server', () => ({
  invalidateTeamSettingsCache: vi.fn(async () => { mem.invalidated += 1 }),
}))
vi.mock('~/lib/feed-processor.server', () => ({
  getPipelineSetting: vi.fn(async (key: string) => mem.settings.get(key) ?? null),
}))
vi.mock('~/lib/db.server', async () => {
  const schema = await import('../../db/schema')
  const thenable = (rows: unknown[]) => {
    const t: Record<string, unknown> = {
      from: (table: unknown) => thenable(mem.tables.get(table) ?? rows),
      where: () => t, orderBy: () => t, innerJoin: () => t,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    }
    return t
  }
  return {
    db: {
      // setPipelineSettingAudited reads the existing value (none here), then upserts and audits.
      select: () => ({
        from: (table: unknown) => {
          if (table === schema.pipelineSettings) return { where: () => ({ limit: async () => [] }) }
          return thenable(mem.tables.get(table) ?? [])
        },
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === schema.pipelineSettings) {
            mem.settings.set(String(v['key']), String(v['value']))
            return { onConflictDoUpdate: async () => undefined }
          }
          if (table === schema.settingsAuditLog) mem.audit.push(v)
          return Promise.resolve()
        },
      }),
    },
  }
})

import { SpendInputError, saveGrossMargin, saveMediaCaps, saveRuleValues } from '~/lib/ad-spend.server'
import {
  MAX_MONTHLY_CAP_CENTS, buildPlanVsActual, monthProjection, parseDollarsToCents, routineStreak,
} from '~/lib/ad-spend-core'
import { getAdsMediaDailyCapCents, getAdsMediaMonthlyCapCents, getAdsRuleThreshold } from '~/lib/ad-settings.server'

beforeEach(() => {
  mem.settings.clear(); mem.audit.length = 0; mem.invalidated = 0; mem.tables.clear()
})

describe('cap and rule saves go through the audited setter', () => {
  it('writes both cap keys as cents with an owner audit row naming the Spend tab', async () => {
    const out = await saveMediaCaps({ monthly: '$600', daily: '20' }, 'owner')
    expect(out.message).toBe('Monthly cap set to $600. Daily guard set to $20.')
    expect(mem.settings.get('ads_media_monthly_cap_cents')).toBe('60000')
    expect(mem.settings.get('ads_media_daily_cap_cents')).toBe('2000')
    expect(mem.audit).toHaveLength(2)
    expect(mem.audit[0]).toMatchObject({ key: 'ads_media_monthly_cap_cents', newValue: '60000', actor: 'owner', source: 'admin.ad-studio.spend' })
    expect(mem.audit[1]).toMatchObject({ key: 'ads_media_daily_cap_cents', newValue: '2000', actor: 'owner', source: 'admin.ad-studio.spend' })
    expect(mem.invalidated).toBe(2)
  })

  it('round trips: the readers see what was saved', async () => {
    await saveMediaCaps({ monthly: '900', daily: '30' }, 'owner')
    expect(await getAdsMediaMonthlyCapCents()).toBe(90000)
    expect(await getAdsMediaDailyCapCents()).toBe(3000)
    await saveRuleValues('R1', { ads_rule_r1_be_multiple: '2.5', ads_rule_r1_min_hours: '72' }, 'owner')
    expect(await getAdsRuleThreshold('ads_rule_r1_be_multiple')).toBe(2.5)
    expect(await getAdsRuleThreshold('ads_rule_r1_min_hours')).toBe(72)
    const keys = mem.audit.map(a => a['key'])
    expect(keys).toContain('ads_rule_r1_be_multiple')
    expect(mem.audit.every(a => a['actor'] === 'owner' && a['source'] === 'admin.ad-studio.spend')).toBe(true)
  })

  it('rejects money it cannot read and a daily guard over the monthly cap', async () => {
    await expect(saveMediaCaps({ monthly: 'six hundred', daily: '20' })).rejects.toBeInstanceOf(SpendInputError)
    await expect(saveMediaCaps({ monthly: '600', daily: '' })).rejects.toThrow(/daily guard/i)
    await expect(saveMediaCaps({ monthly: '100', daily: '200' })).rejects.toThrow(/cannot be larger/)
    await expect(saveMediaCaps({ monthly: '2000000', daily: '20' })).rejects.toThrow(/over \$100,000/)
    expect(mem.audit).toHaveLength(0)
  })

  it('rejects an out-of-range rule number and writes nothing for that rule', async () => {
    await expect(saveRuleValues('R6', { ads_rule_r6_budget_down_pct: '150' })).rejects.toThrow(/Budget cut must be a number from 1 to 90/)
    expect(mem.audit).toHaveLength(0)
  })

  it('ignores keys that belong to another rule', async () => {
    await expect(saveRuleValues('R2', { ads_rule_r1_min_hours: '10' })).rejects.toThrow(/Nothing to save/)
  })

  it('saves gross margin with its own audit row and refuses 0 or 101', async () => {
    const out = await saveGrossMargin('50', 'owner')
    expect(out.message).toBe('Gross margin set to 50%. Break-even moves with it.')
    expect(mem.audit[0]).toMatchObject({ key: 'ads_gross_margin_pct', newValue: '50', actor: 'owner' })
    await expect(saveGrossMargin('0')).rejects.toBeInstanceOf(SpendInputError)
    await expect(saveGrossMargin('101')).rejects.toBeInstanceOf(SpendInputError)
  })
})

describe('spend core', () => {
  it('parses dollars the owner types', () => {
    expect(parseDollarsToCents('600')).toBe(60000)
    expect(parseDollarsToCents('$1,200.50')).toBe(120050)
    expect(parseDollarsToCents('7.5')).toBe(750)
    expect(parseDollarsToCents('')).toBeNull()
    expect(parseDollarsToCents('-5')).toBeNull()
    expect(parseDollarsToCents('1.234')).toBeNull()
    expect(MAX_MONTHLY_CAP_CENTS).toBe(10_000_000)
  })

  it('projects the month straight line', () => {
    const p = monthProjection('2026-10-14', 8400, 60000)
    expect(p).toMatchObject({ month: '2026-10', daysInMonth: 31, daysElapsed: 14, spentCents: 8400, projectedCents: 18600 })
    expect(p.ratio).toBeCloseTo(0.14)
    expect(monthProjection('2026-10-14', 90000, 60000).ratio).toBe(1)
    expect(monthProjection('2026-10-14', 100, 0).ratio).toBe(0)
  })

  it('counts a routine streak back from today, or yesterday when today has not run', () => {
    expect(routineStreak(['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-29'], '2026-10-03')).toBe(3)
    expect(routineStreak(['2026-10-02', '2026-10-01'], '2026-10-03')).toBe(2)
    expect(routineStreak(['2026-09-30'], '2026-10-03')).toBe(0)
    expect(routineStreak([], '2026-10-03')).toBe(0)
  })

  const metrics = (creativeId: number | null, day: string, spendCents: number, orders = 0, net = 0, platform = 'google') =>
    ({ creativeId, day, platform, spendCents, orders, netRevenueCents: net })

  it('plans per campaign and lane: the campaign plan when linked to ideas, else the lane share of the cap', () => {
    const rows = buildPlanVsActual({
      today: '2026-10-03', windowDays: 7, dailyCapCents: 2000,
      creatives: [
        { id: 1, campaignId: 10, lane: 'meta', registerTier: '3-4', ideaId: 5 },
        { id: 2, campaignId: 11, lane: 'google', registerTier: '4-5', ideaId: null },
      ],
      campaigns: [{ id: 10, name: 'Meta bridge', plannedDailyCents: 600 }, { id: 11, name: 'Google RSA', plannedDailyCents: 500 }],
      metrics: [
        metrics(1, '2026-10-02', 2210, 3, 6800, 'meta'),
        metrics(2, '2026-10-02', 3140),
        metrics(2, '2026-09-20', 9999), // outside the window
        metrics(null, '2026-10-01', 1200, 0, 0, 'shop'),
      ],
    })
    const meta = rows.find(r => r.campaignName === 'Meta bridge')!
    expect(meta).toMatchObject({ plannedCents: 4200, plannedSource: 'campaign', actualCents: 2210, orders: 3, deltaCents: 2210 - 4200 })
    expect(meta.netRoas).toBeCloseTo(3.08, 1)
    // Google's campaign has a plan but no idea link, so it takes half the $20 cap for 7 days.
    const google = rows.find(r => r.campaignName === 'Google RSA')!
    expect(google).toMatchObject({ plannedCents: 7000, plannedSource: 'lane-share', actualCents: 3140 })
    const account = rows.find(r => r.campaignName === 'Account level')!
    expect(account).toMatchObject({ lane: 'shop', plannedCents: null, plannedSource: 'none', actualCents: 1200, deltaCents: null })
  })

  it('shows a planned campaign with no spend, so a quiet lane reads $0 of its plan', () => {
    const rows = buildPlanVsActual({
      today: '2026-10-03', windowDays: 30, dailyCapCents: 2000,
      creatives: [{ id: 1, campaignId: 10, lane: 'adult', registerTier: '9', ideaId: 3 }],
      campaigns: [{ id: 10, name: 'Adult test', plannedDailyCents: 0 }],
      metrics: [],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actualCents: 0, plannedCents: 60000, plannedSource: 'lane-share' })
  })
})
