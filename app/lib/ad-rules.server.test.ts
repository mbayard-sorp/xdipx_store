import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the database, keyed by the drizzle table object
// each query names. Where clauses are not evaluated: the fixtures are built so
// that every table holds exactly the rows the query under test should see.
// ---------------------------------------------------------------------------
const mem = vi.hoisted(() => ({
  tables: new Map<unknown, Array<Record<string, unknown>>>(),
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  nextId: 100,
  settings: new Map<string, string>(),
  now: new Date('2026-10-03T15:00:00Z'),
}))

vi.mock('~/lib/db.server', () => {
  const thenable = (rows: Array<Record<string, unknown>>) => {
    const t: Record<string, unknown> = {
      from: (table: unknown) => thenable(mem.tables.get(table) ?? rows),
      where: () => t, orderBy: () => t, limit: () => t, leftJoin: () => t,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    }
    return t
  }
  return {
    db: {
      select: () => thenable([]),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const list = Array.isArray(values) ? values : [values]
          const created = list.map(v => {
            const row = { id: mem.nextId++, firedAt: mem.now, appliedAt: null, appliedBy: null, ...v }
            mem.inserts.push({ table, values: row })
            const rows = mem.tables.get(table) ?? []
            rows.push(row)
            mem.tables.set(table, rows)
            return row
          })
          return Object.assign(Promise.resolve(), { returning: async () => created.map(r => ({ id: r['id'] })) })
        },
      }),
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          mem.updates.push({ table, set })
          return { where: () => Promise.resolve() }
        },
      }),
    },
  }
})
vi.mock('~/lib/feed-processor.server', () => ({
  getPipelineSetting: vi.fn(async (key: string) => mem.settings.get(key) ?? null),
}))
const fileBlocker = vi.hoisted(() => vi.fn(async () => ({ id: 1, created: true, reopened: false })))
vi.mock('~/lib/owner-blockers.server', () => ({ fileBlocker }))

import { adCreatives, adRuleEvents } from '../../db/schema'
import { ADS_RULE_DEFAULTS } from '~/lib/ad-settings-defaults'
import {
  applyRuleAction, cappedScalePct, evaluateRules, evaluateSampleCreative, nextMultiplier, planPersistence,
  recipeFields, runRulesDaily, sampleNow, validateRuleValue, RULE_RECIPES, RECIPE_ORDER,
  type CreativeRuleInput, type RuleEventHistory, type RulesSettings,
} from '~/lib/ad-rules.server'
import { computeBreakEven, sampleDataset, type DailyPoint } from '~/lib/ad-metrics-core'
import { setPlatformApplier } from '~/lib/ad-platform-apply.server'

const NOW = new Date('2026-10-03T15:00:00Z')
const HOUR = 3_600_000
const ago = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString()

const dp = (daysAgo: number, o: Partial<DailyPoint> = {}): DailyPoint => ({
  day: ago(daysAgo), spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0, ...o,
})
const run = (from: number, to: number, o: Partial<DailyPoint> = {}): DailyPoint[] =>
  Array.from({ length: from - to + 1 }, (_, i) => dp(from - i, o))

const creative = (over: Partial<CreativeRuleInput> = {}): CreativeRuleInput => ({
  key: '1', creativeId: 1, label: '#1', paused: false, launchedAt: null, frequency: null, budgetMultiplier: 1, days: [], events: [], ...over,
})
const ev = (over: Partial<RuleEventHistory> = {}): RuleEventHistory => ({
  id: 1, ruleId: 'MAN', action: 'pause', firedAt: hoursAgo(24), appliedAt: hoursAgo(24), appliedBy: 'owner', undone: false, ...over,
})

// Break-even at a $33 AOV and 45% margin: CPA $14.85 (1485 cents), ROAS 2.22x.
const settings: RulesSettings = {
  thresholds: { ...ADS_RULE_DEFAULTS },
  breakEven: computeBreakEven(3300, 45),
  dailyCapCents: 2000,
}

