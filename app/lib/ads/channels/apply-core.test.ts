import { describe, expect, it } from 'vitest'
import {
  budgetChangeOf, budgetWithinStep, classifyTier, gateDispatch, resolveBudgetOwner, withinDailyActionCap,
  type MirrorBudgetRow,
} from './apply-core'

const budget = (current: number | null) => ({ dailyBudgetCents: current, lifetimeBudgetCents: null })

describe('classifyTier: the one invariant', () => {
  it('spend-decreasing verbs are auto', () => {
    expect(classifyTier('pause', null, null)).toBe('auto')
    expect(classifyTier('halt_all', null, null)).toBe('auto')
    expect(classifyTier('set_budget', { dailyBudgetCents: 700 }, budget(1000))).toBe('auto')
    expect(classifyTier('brake', { dailyBudgetCents: 700 }, budget(1000))).toBe('auto')
    expect(classifyTier('brake', null, null)).toBe('auto')
  })

  it('spend-increasing verbs are approve, never auto', () => {
    expect(classifyTier('resume', null, null)).toBe('approve')
    expect(classifyTier('scale', { dailyBudgetCents: 1200 }, budget(1000))).toBe('approve')
    expect(classifyTier('scale', null, null)).toBe('approve')
    expect(classifyTier('set_budget', { dailyBudgetCents: 1001 }, budget(1000))).toBe('approve')
    expect(classifyTier('brake', { dailyBudgetCents: 1200 }, budget(1000))).toBe('approve')
  })

  it('a budget increase never classifies auto, at any size', () => {
    for (const cur of [1, 100, 1000, 50_000]) {
      for (const up of [1, 10, cur, cur * 10]) {
        expect(classifyTier('set_budget', { dailyBudgetCents: cur + up }, budget(cur))).not.toBe('auto')
        expect(classifyTier('brake', { dailyBudgetCents: cur + up }, budget(cur))).not.toBe('auto')
        expect(classifyTier('scale', { dailyBudgetCents: cur + up }, budget(cur))).not.toBe('auto')
      }
    }
  })

  it('everything else is owner', () => {
    expect(classifyTier('update_creative', null, null)).toBe('owner')
    expect(classifyTier('delete_campaign', null, null)).toBe('owner')
    expect(classifyTier('', null, null)).toBe('owner')
    expect(classifyTier('set_budget', { dailyBudgetCents: 1000 }, budget(1000))).toBe('owner')
    expect(classifyTier('set_budget', { dailyBudgetCents: 900 }, budget(null))).toBe('owner')
    expect(classifyTier('set_budget', null, budget(1000))).toBe('owner')
    expect(classifyTier('brake', { dailyBudgetCents: 1000 }, budget(1000))).toBe('owner')
  })

  it('reads a lifetime budget when that is the field in play', () => {
    expect(budgetChangeOf({ lifetimeBudgetCents: 5000 }, { lifetimeBudgetCents: 8000 })).toEqual({ current: 8000, proposed: 5000 })
    expect(classifyTier('set_budget', { lifetimeBudgetCents: 9000 }, { lifetimeBudgetCents: 8000 })).toBe('approve')
  })
})

describe('budgetWithinStep', () => {
  it('allows a step up to the cap in either direction', () => {
    expect(budgetWithinStep(1000, 1200, 20)).toBe(true)
    expect(budgetWithinStep(1000, 800, 20)).toBe(true)
    expect(budgetWithinStep(1000, 1000, 20)).toBe(true)
  })
  it('refuses a step past the cap', () => {
    expect(budgetWithinStep(1000, 1201, 20)).toBe(false)
    expect(budgetWithinStep(1000, 700, 20)).toBe(false)
  })
  it('refuses when there is no current budget to measure against', () => {
    expect(budgetWithinStep(null, 500, 20)).toBe(false)
    expect(budgetWithinStep(0, 500, 20)).toBe(false)
    expect(budgetWithinStep(1000, null, 20)).toBe(false)
    expect(budgetWithinStep(1000, -1, 200)).toBe(false)
  })
})

