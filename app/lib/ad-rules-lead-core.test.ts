import { describe, expect, it } from 'vitest'
import { ADS_RULE_DEFAULTS } from '~/lib/ad-settings-defaults'
import { buildCreativeIndex, computeBreakEven, type DailyPoint } from '~/lib/ad-metrics-core'
import {
  evaluateRules,
  type CreativeRuleInput, type RuleEventHistory, type RulesSettings, type RulesWindow,
} from '~/lib/ad-rules-core'
import {
  accountLeadToOrder, buildLeadCohorts, classifyObjective, evaluateFunnelBreak, resolveObjectives,
  type CohortLead, type HealthSample, type LeadAccountInputs, type LeadDay, type MirrorEntity,
} from '~/lib/ad-rules-lead-core'

// Fixtures. The clock, day helpers and settings match ad-rules.server.test.ts.
const NOW = new Date('2026-10-03T15:00:00Z')
const HOUR = 3_600_000
const DAY = 86_400_000
const ago = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10)
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString()

const dp = (daysAgo: number, o: Partial<DailyPoint> = {}): DailyPoint => ({
  day: ago(daysAgo), spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0, ...o,
})
const run = (from: number, to: number, o: Partial<DailyPoint> = {}): DailyPoint[] =>
  Array.from({ length: from - to + 1 }, (_, i) => dp(from - i, o))
const ld = (daysAgo: number, o: Partial<LeadDay> = {}): LeadDay => ({ day: ago(daysAgo), leads: null, linkClicks: null, landingViews: null, ...o })
const leadRun = (from: number, to: number, o: Partial<LeadDay> = {}): LeadDay[] =>
  Array.from({ length: from - to + 1 }, (_, i) => ld(from - i, o))
const cohortOf = (n: number, daysAgo: number, o: Partial<CohortLead> = {}): CohortLead[] =>
  Array.from({ length: n }, () => ({ capturedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(), converted: false, revenueCents: 0, ...o }))

const ev = (over: Partial<RuleEventHistory> = {}): RuleEventHistory => ({
  id: 1, ruleId: 'MAN', action: 'pause', firedAt: hoursAgo(24), appliedAt: hoursAgo(24), appliedBy: 'owner', undone: false, ...over,
})

const settings: RulesSettings = {
  thresholds: { ...ADS_RULE_DEFAULTS },
  breakEven: computeBreakEven(3300, 45),
  dailyCapCents: 2000,
  leadCplCeilingCents: 800, // $8: L1 at $24, L2 at $12 CPL or $40 spend, L5 at $5.60 CPL
}

const base = (over: Partial<CreativeRuleInput> = {}): CreativeRuleInput => ({
  key: '1', creativeId: 1, label: '#1', paused: false, launchedAt: null, frequency: null, budgetMultiplier: 1, days: [], events: [], ...over,
})
const leadAd = (over: Partial<CreativeRuleInput> = {}, lead: Partial<NonNullable<CreativeRuleInput['lead']>> = {}): CreativeRuleInput =>
  base({ objective: 'leads', adsetExternalId: 'set-1', ...over, lead: { days: [], cohort: null, quality: null, ...lead } })

const evalAll = (creatives: CreativeRuleInput[], lead: LeadAccountInputs | null = null, s: RulesSettings = settings) =>
  evaluateRules({ creatives, accountDays: [], lead } satisfies RulesWindow, s, NOW)
const rulesOf = (c: CreativeRuleInput, lead: LeadAccountInputs | null = null) => evalAll([c], lead).firings.map(f => f.ruleId)
const acct = (rate: number | null): LeadAccountInputs => ({ leadToOrder14d: rate, leads14d: rate == null ? null : 100, healthSamples: [] })