const evalOne = (c: CreativeRuleInput, s: RulesSettings = settings, accountDays: DailyPoint[] = []) =>
  evaluateRules({ creatives: [c], accountDays }, s, NOW)
const rulesOf = (c: CreativeRuleInput, s: RulesSettings = settings) => evalOne(c, s).firings.map(f => f.ruleId)

// ---------------------------------------------------------------------------
// R1 hard kill
// ---------------------------------------------------------------------------
describe('R1 hard kill', () => {
  // Seven days at $5 a day, 400 impressions and 8 clicks a day: $35 spent, 2% CTR, no orders.
  const base = () => creative({ days: run(6, 0, { spendCents: 500, impressions: 400, clicks: 8 }) })

  it('fires at 2 x break-even spend with zero orders after 48 hours live', () => {
    const r = evalOne(base()).firings
    expect(r.map(f => f.ruleId)).toEqual(['R1'])
    expect(r[0]).toMatchObject({ action: 'pause', creativeId: 1 })
    expect(r[0]!.sentence).toBe('Pause: $35.00 spent in 7d, 0 orders, R1')
    expect(r[0]!.inputs).toMatchObject({ spendCents: 3500, orders: 0, breakEvenCpaCents: 1485, multiple: 2 })
  })

  it('stays quiet under 2 x break-even', () => {
    expect(rulesOf(creative({ days: run(6, 0, { spendCents: 400, impressions: 400, clicks: 8 }) }))).toEqual([])
  })

  it('stays quiet once an order is attributed', () => {
    const days = run(6, 0, { spendCents: 500, impressions: 400, clicks: 8 })
    days[3] = { ...days[3]!, orders: 1, netRevenueCents: 2500 }
    // Not R1: an order is attributed. (R6 brakes it, which is the point of the next rule.)
    expect(rulesOf(creative({ days }))).not.toContain('R1')
  })

  it('waits out the minimum hours live', () => {
    expect(rulesOf(creative({ ...base(), launchedAt: hoursAgo(19) }))).not.toContain('R1')
  })

  it('does not look at a paused creative', () => {
    expect(rulesOf(creative({ ...base(), paused: true }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R2 broken creative
// ---------------------------------------------------------------------------
describe('R2 broken creative', () => {
  it('fires at 2,000 impressions under a 0.5% CTR', () => {
    const r = evalOne(creative({ days: [dp(0, { spendCents: 100, impressions: 2500, clicks: 5 })] })).firings
    expect(r.map(f => f.ruleId)).toEqual(['R2'])
    expect(r[0]!.sentence).toBe('Pause: 2,500 impressions in 1d at 0.20% CTR, R2')
  })
  it('stays quiet under 2,000 impressions', () => {
    expect(rulesOf(creative({ days: [dp(0, { spendCents: 100, impressions: 1500, clicks: 1 })] }))).toEqual([])
  })
  it('stays quiet at a healthy CTR', () => {
    expect(rulesOf(creative({ days: [dp(0, { spendCents: 100, impressions: 2500, clicks: 50 })] }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R3 unprofitable
// ---------------------------------------------------------------------------
describe('R3 unprofitable', () => {
  const days = (net: number) => {
    const d = run(6, 0, { spendCents: 700, impressions: 500, clicks: 15 })
    d[2] = { ...d[2]!, orders: 1, netRevenueCents: net }
    return d
  }
  it('fires at 3 x break-even over 7d with ROAS under 0.8 x break-even', () => {
    const r = evalOne(creative({ days: days(1000) })).firings
    expect(r.map(f => f.ruleId)).toEqual(['R3'])
    expect(r[0]!.action).toBe('pause')
    expect(r[0]!.sentence).toContain('0.2x net ROAS against 2.2x break-even over 7d')
  })
  it('stays quiet when ROAS clears the factor', () => {
    expect(rulesOf(creative({ days: days(9000) }))).not.toContain('R3')
  })
})

// ---------------------------------------------------------------------------
// R4 revive: once, never twice
// ---------------------------------------------------------------------------
describe('R4 revive', () => {
  // Paused by R1 two days ago after $30 of spend; a $70 order then lands.
  const pausedDays = (net: number): DailyPoint[] => [
    ...run(6, 3, { spendCents: 750, impressions: 400, clicks: 8 }),
    dp(1, { orders: 1, netRevenueCents: net }),
  ]
  const r1Pause = ev({ id: 7, ruleId: 'R1', action: 'pause', appliedAt: `${ago(2)}T10:00:00Z`, firedAt: `${ago(2)}T09:00:00Z` })
  const paused = (over: Partial<CreativeRuleInput> = {}) => creative({ paused: true, days: pausedDays(7000), events: [r1Pause], ...over })

  it('fires once a late order brings net ROAS back to break-even', () => {
    const r = evalOne(paused()).firings
    expect(r.map(f => f.ruleId)).toEqual(['R4'])
    expect(r[0]!.action).toBe('revive')
    expect(r[0]!.sentence).toContain('Revive: a late order brought net ROAS to 2.3x against 2.2x break-even, R4')
  })

  it('never fires twice: any earlier R4 row blocks it, undone or not', () => {
    const prior = ev({ id: 8, ruleId: 'R4', action: 'revive', undone: true })
    expect(rulesOf(paused({ events: [r1Pause, prior] }))).toEqual([])
    const pending = ev({ id: 9, ruleId: 'R4', action: 'revive', appliedAt: null, appliedBy: null })
    expect(rulesOf(paused({ events: [r1Pause, pending] }))).toEqual([])
  })

  it('stays quiet while ROAS is under break-even', () => {
    expect(rulesOf(paused({ days: pausedDays(5000) }))).toEqual([])
  })

  it('stays quiet outside the revive window', () => {
    const old = ev({ id: 7, ruleId: 'R1', action: 'pause', appliedAt: `${ago(10)}T10:00:00Z` })
    expect(rulesOf(paused({ events: [old] }))).toEqual([])
  })

  it('needs an R1 or R3 pause behind it: an owner pause is not revived', () => {
    const manual = ev({ id: 7, ruleId: 'MAN', action: 'pause', appliedAt: `${ago(2)}T10:00:00Z` })
    expect(rulesOf(paused({ events: [manual] }))).toEqual([])
  })

  it('needs an order on or after the pause day', () => {
    const early = [...run(6, 3, { spendCents: 750, impressions: 400, clicks: 8 }), dp(3, { orders: 1, netRevenueCents: 9000 })]
    expect(rulesOf(paused({ days: early }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R5 scale: +20%, once per 72h, capped at the daily valve
// ---------------------------------------------------------------------------
describe('R5 scale', () => {
  // $3 a day for 7 days, three orders at $23 net: 3.3x net ROAS against 2.89x needed.
  const winning = (over: Partial<CreativeRuleInput> = {}, spend = 300, net = 2300) => {
    const d = run(6, 0, { spendCents: spend, impressions: 500, clicks: 15 })
    for (const i of [1, 3, 5]) d[i] = { ...d[i]!, orders: 1, netRevenueCents: net }
    return creative({ days: d, ...over })
  }

  it('fires at 1.3 x break-even ROAS with three orders', () => {
    const r = evalOne(winning()).firings
    expect(r.map(f => f.ruleId)).toEqual(['R5'])
    expect(r[0]).toMatchObject({ action: 'scale' })
    expect(r[0]!.inputs).toMatchObject({ upPct: 20, orders: 3 })
    expect(r[0]!.sentence).toBe('Scale: 3.3x net ROAS on 3 orders over 7d, R5')
  })

  it('stays quiet under three orders', () => {
    const d = run(6, 0, { spendCents: 300, impressions: 500, clicks: 15 })
    d[1] = { ...d[1]!, orders: 2, netRevenueCents: 9000 }
    expect(rulesOf(creative({ days: d }))).toEqual([])
  })

  it('holds for 72 hours after an applied scale, owner tap included', () => {
    expect(rulesOf(winning({ events: [ev({ ruleId: 'MAN', action: 'scale', appliedAt: hoursAgo(24) })] }))).toEqual([])
    expect(rulesOf(winning({ events: [ev({ ruleId: 'R5', action: 'scale', appliedAt: hoursAgo(80) })] }))).toEqual(['R5'])
  })

  it('does not count an undone scale or an unapplied recommendation against the cooldown', () => {
    expect(rulesOf(winning({ events: [ev({ action: 'scale', appliedAt: hoursAgo(24), undone: true })] }))).toEqual(['R5'])
    expect(rulesOf(winning({ events: [ev({ action: 'scale', appliedAt: null, appliedBy: null })] }))).toEqual(['R5'])
  })

  it('is capped at the daily valve: a smaller step when the cap is near', () => {
    // $18 a day against a $20 cap leaves room for 11%.
    const r = evalOne(winning({}, 1800, 14000)).firings
    expect(r[0]).toMatchObject({ ruleId: 'R5', action: 'scale' })
    expect(r[0]!.inputs).toMatchObject({ upPct: 11, capped: true })
    expect(r[0]!.sentence).toContain('+11%')
  })

  it('holds the scale at the cap and says why', () => {
    const r = evalOne(winning({}, 2000, 15000)).firings
    expect(r[0]).toMatchObject({ ruleId: 'R5', action: 'none', held: true })
    expect(r[0]!.sentence).toContain('Scale held')
    expect(r[0]!.sentence).toContain('$20.00 daily cap')
  })

  it('cappedScalePct is exact at the edges', () => {
    expect(cappedScalePct(1000, 2000, 20)).toEqual({ pct: 20, held: false })
    expect(cappedScalePct(1900, 2000, 20)).toEqual({ pct: 5, held: false })
    expect(cappedScalePct(2000, 2000, 20)).toEqual({ pct: 0, held: true })
    expect(cappedScalePct(1995, 2000, 20)).toEqual({ pct: 0, held: true })
  })
})

// ---------------------------------------------------------------------------
// R6 brake
// ---------------------------------------------------------------------------
describe('R6 brake', () => {
  // $6 a day for 7 days ($42), one $50 order five days ago: 1.2x over 7d, 0x over 3d.
  const slipping = (over: Partial<CreativeRuleInput> = {}) => {
    const d = run(6, 0, { spendCents: 600, impressions: 500, clicks: 15 })
    d[1] = { ...d[1]!, orders: 1, netRevenueCents: 5000 }
    return creative({ days: d, ...over })
  }

  it('fires when ROAS is under break-even in both the 3d and 7d windows', () => {
    const r = evalOne(slipping()).firings
    expect(r.map(f => f.ruleId)).toEqual(['R6'])
    expect(r[0]).toMatchObject({ action: 'brake' })
    expect(r[0]!.sentence).toContain('Brake: 0.0x net ROAS over 3d and 1.2x over 7d, both under 2.2x break-even, R6')
  })

  it('stays quiet when the 3d window is back above break-even', () => {
    const d = slipping().days
    d[4] = { ...d[4]!, orders: 1, netRevenueCents: 9000 }
    expect(rulesOf(creative({ days: d }))).toEqual([])
  })

  it('stays quiet below the minimum spend behind it', () => {
    const d = run(6, 0, { spendCents: 300, impressions: 500, clicks: 15 })
    d[1] = { ...d[1]!, orders: 1, netRevenueCents: 500 }
    expect(rulesOf(creative({ days: d }))).toEqual([])
  })

  it('waits out its own cooldown after an applied brake', () => {
    expect(rulesOf(slipping({ events: [ev({ action: 'brake', appliedAt: hoursAgo(10) })] }))).toEqual([])
  })

  it('a pause rule makes the brake moot', () => {
    const d = run(6, 0, { spendCents: 800, impressions: 500, clicks: 15 })
    d[1] = { ...d[1]!, orders: 1, netRevenueCents: 1000 }
    expect(rulesOf(creative({ days: d }))).toEqual(['R3'])
  })
})

// ---------------------------------------------------------------------------
// R7 account spend guard
// ---------------------------------------------------------------------------
describe('R7 spend guard', () => {
  // Seven prior days at $10 a day over 1,000 impressions: a $10 CPM.
  const history = run(7, 1, { spendCents: 1000, impressions: 1000, clicks: 20 })
  const live = [creative({ key: '1', creativeId: 1 }), creative({ key: '2', creativeId: 2 }), creative({ key: '3', creativeId: 3, paused: true })]
  const guard = (today: Partial<DailyPoint>, prior = history) =>
    evaluateRules({ creatives: live, accountDays: [...prior, dp(0, today)] }, settings, NOW)

  it('fires when today passes the daily cap and names the live creatives to pause', () => {
    const r = guard({ spendCents: 2500, impressions: 2500 })
    expect(r.r7).not.toBeNull()
    expect(r.r7!.trigger).toBe('spend')
    expect(r.r7!.pauseKeys).toEqual(['1', '2'])
    expect(r.r7!.sentence).toBe("R7 paused all: today's spend $25.00 passed the $20.00 daily cap")
    expect(r.firings.find(f => f.ruleId === 'R7')).toMatchObject({ action: 'pause', creativeId: null })
  })

  it('fires on CPM over 2x its 7-day median even under the cap', () => {
    const r = guard({ spendCents: 1900, impressions: 600 })
    expect(r.r7!.trigger).toBe('cpm')
    expect(r.r7!.sentence).toContain('CPM $31.67 is over 2x its 7-day median of $10.00')
  })

  it('reports both legs when both trip', () => {
    expect(guard({ spendCents: 2500, impressions: 1000 }).r7!.trigger).toBe('both')
  })

  it('stays quiet under the cap at a normal CPM', () => {
    expect(guard({ spendCents: 1500, impressions: 1500 }).r7).toBeNull()
  })

  it('leaves the CPM leg quiet without three days of history', () => {
    const thin = run(2, 1, { spendCents: 1000, impressions: 1000 })
    expect(guard({ spendCents: 1900, impressions: 600 }, thin).r7).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R8 fatigue
// ---------------------------------------------------------------------------
describe('R8 fatigue', () => {
  // 1,000 impressions a day; 25 clicks a day for the first 3 days, then `after`.
  const fading = (after: number, frequency: number | null) => {
    const d = run(6, 0, { impressions: 1000, clicks: after })
    for (let i = 0; i < 3; i++) d[i] = { ...d[i]!, clicks: 25 }
    return creative({ days: d, frequency })
  }
  it('fires when frequency passes 3 and CTR is down 30% from the first 3 days', () => {
    const r = evalOne(fading(10, 3.5)).firings
    expect(r.map(f => f.ruleId)).toEqual(['R8'])
    expect(r[0]).toMatchObject({ action: 'refresh' })
    expect(r[0]!.sentence).toBe('Refresh: frequency 3.5, CTR down 34% from its first 3 days, R8')
  })
  it('stays quiet at a low frequency', () => expect(rulesOf(fading(10, 2.5))).toEqual([]))
  it('stays quiet when frequency is not known', () => expect(rulesOf(fading(10, null))).toEqual([]))
  it('stays quiet when CTR held up', () => expect(rulesOf(fading(20, 3.5))).toEqual([]))
})

// ---------------------------------------------------------------------------
// The sample dataset through the real engine
// ---------------------------------------------------------------------------
describe('sample dataset', () => {
  it('fires R1, R2, R5 and R8 each on one creative and nothing on the rest', () => {
    const fired: Record<string, string[]> = {}
    for (const c of sampleDataset().creatives) {
      for (const f of evaluateSampleCreative(c, settings)) (fired[f.ruleId] ??= []).push(c.key)
    }
    expect(fired).toEqual({ R1: ['S1'], R2: ['S2'], R5: ['S3'], R8: ['S4'] })
  })
  it('uses the sample clock', () => {
    expect(sampleNow().toISOString()).toBe('2026-10-03T23:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// Persistence plan
// ---------------------------------------------------------------------------
describe('planPersistence', () => {
  const firing = (ruleId: string, creativeId: number, action = 'pause') =>
    ({ ruleId, creativeId, creativeKey: String(creativeId), action, sentence: `${ruleId} on ${creativeId}`, inputs: {} }) as never
  const pending = (id: number, ruleId: string, creativeId: number, action = 'pause', appliedAt: string | null = null) =>
    ({ id, ruleId, creativeId, action, appliedAt })

  it('inserts a new firing and refreshes one already on file instead of writing a second row', () => {
    const plan = planPersistence({
      firings: [firing('R1', 1), firing('R2', 2)],
      evaluatedCreativeIds: new Set([1, 2]),
      pending: [pending(10, 'R1', 1)],
    })
    expect(plan.refresh.map(r => r.id)).toEqual([10])
    expect(plan.inserts.map(f => f.ruleId)).toEqual(['R2'])
    expect(plan.clear).toEqual([])
  })

  it('clears a recommendation whose rule stopped firing, but never an applied row', () => {
    const plan = planPersistence({
      firings: [],
      evaluatedCreativeIds: new Set([1]),
      pending: [pending(10, 'R3', 1), pending(11, 'R1', 1, 'pause', '2026-10-02T00:00:00Z'), pending(12, 'MAN', 1, 'pause')],
    })
    expect(plan.clear).toEqual([10])
  })

  it('leaves a creative it did not evaluate alone', () => {
    const plan = planPersistence({ firings: [], evaluatedCreativeIds: new Set([2]), pending: [pending(10, 'R3', 1)] })
    expect(plan.clear).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// runRulesDaily: R1 recommends, R7 applies
// ---------------------------------------------------------------------------
describe('runRulesDaily', () => {
  beforeEach(() => {
    mem.tables.clear(); mem.inserts.length = 0; mem.updates.length = 0; mem.settings.clear(); mem.nextId = 100
    fileBlocker.mockClear()
    setPlatformApplier(null)
    mem.tables.set(adCreatives, [
      { id: 1, creativeId: 1, pausedAt: null, launchedAt: null, budgetMultiplier: '1', lane: 'google', externalAdId: null, pauseReason: null },
      { id: 2, creativeId: 2, pausedAt: null, launchedAt: null, budgetMultiplier: '1', lane: 'meta', externalAdId: null, pauseReason: null },
    ])
  })

  const metricRow = (creativeId: number, day: string, o: Record<string, number> = {}) => ({
    creativeId, day, platform: 'google', spendCents: 0, impressions: 400, clicks: 12, orders: 0, netRevenueCents: 0, ...o,
  })
  const seedMetricsTable = async () => {
    const { adCreativeDailyMetrics } = await import('../../db/schema')
    return adCreativeDailyMetrics
  }

  it('writes an unapplied recommendation per firing and no platform call in simulation', async () => {
    const metrics = await seedMetricsTable()
    mem.tables.set(metrics, Array.from({ length: 7 }, (_, i) => metricRow(1, ago(6 - i), { spendCents: 500 })))
    const applier = vi.fn(async () => ({ applied: true, note: 'x' }))
    setPlatformApplier(applier)

    const out = await runRulesDaily(NOW)

    expect(out.simulated).toBe(true)
    expect(out.fired.map(f => f.ruleId)).toEqual(['R1'])
    const rows = mem.inserts.filter(i => i.table === adRuleEvents).map(i => i.values)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ruleId: 'R1', creativeId: 1, action: 'pause', appliedBy: null, appliedAt: null })
    expect((rows[0]!['detail'] as { sentence: string }).sentence).toBe('Pause: $35.00 spent in 7d, 0 orders, R1')
    expect(mem.updates.filter(u => u.table === adCreatives)).toHaveLength(0)
    expect(applier).not.toHaveBeenCalled()
    expect(fileBlocker).not.toHaveBeenCalled()
  })

  it('auto-applies R7: records applied_by rule:R7, pauses every live creative, raises the alert once', async () => {
    const metrics = await seedMetricsTable()
    mem.tables.set(metrics, [
      metricRow(1, ago(0), { spendCents: 1500, impressions: 1500, clicks: 60 }),
      metricRow(2, ago(0), { spendCents: 1000, impressions: 1000, clicks: 40 }),
    ])
    const applier = vi.fn(async () => ({ applied: true, note: 'x' }))
    setPlatformApplier(applier)

    const first = await runRulesDaily(NOW)

    expect(first.r7).toMatchObject({ trigger: 'spend', pausedCreatives: 2, alert: 'filed' })
    const r7 = mem.inserts.filter(i => i.table === adRuleEvents).map(i => i.values).find(v => v['ruleId'] === 'R7')!
    expect(r7).toMatchObject({ action: 'pause', creativeId: null, appliedBy: 'rule:R7' })
    expect(r7['appliedAt']).toBeInstanceOf(Date)
    const pause = mem.updates.find(u => u.table === adCreatives)!
    expect(pause.set['pausedAt']).toEqual(NOW)
    expect(pause.set['pauseReason']).toBe("R7 paused all: today's spend $25.00 passed the $20.00 daily cap")
    expect(fileBlocker).toHaveBeenCalledTimes(1)
    const blocker = (fileBlocker.mock.calls[0] as unknown as [{ dedupeKey: string; category: string }])[0]
    expect(blocker.dedupeKey).toBe('ads-r7-spend-guard-2026-10-03')
    expect(blocker.category).toBe('approval')
    // Simulation: recorded, no platform call.
    expect(applier).not.toHaveBeenCalled()

    // A second run the same day does not apply or alert again.
    const second = await runRulesDaily(NOW)
    expect(second.r7).toBeNull()
    expect(fileBlocker).toHaveBeenCalledTimes(1)
  })

  it('calls the platform seam for R7 only when the spend valve is on', async () => {
    const metrics = await seedMetricsTable()
    mem.tables.set(metrics, [metricRow(1, ago(0), { spendCents: 2500, impressions: 2500, clicks: 100 })])
    mem.settings.set('ads_spend_enabled', 'true')
    const applier = vi.fn(async () => ({ applied: true, note: 'paused' }))
    setPlatformApplier(applier)
    const out = await runRulesDaily(NOW)
    expect(out.simulated).toBe(false)
    expect(applier).toHaveBeenCalledWith(expect.objectContaining({ creativeId: 1, action: 'pause' }))
  })
})

// ---------------------------------------------------------------------------
// applyRuleAction: what a Live tap does
// ---------------------------------------------------------------------------
describe('applyRuleAction', () => {
  beforeEach(() => {
    mem.tables.clear(); mem.inserts.length = 0; mem.updates.length = 0; mem.settings.clear(); mem.nextId = 500
    setPlatformApplier(null)
  })
  const seed = (over: Record<string, unknown> = {}) =>
    mem.tables.set(adCreatives, [{ id: 9, pausedAt: null, pauseReason: null, budgetMultiplier: '1', externalAdId: 'ext-9', lane: 'google', ...over }])

  it('pause sets paused_at and pause_reason and writes an applied event with a before snapshot', async () => {
    seed()
    const r = await applyRuleAction(9, 'pause', 'owner@xdipx.com', { ruleId: 'R1', reason: 'Pause: $31.00 spent in 7d, 0 orders, R1', now: NOW })
    expect(r.simulated).toBe(true)
    expect(r.message).toBe('Paused #9 in simulation. Nothing was live.')
    expect(mem.updates[0]!.set).toMatchObject({ pausedAt: NOW, pauseReason: 'Pause: $31.00 spent in 7d, 0 orders, R1' })
    const row = mem.inserts.find(i => i.table === adRuleEvents)!.values
    expect(row).toMatchObject({ ruleId: 'R1', creativeId: 9, action: 'pause', appliedBy: 'owner@xdipx.com' })
    expect(row['detail']).toMatchObject({ simulation: true, before: { pausedAt: null, budgetMultiplier: 1 } })
  })

  it('scale multiplies the budget by 1.2 and brake by 0.7', async () => {
    seed()
    const up = await applyRuleAction(9, 'scale', 'owner', { now: NOW })
    expect(up.budgetMultiplier).toBe(1.2)
    expect(up.message).toBe('Scaled #9 budget 20% in simulation.')
    expect(mem.updates[0]!.set['budgetMultiplier']).toBe('1.2')
    mem.updates.length = 0
    seed({ budgetMultiplier: '1.2' })
    const down = await applyRuleAction(9, 'brake', 'owner', { now: NOW })
    expect(down.budgetMultiplier).toBe(0.84)
    expect(nextMultiplier(1, 'brake', 30)).toBe(0.7)
  })

  it('resume clears paused_at and pause_reason; R4 records a revive', async () => {
    seed({ pausedAt: new Date('2026-10-01T00:00:00Z'), pauseReason: 'R1' })
    await applyRuleAction(9, 'resume', 'owner', { ruleId: 'R4', now: NOW })
    expect(mem.updates[0]!.set).toMatchObject({ pausedAt: null, pauseReason: null })
    expect(mem.inserts.find(i => i.table === adRuleEvents)!.values['action']).toBe('revive')
  })

  it('refuses a pause on a paused creative and a scale on a paused one', async () => {
    seed({ pausedAt: new Date('2026-10-01T00:00:00Z') })
    await expect(applyRuleAction(9, 'pause', 'owner')).rejects.toThrow(/already paused/)
    await expect(applyRuleAction(9, 'scale', 'owner')).rejects.toThrow(/Resume it first/)
  })

  it('calls the platform seam only with the spend valve on, and reports a failed call without losing the change', async () => {
    const applier = vi.fn(async () => { throw new Error('Meta said no') })
    setPlatformApplier(applier)
    seed()
    await applyRuleAction(9, 'pause', 'owner', { now: NOW })
    expect(applier).not.toHaveBeenCalled()

    mem.settings.set('ads_spend_enabled', 'true')
    mem.inserts.length = 0; mem.updates.length = 0
    seed()
    const live = await applyRuleAction(9, 'pause', 'owner', { now: NOW })
    expect(applier).toHaveBeenCalledWith(expect.objectContaining({ creativeId: 9, externalAdId: 'ext-9', action: 'pause' }))
    expect(live.simulated).toBe(false)
    expect(live.message).toBe('Paused #9. The platform call failed: Meta said no')
    expect(mem.updates[0]!.set['pausedAt']).toEqual(NOW)
  })
})

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
describe('rule recipes', () => {
  it('shows every rule once with the revive partner directly under R1', () => {
    const ids = RECIPE_ORDER.flatMap(r => (r.underneath ? [r.rule, r.underneath] : [r.rule])).sort()
    expect(ids).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
    expect(RECIPE_ORDER[0]).toEqual({ rule: 'R1', underneath: 'R4' })
    expect(RULE_RECIPES.R1.revive).toBe('R4')
    expect(RULE_RECIPES.R3.revive).toBe('R4')
  })

  it('every editable number is a real setting key with a sane range', () => {
    for (const id of Object.keys(RULE_RECIPES) as Array<keyof typeof RULE_RECIPES>) {
      for (const f of recipeFields(id)) {
        expect(f.key in ADS_RULE_DEFAULTS).toBe(true)
        expect(f.key.length).toBeLessThanOrEqual(50)
        const d = ADS_RULE_DEFAULTS[f.key]
        expect(d).toBeGreaterThanOrEqual(f.min)
        expect(d).toBeLessThanOrEqual(f.max)
      }
    }
  })

  it('validates values against the field range', () => {
    expect(validateRuleValue('ads_rule_r1_be_multiple', '2.5')).toBe(2.5)
    expect(validateRuleValue('ads_rule_r1_be_multiple', '0')).toBeNull()
    expect(validateRuleValue('ads_rule_r1_be_multiple', 'abc')).toBeNull()
    expect(validateRuleValue('ads_rule_r6_budget_down_pct', 95)).toBeNull()
  })
})