describe('withinDailyActionCap', () => {
  it('is true strictly under the cap', () => {
    expect(withinDailyActionCap(0, 10)).toBe(true)
    expect(withinDailyActionCap(9, 10)).toBe(true)
    expect(withinDailyActionCap(10, 10)).toBe(false)
    expect(withinDailyActionCap(11, 10)).toBe(false)
    expect(withinDailyActionCap(0, 0)).toBe(false)
  })
})

describe('resolveBudgetOwner', () => {
  const row = (o: Partial<MirrorBudgetRow> & Pick<MirrorBudgetRow, 'level' | 'externalId'>): MirrorBudgetRow => ({
    platform: 'meta', parentExternalId: null, dailyBudgetCents: null, lifetimeBudgetCents: null, ...o,
  })
  const ad = row({ level: 'ad', externalId: 'ad1', parentExternalId: 'as1' })

  it('CBO: the campaign owns the budget when it carries one', () => {
    const mirror = [ad, row({ level: 'adset', externalId: 'as1', parentExternalId: 'c1' }), row({ level: 'campaign', externalId: 'c1', dailyBudgetCents: 2000 })]
    expect(resolveBudgetOwner(mirror, 'ad1')).toEqual({ platform: 'meta', level: 'campaign', externalId: 'c1' })
  })

  it('CBO with a lifetime budget also resolves to the campaign', () => {
    const mirror = [ad, row({ level: 'adset', externalId: 'as1', parentExternalId: 'c1' }), row({ level: 'campaign', externalId: 'c1', lifetimeBudgetCents: 30000 })]
    expect(resolveBudgetOwner(mirror, 'ad1')?.level).toBe('campaign')
  })

  it('ABO: the ad set owns it when the campaign has none', () => {
    const mirror = [ad, row({ level: 'adset', externalId: 'as1', parentExternalId: 'c1', dailyBudgetCents: 1000 }), row({ level: 'campaign', externalId: 'c1' })]
    expect(resolveBudgetOwner(mirror, 'ad1')).toEqual({ platform: 'meta', level: 'adset', externalId: 'as1' })
  })

  it('falls back to the ad set when the campaign is not mirrored', () => {
    expect(resolveBudgetOwner([ad, row({ level: 'adset', externalId: 'as1', parentExternalId: 'c9' })], 'ad1')?.externalId).toBe('as1')
  })

  it('returns null when the ad or its ad set is missing', () => {
    expect(resolveBudgetOwner([], 'ad1')).toBeNull()
    expect(resolveBudgetOwner([ad], 'ad1')).toBeNull()
  })
})

describe('gateDispatch', () => {
  const on = { spendEnabled: true, autoApplyEnabled: true, autoActionsToday: 0, autoActionsMaxPerDay: 10 }
  it('holds as dry_run while either valve is off, whatever the tier', () => {
    for (const tier of ['auto', 'approve', 'owner'] as const) {
      expect(gateDispatch({ ...on, tier, spendEnabled: false }).status).toBe('dry_run')
      expect(gateDispatch({ ...on, tier, autoApplyEnabled: false }).status).toBe('dry_run')
    }
    expect(gateDispatch({ ...on, tier: 'auto', spendEnabled: false }).dryRunReason).toMatch(/ads_spend_enabled/)
  })
  it('holds approve and owner tiers with both valves on', () => {
    expect(gateDispatch({ ...on, tier: 'approve' }).dryRunReason).toMatch(/tier approve/)
    expect(gateDispatch({ ...on, tier: 'owner' }).dryRunReason).toMatch(/tier owner/)
  })
  it('holds at the daily cap and on an oversized step', () => {
    expect(gateDispatch({ ...on, tier: 'auto', autoActionsToday: 10 }).dryRunReason).toMatch(/daily cap/)
    expect(gateDispatch({ ...on, tier: 'auto', budgetStepOk: false, budgetMaxStepPct: 20 }).dryRunReason).toMatch(/20%/)
  })
  it('lets an auto action through only when everything allows it', () => {
    expect(gateDispatch({ ...on, tier: 'auto' })).toEqual({ status: 'proposed', dryRunReason: null })
    expect(gateDispatch({ ...on, tier: 'auto', budgetStepOk: true })).toEqual({ status: 'proposed', dryRunReason: null })
  })
})