// ---------------------------------------------------------------------------
// Objective lookup
// ---------------------------------------------------------------------------
describe('objective lookup through the mirror', () => {
  const ent = (level: string, externalId: string, parent: string | null, objective: string | null = null, creativeId: number | null = null): MirrorEntity =>
    ({ platform: 'meta', level, externalId, parentExternalId: parent, objective, creativeId })
  const mirror = [
    ent('campaign', 'c-leads', null, 'OUTCOME_LEADS'),
    ent('campaign', 'c-sales', null, 'OUTCOME_SALES'),
    ent('campaign', 'c-traffic', null, 'OUTCOME_TRAFFIC'),
    ent('adset', 'as-leads', 'c-leads'),
    ent('adset', 'as-sales', 'c-sales'),
    ent('adset', 'as-traffic', 'c-traffic'),
    ent('adset', 'as-orphan', 'c-missing'),
    ent('ad', 'ad-1', 'as-leads'),
    ent('ad', 'ad-2', 'as-sales'),
    ent('ad', 'ad-3', 'as-traffic'),
    ent('ad', 'ad-4', 'as-orphan'),
    ent('ad', 'ad-5', 'as-leads', null, 5),
  ]
  const out = resolveObjectives([
    { creativeId: 1, externalAdId: 'ad-1' },
    { creativeId: 2, externalAdId: 'ad-2' },
    { creativeId: 3, externalAdId: 'ad-3' },
    { creativeId: 4, externalAdId: 'ad-4' },
    { creativeId: 5, externalAdId: null },
    { creativeId: 6, externalAdId: 'ad-gone' },
    { creativeId: 7, externalAdId: null },
  ], mirror)

  it('walks ad to ad set to campaign and reads the objective there', () => {
    expect(out.get(1)).toMatchObject({ objective: 'leads', rawObjective: 'OUTCOME_LEADS', adsetExternalId: 'as-leads', campaignExternalId: 'c-leads' })
    expect(out.get(2)).toMatchObject({ objective: 'sales', rawObjective: 'OUTCOME_SALES' })
    expect(out.get(3)).toMatchObject({ objective: 'other', rawObjective: 'OUTCOME_TRAFFIC' })
  })

  it("falls back to the mirror's creative link when the creative has no external_ad_id", () => {
    expect(out.get(5)).toMatchObject({ objective: 'leads', adExternalId: 'ad-5' })
  })

  it('reports unknown, with the reason, when the chain breaks', () => {
    expect(out.get(4)).toMatchObject({ objective: 'unknown', note: 'campaign not in the mirror' })
    expect(out.get(6)).toMatchObject({ objective: 'unknown', note: 'ad not in the mirror' })
    expect(out.get(7)).toMatchObject({ objective: 'unknown', note: 'no external_ad_id' })
  })

  it('classifies the legacy lead objective too, and nothing else as leads', () => {
    expect(classifyObjective('LEAD_GENERATION')).toBe('leads')
    expect(classifyObjective('outcome_leads')).toBe('leads')
    expect(classifyObjective('CONVERSIONS')).toBe('sales')
    expect(classifyObjective('OUTCOME_AWARENESS')).toBe('other')
    expect(classifyObjective(null)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Rule set selection
// ---------------------------------------------------------------------------
describe('rule set selection', () => {
  // Two weeks at $10 a day, 1,500 impressions and 30 clicks a day, no orders: on a
  // sales campaign that is a textbook R1. On a lead campaign at 3 leads a day it is
  // a $3.33 CPL against an $8 ceiling, which is healthy list building.
  const days = run(13, 0, { spendCents: 1000, impressions: 1500, clicks: 30 })
  const leadsCampaign = leadAd({ days }, { days: leadRun(13, 0, { leads: 3 }) })

  it('a Leads campaign with 0 orders and a healthy CPL fires no R1, R3, R5 or R6', () => {
    const fired = rulesOf(leadsCampaign, acct(null))
    for (const r of ['R1', 'R3', 'R5', 'R6']) expect(fired).not.toContain(r)
    expect(fired).toEqual([])
  })

  it('the same numbers on a sales or unknown campaign still fire R1 and R3, exactly as before', () => {
    const plain = base({ days })
    expect(rulesOf(plain)).toEqual(['R1', 'R3'])
    expect(rulesOf({ ...plain, objective: 'unknown' })).toEqual(['R1', 'R3'])
    expect(rulesOf({ ...plain, objective: 'other' })).toEqual(['R1', 'R3'])
  })

  it('a Sales fixture produces exactly the firings it produced before objectives existed', () => {
    const fixtures: CreativeRuleInput[] = [
      base({ key: '1', creativeId: 1, days: run(6, 0, { spendCents: 500, impressions: 400, clicks: 8 }) }), // R1
      base({ key: '2', creativeId: 2, days: [dp(0, { spendCents: 100, impressions: 2500, clicks: 5 })] }), // R2
      base({ key: '3', creativeId: 3, days: run(6, 0, { spendCents: 1000, impressions: 1000, clicks: 30, orders: 1, netRevenueCents: 1000 }) }), // R3
      base({ key: '4', creativeId: 4, days: run(6, 0, { spendCents: 1000, impressions: 1000, clicks: 30, orders: 1, netRevenueCents: 4000 }) }), // R5
    ]
    const before = evaluateRules({ creatives: fixtures, accountDays: [] }, settings, NOW)
    const after = evaluateRules({ creatives: fixtures.map(c => ({ ...c, objective: 'sales' as const })), accountDays: [], lead: acct(0.5) }, settings, NOW)
    expect(after).toEqual(before)
    expect(before.firings.map(f => `${f.creativeKey}:${f.ruleId}`)).toEqual(['1:R1', '2:R2', '3:R3', '4:R5'])
  })

  it('every lead firing is labeled with its rule set', () => {
    const c = leadAd({ days: run(6, 0, { spendCents: 400, impressions: 300, clicks: 6 }) }, { days: leadRun(6, 0, { leads: 0 }) })
    expect(evalAll([c]).firings[0]!.inputs['ruleSet']).toBe('leads')
  })
})

// ---------------------------------------------------------------------------
// L1 zero-lead kill
// ---------------------------------------------------------------------------
describe('L1 zero-lead kill', () => {
  // $4 a day for 7 days = $28, past 3 x $8. 2,100 impressions, 159h live, 0 leads.
  const days = run(6, 0, { spendCents: 400, impressions: 300, clicks: 6 })
  const zero = () => leadAd({ days }, { days: leadRun(6, 0, { leads: 0 }) })

  it('fires at 3x the CPL ceiling with 0 leads, and states the inputs', () => {
    const r = evalAll([zero()]).firings
    expect(r.map(f => f.ruleId)).toEqual(['L1'])
    expect(r[0]).toMatchObject({ action: 'pause', creativeId: 1 })
    expect(r[0]!.sentence).toBe('Pause: $28.00 spent in 7d with 0 leads, past 3x the $8.00 CPL ceiling, L1')
    expect(r[0]!.inputs).toMatchObject({ spendCents: 2800, leads: 0, ceilingCents: 800, impressions: 2100 })
  })

  it('follows the ceiling valve', () => {
    expect(evalAll([zero()], null, { ...settings, leadCplCeilingCents: 1000 }).firings).toEqual([])
  })

  it('floor: needs 1,000 impressions', () => {
    const thin = leadAd({ days: run(6, 0, { spendCents: 400, impressions: 100, clicks: 2 }) }, { days: leadRun(6, 0, { leads: 0 }) })
    expect(rulesOf(thin)).toEqual([])
  })

  it('floor: needs 48h live', () => {
    expect(rulesOf({ ...zero(), launchedAt: hoursAgo(30) })).toEqual([])
  })

  it('never fires on leads it could not read', () => {
    expect(rulesOf(leadAd({ days }))).toEqual([])
  })

  it('a Klaviyo lead counts even when the platform says 0', () => {
    expect(rulesOf(leadAd({ days }, { days: leadRun(6, 0, { leads: 0 }), cohort: cohortOf(1, 2) }))).toEqual([])
  })

  it('is one-shot: once applied it never fires again, undone or not', () => {
    expect(rulesOf({ ...zero(), events: [ev({ ruleId: 'L1', action: 'pause', appliedAt: hoursAgo(400), undone: true })] })).toEqual([])
  })

  it('an unapplied L1 row on file does not block it, so the daily refresh keeps one row', () => {
    expect(rulesOf({ ...zero(), events: [ev({ ruleId: 'L1', action: 'pause', appliedAt: null })] })).toEqual(['L1'])
  })
})

// ---------------------------------------------------------------------------
// L2 CPL ceiling
// ---------------------------------------------------------------------------
describe('L2 CPL ceiling', () => {
  // $14.30 a day for 7 days on 6 leads: a $16.68 CPL, over 1.5 x $8.
  const hot = (key: string, set = 'set-1') => leadAd(
    { key, creativeId: Number(key), adsetExternalId: set, days: run(6, 0, { spendCents: 1430, impressions: 1000, clicks: 20 }) },
    { days: [...leadRun(6, 1, { leads: 1 }), ld(0, { leads: 0 })] },
  )
  // $10 a day on 21 leads: a $3.33 CPL.
  const healthy = (key: string, set = 'set-1') => leadAd(
    { key, creativeId: Number(key), adsetExternalId: set, days: run(6, 0, { spendCents: 1000, impressions: 1000, clicks: 20 }) },
    { days: leadRun(6, 0, { leads: 3 }) },
  )

  it('pauses the ad when a sibling in the set is healthy', () => {
    const r = evalAll([hot('1'), healthy('2')]).firings
    expect(r.map(f => `${f.creativeKey}:${f.ruleId}:${f.action}`)).toEqual(['1:L2:pause'])
    expect(r[0]!.sentence).toBe('Pause: 7d CPL $16.68 on 6 leads, over 1.5x the $8.00 CPL ceiling, L2')
    expect(r[0]!.inputs).toMatchObject({ cplCents: 1668, leads: 6, spend7Cents: 10010, ceilingCents: 800, scope: 'ad', adsetExternalId: 'set-1' })
  })

  it('brakes the whole set 30% when every live ad in it breaches', () => {
    const r = evalAll([hot('1'), hot('2'), { ...healthy('3'), paused: true }]).firings
    expect(r.map(f => `${f.creativeKey}:${f.ruleId}:${f.action}`)).toEqual(['1:L2:brake', '2:L2:brake'])
    expect(r[0]!.inputs).toMatchObject({ downPct: 30, scope: 'adset', adsInSet: 2 })
    expect(r[0]!.sentence).toContain('Brake the ad set 30%: every live ad in it is over 1.5x the $8.00 CPL ceiling')
  })

  it('judges each ad set on its own', () => {
    const r = evalAll([hot('1', 'set-a'), healthy('2', 'set-b')]).firings
    expect(r.map(f => `${f.creativeKey}:${f.action}`)).toEqual(['1:brake'])
  })

  it('floor: under 5 leads and under 5x the ceiling spent, no verdict', () => {
    const thin = leadAd({ days: run(6, 0, { spendCents: 300, impressions: 1000, clicks: 20 }) }, { days: [ld(0, { leads: 1 })] })
    expect(rulesOf(thin)).toEqual([])
  })

  it('floor: 5x the ceiling spent counts even on 2 leads', () => {
    const spendy = leadAd({ days: run(6, 0, { spendCents: 600, impressions: 1000, clicks: 20 }) }, { days: [ld(1, { leads: 1 }), ld(0, { leads: 1 })] })
    const r = evalAll([spendy, healthy('2')]).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L2:pause'])
    expect(r[0]!.inputs).toMatchObject({ cplCents: 2100, leads: 2 })
  })

  it('cooldown: 72h per ad set, whichever ad in it was acted on', () => {
    const recent = { ...healthy('2'), events: [ev({ ruleId: 'L2', action: 'brake', appliedAt: hoursAgo(24) })] }
    expect(evalAll([hot('1'), recent]).firings).toEqual([])
    const old = { ...healthy('2'), events: [ev({ ruleId: 'L2', action: 'brake', appliedAt: hoursAgo(80) })] }
    expect(evalAll([hot('1'), old]).firings.map(f => f.ruleId)).toEqual(['L2'])
  })
})

// ---------------------------------------------------------------------------
// L3 funnel break
// ---------------------------------------------------------------------------
describe('L3 funnel break', () => {
  const s = (hours: number, key: string, value: number): HealthSample => ({ sampledAt: hoursAgo(hours), key, value })

  it('fires on 30 landing views in 6h with 0 successful lead posts', () => {
    const fb = evaluateFunnelBreak([s(1, 'landing_views', 20), s(3, 'landing_views', 15), s(1, 'lead_posts_ok', 0), s(3, 'lead_posts_ok', 0)], NOW)
    expect(fb).toMatchObject({ trigger: 'no_lead_posts', sentence: 'Pause all: 35 landing views in 6h and 0 successful lead posts, L3' })
  })

  it('stays quiet under 30 views, with a lead post, outside 6h, or with no lead-post counter at all', () => {
    expect(evaluateFunnelBreak([s(1, 'landing_views', 25), s(1, 'lead_posts_ok', 0)], NOW)).toBeNull()
    expect(evaluateFunnelBreak([s(1, 'landing_views', 40), s(1, 'lead_posts_ok', 1)], NOW)).toBeNull()
    expect(evaluateFunnelBreak([s(7, 'landing_views', 40), s(1, 'lead_posts_ok', 0)], NOW)).toBeNull()
    expect(evaluateFunnelBreak([s(1, 'landing_views', 40)], NOW)).toBeNull()
  })

  it('fires on /hello non-200 on 2 consecutive probes, and only then', () => {
    expect(evaluateFunnelBreak([s(2, 'hello_status', 500), s(1, 'hello_status', 503)], NOW)).toMatchObject({ trigger: 'hello_down' })
    expect(evaluateFunnelBreak([s(2, 'hello_status', 500), s(1, 'hello_status', 200)], NOW)).toBeNull()
    expect(evaluateFunnelBreak([s(1, 'hello_status', 500)], NOW)).toBeNull()
  })

  it('pauses every live lead ad and makes their other rows moot; sales ads are untouched', () => {
    const lead1 = leadAd({ key: '1', creativeId: 1 })
    const lead2 = leadAd({ key: '2', creativeId: 2, days: run(6, 0, { spendCents: 400, impressions: 300, clicks: 6 }) }, { days: leadRun(6, 0, { leads: 0 }) })
    const sales = base({ key: '9', creativeId: 9, days: run(6, 0, { spendCents: 500, impressions: 400, clicks: 8 }) })
    const lead = { leadToOrder14d: null, leads14d: null, healthSamples: [s(2, 'hello_status', 500), s(1, 'hello_status', 500)] }
    const r = evalAll([lead1, lead2, { ...leadAd({ key: '3', creativeId: 3 }), paused: true }, sales], lead).firings
    expect(r.map(f => `${f.creativeKey}:${f.ruleId}`).sort()).toEqual(['1:L3', '2:L3', '9:R1'])
  })

  it('stays quiet with no samples, which is every run until phase 2d builds them', () => {
    expect(evaluateFunnelBreak([], NOW)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// L4 click leak
// ---------------------------------------------------------------------------
describe('L4 click leak', () => {
  // $1 a day, 1 lead a day (a $1 CPL), 500 impressions: quiet on every other rule.
  const leak = (clicks: number, views: number, events: RuleEventHistory[] = []) => leadAd(
    { days: run(6, 0, { spendCents: 100, impressions: 500, clicks: 12 }), events },
    { days: leadRun(6, 0, { leads: 1, linkClicks: clicks, landingViews: views }) },
  )

  it('fires when 50 or more outbound clicks bring landing views under 60%', () => {
    const r = evalAll([leak(10, 5)]).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L4:flag'])
    expect(r[0]!.sentence).toBe('Check landing speed: 35 landing views from 70 outbound clicks over 7d is 50%, under 60%, L4')
  })

  it('floor: under 50 clicks, no verdict', () => expect(rulesOf(leak(7, 2))).toEqual([]))
  it('stays quiet at a healthy landing rate', () => expect(rulesOf(leak(10, 7))).toEqual([]))
  it('stays quiet when landing views were not read', () => {
    const c = leadAd({ days: run(6, 0, { spendCents: 100, impressions: 500, clicks: 12 }) }, { days: leadRun(6, 0, { leads: 1, linkClicks: 10 }) })
    expect(rulesOf(c)).toEqual([])
  })

  it('cooldown: 7d after an applied L4', () => {
    expect(rulesOf(leak(10, 5, [ev({ ruleId: 'L4', action: 'flag', appliedAt: hoursAgo(72) })]))).toEqual([])
    expect(rulesOf(leak(10, 5, [ev({ ruleId: 'L4', action: 'flag', appliedAt: hoursAgo(200) })]))).toEqual(['L4'])
  })
})

// ---------------------------------------------------------------------------
// L5 scale
// ---------------------------------------------------------------------------
describe('L5 scale', () => {
  // $5 a day on 2 leads a day: a $2.50 CPL on 14 leads, under 0.7 x $8.
  const good = (events: RuleEventHistory[] = [], leadsPerDay = 2) => leadAd(
    { days: run(6, 0, { spendCents: 500, impressions: 1000, clicks: 20 }), events },
    { days: leadRun(6, 0, { leads: leadsPerDay }) },
  )

  it('scales +20% at a low CPL when the account turns at least 3% of 14d leads into orders', () => {
    const r = evalAll([good()], acct(0.04)).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L5:scale'])
    expect(r[0]!.sentence).toBe("Scale +20%: 7d CPL $2.50 on 14 leads is under 0.7x the $8.00 ceiling, and 4% of the account's 14d leads ordered, L5")
    expect(r[0]!.inputs).toMatchObject({ cplCents: 250, leads: 14, upPct: 20, leadToOrder14d: 0.04 })
  })

  it('needs the account lead-to-order: under 3%, or unread, it stays quiet', () => {
    expect(rulesOf(good(), acct(0.02))).toEqual([])
    expect(rulesOf(good(), acct(null))).toEqual([])
    expect(rulesOf(good(), null)).toEqual([])
  })

  it('floor: 10 leads', () => expect(rulesOf(good([], 1), acct(0.04))).toEqual([]))

  it('cooldown: 72h after an applied scale', () => {
    expect(rulesOf(good([ev({ ruleId: 'L5', action: 'scale', appliedAt: hoursAgo(24) })]), acct(0.04))).toEqual([])
    expect(rulesOf(good([ev({ ruleId: 'L5', action: 'scale', appliedAt: hoursAgo(80) })]), acct(0.04))).toEqual(['L5'])
  })

  it('stays inside the daily cap', () => {
    const r = evalAll([good()], acct(0.04), { ...settings, dailyCapCents: 550 }).firings
    expect(r[0]!.inputs).toMatchObject({ upPct: 10, capped: true })
  })
})

// ---------------------------------------------------------------------------
// L6 lead quality
// ---------------------------------------------------------------------------
describe('L6 lead quality', () => {
  const q = (rate: number) => ({ rate, accountMedian: 0.3, metric: 'email1_click' as const })
  const cohortAd = (cohort: CohortLead[], quality: ReturnType<typeof q> | null, events: RuleEventHistory[] = []) => leadAd(
    { days: run(6, 0, { spendCents: 300, impressions: 1000, clicks: 20 }), events },
    { days: leadRun(6, 0, { leads: 2 }), cohort, quality },
  )

  it('fires when a 20-lead, 7-day cohort clicks email 1 at under half the account median', () => {
    const r = evalAll([cohortAd(cohortOf(25, 10), q(0.1))]).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L6:refresh'])
    expect(r[0]!.sentence).toBe('Deprioritize and refresh the brief: email-1 click rate 10% on a 25-lead cohort is under half the 30% account median, L6')
  })

  it('never fires while the quality input is unread, which is today', () => {
    expect(rulesOf(cohortAd(cohortOf(25, 10), null))).toEqual([])
  })

  it('floors: 20 leads, 7 days old', () => {
    expect(rulesOf(cohortAd(cohortOf(15, 10), q(0.1)))).toEqual([])
    expect(rulesOf(cohortAd(cohortOf(25, 3), q(0.1)))).toEqual([])
  })

  it('stays quiet at half the median or better', () => expect(rulesOf(cohortAd(cohortOf(25, 10), q(0.2)))).toEqual([]))

  it('cooldown: 14d after an applied L6', () => {
    expect(rulesOf(cohortAd(cohortOf(25, 10), q(0.1), [ev({ ruleId: 'L6', action: 'refresh', appliedAt: hoursAgo(120) })]))).toEqual([])
    expect(rulesOf(cohortAd(cohortOf(25, 10), q(0.1), [ev({ ruleId: 'L6', action: 'refresh', appliedAt: hoursAgo(15 * 24) })]))).toEqual(['L6'])
  })
})

// ---------------------------------------------------------------------------
// L7 cohort verdict
// ---------------------------------------------------------------------------
describe('L7 cohort verdict', () => {
  // $5 a day for 41 days. 45 Klaviyo leads captured 35 days ago. Spend up to the
  // 30-day cut is 11 days x $5 = $55, a $1.22 cohort CPL.
  const days = run(40, 0, { spendCents: 500, impressions: 500, clicks: 10 })
  const cohortAd = (cohort: CohortLead[], over: Partial<CreativeRuleInput> = {}) => leadAd({ days, ...over }, { cohort })

  it('pauses a live ad whose cohort CPL is over 3x its contribution per lead', () => {
    const r = evalAll([cohortAd(cohortOf(45, 35))]).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L7:pause'])
    expect(r[0]!.inputs).toMatchObject({ cohortLeads: 45, cohortSpendCents: 5500, cplCents: 122, contributionPerLeadCents: 0 })
  })

  it('offers a one-tap revive on a paused ad whose contribution per lead covers CPL', () => {
    // 20 of 45 ordered at $30: $600 x 45% margin / 45 leads = $6.00 a lead.
    const cohort = [...cohortOf(20, 35, { converted: true, revenueCents: 3000 }), ...cohortOf(25, 35)]
    const r = evalAll([cohortAd(cohort, { paused: true })]).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L7:revive'])
    expect(r[0]!.sentence).toBe('Revive: the 45-lead cohort from 30d ago earns $6.00 a lead against a $1.22 CPL, L7. It can revive this once.')
  })

  it('floors: 40 leads and 30 days old', () => {
    expect(rulesOf(cohortAd(cohortOf(39, 35)))).toEqual([])
    expect(rulesOf(cohortAd(cohortOf(45, 20)))).toEqual([])
  })

  it('is one-shot', () => {
    expect(rulesOf(cohortAd(cohortOf(45, 35), { events: [ev({ ruleId: 'L7', action: 'revive', appliedAt: hoursAgo(500) })] }))).toEqual([])
  })

  it('needs the Klaviyo read', () => expect(rulesOf(leadAd({ days }))).toEqual([]))
})

// ---------------------------------------------------------------------------
// L8 lead fatigue
// ---------------------------------------------------------------------------
describe('L8 lead fatigue', () => {
  it('fires when 7d CTR is down 30% from the first 3 days', () => {
    const d = run(9, 0, { spendCents: 300, impressions: 1000, clicks: 10 })
    for (let i = 0; i < 3; i++) d[i] = { ...d[i]!, clicks: 25 }
    const r = evalAll([leadAd({ days: d }, { days: leadRun(9, 0, { leads: 2 }) })]).firings
    expect(r.map(f => `${f.ruleId}:${f.action}`)).toEqual(['L8:refresh'])
    expect(r[0]!.sentence).toBe('Refresh: CTR down 60% from its first 3 days, L8')
  })

  // First 3 days at $1 on 4 leads a day: the first 10 leads cost $0.25 each.
  // The last 7 days at $5 on 2 leads a day: a $2.50 CPL, up 900%.
  const cplDays = [...run(9, 7, { spendCents: 100, impressions: 1000, clicks: 20 }), ...run(6, 0, { spendCents: 500, impressions: 1000, clicks: 20 })]
  const cplLeads = [...leadRun(9, 7, { leads: 4 }), ...leadRun(6, 0, { leads: 2 })]

  it('fires when CPL is up 50% from the first 10 leads', () => {
    const r = evalAll([leadAd({ days: cplDays }, { days: cplLeads })]).firings
    expect(r.map(f => f.ruleId)).toEqual(['L8'])
    expect(r[0]!.sentence).toBe('Refresh: CPL up 900% from its first 10 leads ($0.25 to $2.50), L8')
  })

  it('floors: 10 leads and 7 days live', () => {
    expect(rulesOf(leadAd({ days: cplDays }, { days: [ld(9, { leads: 4 }), ld(0, { leads: 5 })] }))).toEqual([])
    expect(rulesOf(leadAd({ days: cplDays, launchedAt: hoursAgo(100) }, { days: cplLeads }))).toEqual([])
  })

  it('cooldown: 7d after an applied refresh', () => {
    expect(rulesOf(leadAd({ days: cplDays, events: [ev({ ruleId: 'L8', action: 'refresh', appliedAt: hoursAgo(72) })] }, { days: cplLeads }))).toEqual([])
    expect(rulesOf(leadAd({ days: cplDays, events: [ev({ ruleId: 'L8', action: 'refresh', appliedAt: hoursAgo(200) })] }, { days: cplLeads }))).toEqual(['L8'])
  })
})

// ---------------------------------------------------------------------------
// R2 on a lead campaign
// ---------------------------------------------------------------------------
describe('R2 on a lead campaign', () => {
  const day0 = [dp(0, { spendCents: 100, impressions: 2500, clicks: 50 })]

  it('reads outbound CTR when the insights carry link clicks', () => {
    const r = evalAll([leadAd({ days: day0 }, { days: [ld(0, { leads: 1, linkClicks: 5 })] })]).firings
    expect(r.map(f => f.ruleId)).toEqual(['R2'])
    expect(r[0]!.sentence).toBe('Pause: 2,500 impressions in 1d at 0.20% outbound CTR, R2')
    expect(r[0]!.inputs).toMatchObject({ ctrBasis: 'outbound', ruleSet: 'leads' })
  })

  it('falls back to clicks over impressions without them', () => {
    expect(rulesOf(leadAd({ days: day0 }, { days: [ld(0, { leads: 1 })] }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Cohorts from the Klaviyo read
// ---------------------------------------------------------------------------
describe('lead cohorts', () => {
  const index = buildCreativeIndex([{ id: 1, externalAdId: 'ad-1', exportPayload: null }, { id: 2, externalAdId: null, exportPayload: { destination_url: 'https://xdipx.com/hello?utm_content=hook-b' } }])
  const leads = [
    { profileId: 'p1', utmContent: 'ad-1', interest: null, capturedAt: hoursAgo(48) },
    { profileId: 'p2', utmContent: 'ad-1', interest: null, capturedAt: hoursAgo(48) },
    { profileId: 'p3', utmContent: 'hook-b', interest: null, capturedAt: hoursAgo(20 * 24) },
    { profileId: 'p4', utmContent: 'unknown', interest: null, capturedAt: hoursAgo(48) },
  ]
  const orders = [
    { profileId: 'p1', at: hoursAgo(24), value: 31.5 },
    { profileId: 'p2', at: hoursAgo(72), value: 20 }, // before capture: never counts
  ]

  it('attributes by utm_content and counts only orders after capture', () => {
    const c = buildLeadCohorts(leads, orders, index)
    expect(c.get(1)).toEqual([
      { capturedAt: hoursAgo(48), converted: true, revenueCents: 3150 },
      { capturedAt: hoursAgo(48), converted: false, revenueCents: 0 },
    ])
    expect(c.get(2)).toHaveLength(1)
    expect([...c.keys()].sort()).toEqual([1, 2])
  })

  it('account lead-to-order reads the trailing 14 days only', () => {
    expect(accountLeadToOrder(leads, orders, NOW, 14)).toEqual({ rate: 1 / 3, leads: 3, converted: 1 })
    expect(accountLeadToOrder([], [], NOW, 14).rate).toBeNull()
  })
})
