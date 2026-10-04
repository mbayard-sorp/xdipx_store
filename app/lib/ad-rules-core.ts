/**
 * Ad Studio v2 rules engine, the pure half (PR-H). Rules R1 to R8 from
 * docs/audits/ad-platform-research-2026-10-03.md section E.2, evaluated against
 * a window of per-creative daily metrics. No database, no server-only imports,
 * so the Spend tab can render the recipes and the tests can fire every rule on
 * fixtures. The database half (reads, writes, apply) is ad-rules.server.ts,
 * which re-exports everything here.
 *
 * What the engine does and does not do: it RECOMMENDS. Every firing becomes an
 * ad_rule_events row with applied_by null and the owner taps it. The one
 * exception is R7, the account spend guard, which the server applies on its own.
 *
 * Choices the research table leaves open, recorded here so they are not
 * rediscovered as bugs:
 *   - Pause rules (R1, R2, R3) only look at creatives that are not paused, and
 *     when one fires the creative gets no brake, scale or refresh row: a pause
 *     makes the others moot.
 *   - R4 reads the creative's own history: it needs an applied R1 or R3 pause in
 *     the last revive window, an order landing on or after that pause day, and
 *     lifetime net ROAS back at break-even. It has never fired before for that
 *     creative, undone or not.
 *   - "Capped at the daily valve" for R5 means one creative's daily budget never
 *     passes ads_media_daily_cap_cents. The account total is R7's job.
 *   - R6 needs min spend (2 x break-even CPA by default) and a cooldown the
 *     research table does not carry. Both are settings.
 *   - R8 needs frequency, which the metrics table does not store. Without it the
 *     rule stays quiet. The Meta insights import (PR-E) is what supplies it.
 */
import {
  ADS_RULE_DEFAULTS, type AdsRuleKey,
} from '~/lib/ad-settings-defaults'
import {
  RECOMMENDATION_RANK, RULE_RECOMMENDATION, SAMPLE_END_DAY, ctrPct, formatMoney, formatRoas, netRoas, sumWindow,
  type BreakEven, type DailyPoint, type RuleFiring, type SampleCreative, type WindowTotals,
} from '~/lib/ad-metrics-core'

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8'
export const RULE_IDS: readonly RuleId[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']

/** What an ad_rule_events row says to do. `none` is a held or cleared firing. */
export type RuleAction = 'pause' | 'scale' | 'brake' | 'refresh' | 'revive' | 'none'

export interface RuleEventHistory {
  id: number
  ruleId: string
  action: string
  firedAt: string
  appliedAt: string | null
  appliedBy: string | null
  /** True when a later `undo` row reverses it. Undone rows count for nothing. */
  undone: boolean
}

export interface CreativeRuleInput {
  /** Real creatives: the id as a string. Sample rows: `sample:S1`. */
  key: string
  creativeId: number | null
  label: string
  paused: boolean
  launchedAt: string | null
  /** Meta insights only. Null means "not known", and R8 stays quiet. */
  frequency: number | null
  /** Running product of Scale and Brake taps. 1 = untouched. */
  budgetMultiplier: number
  /** Daily rows, any order, any span. Lifetime is everything passed in. */
  days: DailyPoint[]
  events: RuleEventHistory[]
}

export interface RulesWindow {
  creatives: CreativeRuleInput[]
  /** Account level daily totals (every creative plus account-only rows), at least the last 8 days. */
  accountDays: DailyPoint[]
}

export interface RulesSettings {
  thresholds: Record<AdsRuleKey, number>
  breakEven: BreakEven
  /** ads_media_daily_cap_cents: the R7 trigger and the R5 per-creative ceiling. */
  dailyCapCents: number
}

export type RuleInputs = Record<string, number | string | boolean | null>

export interface RuleFired {
  ruleId: RuleId
  creativeKey: string | null
  creativeId: number | null
  action: RuleAction
  /** The plain-words line the Live tab shows, per wires 8.1. */
  sentence: string
  /** The numbers behind the sentence, stored in ad_rule_events.detail. */
  inputs: RuleInputs
  /** True when the rule fired but the action is withheld (R5 at the daily cap). */
  held?: boolean
}

export interface R7Result {
  trigger: 'spend' | 'cpm' | 'both'
  sentence: string
  inputs: RuleInputs
  /** Keys of live (not paused) creatives the server pauses. */
  pauseKeys: string[]
}

export interface EvaluatedRules {
  firings: RuleFired[]
  r7: R7Result | null
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const HOUR = 3_600_000

export function ymdUtc(d: Date): string { return d.toISOString().slice(0, 10) }

function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function totals(days: DailyPoint[], from: string, to: string): WindowTotals {
  const t: WindowTotals = { spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0 }
  for (const d of days) {
    if (d.day < from || d.day > to) continue
    t.spendCents += d.spendCents; t.impressions += d.impressions; t.clicks += d.clicks
    t.orders += d.orders; t.netRevenueCents += d.netRevenueCents
  }
  return t
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function appliedEvents(events: RuleEventHistory[], action: string): RuleEventHistory[] {
  return events.filter(e => e.action === action && e.appliedAt != null && !e.undone)
}

function withinHours(iso: string, now: Date, hours: number): boolean {
  return now.getTime() - new Date(iso).getTime() < hours * HOUR
}

/** One creative's daily budget cannot pass the daily cap. Returns the percent that fits, or held. */
export function cappedScalePct(avgDailyCents: number, dailyCapCents: number, upPct: number): { pct: number; held: boolean } {
  if (!(avgDailyCents > 0)) return { pct: upPct, held: false }
  if (avgDailyCents >= dailyCapCents) return { pct: 0, held: true }
  const room = Math.floor((dailyCapCents / avgDailyCents - 1) * 100)
  if (room < 1) return { pct: 0, held: true }
  return { pct: Math.min(upPct, room), held: false }
}

// ---------------------------------------------------------------------------
// Per-creative rules
// ---------------------------------------------------------------------------

function fired(c: CreativeRuleInput, ruleId: RuleId, action: RuleAction, sentence: string, inputs: RuleInputs, held = false): RuleFired {
  return { ruleId, creativeKey: c.key, creativeId: c.creativeId, action, sentence, inputs, ...(held ? { held: true } : {}) }
}

function evaluateCreative(c: CreativeRuleInput, s: RulesSettings, now: Date): RuleFired[] {
  const th = s.thresholds
  const be = s.breakEven
  const today = ymdUtc(now)
  const out: RuleFired[] = []

  const life = totals(c.days, '0000-01-01', today)
  const w7 = sumWindow(c.days, today, 7)
  const w3 = sumWindow(c.days, today, 3)
  const roas7 = netRoas(w7.netRevenueCents, w7.spendCents)
  const roas3 = netRoas(w3.netRevenueCents, w3.spendCents)
  const lifeRoas = netRoas(life.netRevenueCents, life.spendCents)

  const firstDay = [...c.days].filter(d => d.spendCents > 0 || d.impressions > 0).map(d => d.day).sort()[0] ?? null
  const startMs = c.launchedAt ? new Date(c.launchedAt).getTime() : firstDay ? new Date(`${firstDay}T00:00:00Z`).getTime() : null
  const hoursLive = startMs == null ? 0 : Math.max(0, (now.getTime() - startMs) / HOUR)
  const lifeDays = Math.max(1, Math.round(hoursLive / 24))

  // ---- R4 revive (paused creatives only) ---------------------------------
  if (c.paused) {
    const reviveDays = th.ads_rule_r4_revive_days
    const everRevived = c.events.some(e => e.ruleId === 'R4')
    const pauseEvent = appliedEvents(c.events, 'pause')
      .filter(e => (e.ruleId === 'R1' || e.ruleId === 'R3') && withinHours(e.appliedAt!, now, reviveDays * 24))
      .sort((a, b) => new Date(b.appliedAt!).getTime() - new Date(a.appliedAt!).getTime())[0]
    if (!everRevived && pauseEvent) {
      const pauseDay = ymdUtc(new Date(pauseEvent.appliedAt!))
      const late = totals(c.days, pauseDay, today)
      if (late.orders >= 1 && lifeRoas != null && lifeRoas >= be.roas) {
        out.push(fired(c, 'R4', 'revive',
          `Revive: a late order brought net ROAS to ${formatRoas(lifeRoas)} against ${formatRoas(be.roas)} break-even, R4. It can revive this once.`,
          { lifeRoas, breakEvenRoas: be.roas, lateOrders: late.orders, pausedBy: pauseEvent.ruleId, pauseDay, reviveDays }))
      }
    }
    return out
  }

  // ---- Pause family -------------------------------------------------------
  // R1 hard kill: lifetime spend at least N x BE CPA, zero attributed orders, minimum hours live.
  if (life.spendCents >= th.ads_rule_r1_be_multiple * be.cpaCents && life.orders === 0 && hoursLive >= th.ads_rule_r1_min_hours) {
    out.push(fired(c, 'R1', 'pause',
      `Pause: ${formatMoney(life.spendCents)} spent in ${lifeDays}d, 0 orders, R1`,
      { spendCents: life.spendCents, orders: 0, breakEvenCpaCents: be.cpaCents, multiple: th.ads_rule_r1_be_multiple, hoursLive: Math.round(hoursLive), days: lifeDays }))
  }
  // R2 broken creative: lifetime impressions at least N and link CTR under P percent.
  const lifeCtr = ctrPct(life.clicks, life.impressions)
  if (life.impressions >= th.ads_rule_r2_min_impressions && lifeCtr != null && lifeCtr < th.ads_rule_r2_min_ctr_pct) {
    out.push(fired(c, 'R2', 'pause',
      `Pause: ${life.impressions.toLocaleString('en-US')} impressions in ${lifeDays}d at ${lifeCtr.toFixed(2)}% CTR, R2`,
      { impressions: life.impressions, ctrPct: Number(lifeCtr.toFixed(3)), minCtrPct: th.ads_rule_r2_min_ctr_pct, days: lifeDays }))
  }
  // R3 unprofitable: 7d spend at least N x BE and 7d net ROAS under F x break-even ROAS.
  if (w7.spendCents >= th.ads_rule_r3_be_multiple * be.cpaCents && roas7 != null && roas7 < th.ads_rule_r3_roas_factor * be.roas) {
    out.push(fired(c, 'R3', 'pause',
      `Pause: ${formatRoas(roas7)} net ROAS against ${formatRoas(be.roas)} break-even over 7d on ${formatMoney(w7.spendCents)} spent, R3`,
      { roas7, breakEvenRoas: be.roas, spendCents: w7.spendCents, orders: w7.orders, factor: th.ads_rule_r3_roas_factor }))
  }
  const pausing = out.length > 0
  if (pausing) return out

  // ---- R5 scale -----------------------------------------------------------
  if (roas7 != null && roas7 >= th.ads_rule_r5_roas_factor * be.roas && w7.orders >= th.ads_rule_r5_min_purchases) {
    const cooling = appliedEvents(c.events, 'scale').some(e => withinHours(e.appliedAt!, now, th.ads_rule_r5_cooldown_hours))
    if (!cooling) {
      const avgDaily = w7.spendCents / 7
      const cap = cappedScalePct(avgDaily, s.dailyCapCents, th.ads_rule_r5_budget_up_pct)
      const base = { roas7, breakEvenRoas: be.roas, orders: w7.orders, avgDailyCents: Math.round(avgDaily), dailyCapCents: s.dailyCapCents }
      if (cap.held) {
        out.push(fired(c, 'R5', 'none',
          `Scale held: ${formatRoas(roas7)} net ROAS on ${w7.orders} orders over 7d, but this ad already spends the ${formatMoney(s.dailyCapCents)} daily cap, R5`,
          { ...base, upPct: 0, held: true }, true))
      } else {
        const capped = cap.pct < th.ads_rule_r5_budget_up_pct
        out.push(fired(c, 'R5', 'scale',
          `Scale: ${formatRoas(roas7)} net ROAS on ${w7.orders} orders over 7d, R5${capped ? ` (+${cap.pct}%, the most the ${formatMoney(s.dailyCapCents)} daily cap allows)` : ''}`,
          { ...base, upPct: cap.pct, capped }))
      }
    }
  }

  // ---- R6 brake -----------------------------------------------------------
  const brakeSpend = th.ads_rule_r6_min_spend_be_multiple * be.cpaCents
  if (
    w7.spendCents >= brakeSpend && w3.spendCents > 0 && roas7 != null && roas3 != null
    && roas7 < be.roas && roas3 < be.roas
  ) {
    const cooling = appliedEvents(c.events, 'brake').some(e => withinHours(e.appliedAt!, now, th.ads_rule_r6_cooldown_hours))
    if (!cooling) {
      out.push(fired(c, 'R6', 'brake',
        `Brake: ${formatRoas(roas3)} net ROAS over 3d and ${formatRoas(roas7)} over 7d, both under ${formatRoas(be.roas)} break-even, R6`,
        { roas3, roas7, breakEvenRoas: be.roas, spend7Cents: w7.spendCents, downPct: th.ads_rule_r6_budget_down_pct }))
    }
  }

  // ---- R8 fatigue ---------------------------------------------------------
  if (c.frequency != null && c.frequency > th.ads_rule_r8_max_frequency) {
    const sorted = [...c.days].filter(d => d.impressions > 0).sort((a, b) => a.day.localeCompare(b.day))
    const first3 = sorted.slice(0, 3).reduce((a, d) => ({ i: a.i + d.impressions, k: a.k + d.clicks }), { i: 0, k: 0 })
    const ctrFirst = ctrPct(first3.k, first3.i)
    const ctrNow = ctrPct(w7.clicks, w7.impressions)
    if (ctrFirst && ctrNow != null && (ctrFirst - ctrNow) / ctrFirst >= th.ads_rule_r8_ctr_drop_pct / 100) {
      const drop = Math.round(((ctrFirst - ctrNow) / ctrFirst) * 100)
      out.push(fired(c, 'R8', 'refresh',
        `Refresh: frequency ${c.frequency.toFixed(1)}, CTR down ${drop}% from its first 3 days, R8`,
        { frequency: c.frequency, ctrFirstPct: Number(ctrFirst.toFixed(3)), ctrNowPct: Number(ctrNow.toFixed(3)), dropPct: drop }))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// R7 account spend guard
// ---------------------------------------------------------------------------

function evaluateR7(w: RulesWindow, s: RulesSettings, now: Date): R7Result | null {
  const today = ymdUtc(now)
  const todayRow = totals(w.accountDays, today, today)
  const spendBreach = todayRow.spendCents > s.dailyCapCents

  // CPM against the median of the 7 days before today. Needs three days of
  // impressions to mean anything; with fewer the CPM leg stays quiet.
  const from = minusDays(today, 7)
  const to = minusDays(today, 1)
  const cpms: number[] = []
  for (const d of w.accountDays) {
    if (d.day < from || d.day > to || !(d.impressions > 0) || !(d.spendCents > 0)) continue
    cpms.push((d.spendCents / 100 / d.impressions) * 1000) // dollars per thousand impressions
  }
  const med = cpms.length >= 3 ? median(cpms) : null
  const cpmToday = todayRow.impressions > 0 ? (todayRow.spendCents / 100 / todayRow.impressions) * 1000 : null
  const mult = s.thresholds.ads_rule_r7_cpm_multiple
  const cpmBreach = med != null && cpmToday != null && cpmToday > mult * med

  if (!spendBreach && !cpmBreach) return null
  const trigger: R7Result['trigger'] = spendBreach && cpmBreach ? 'both' : spendBreach ? 'spend' : 'cpm'
  const parts: string[] = []
  if (spendBreach) parts.push(`today's spend ${formatMoney(todayRow.spendCents)} passed the ${formatMoney(s.dailyCapCents)} daily cap`)
  if (cpmBreach) parts.push(`CPM $${cpmToday!.toFixed(2)} is over ${mult}x its 7-day median of $${med!.toFixed(2)}`)
  return {
    trigger,
    sentence: `R7 paused all: ${parts.join(', and ')}`,
    inputs: {
      todaySpendCents: todayRow.spendCents, dailyCapCents: s.dailyCapCents,
      cpmToday: cpmToday == null ? null : Number(cpmToday.toFixed(2)),
      cpmMedian7d: med == null ? null : Number(med.toFixed(2)),
      cpmMultiple: mult, trigger,
    },
    pauseKeys: w.creatives.filter(c => !c.paused).map(c => c.key),
  }
}

/**
 * Evaluate R1 to R8 against one window. Pure: the same window, settings and
 * clock give the same answer, which is what lets the sample dataset and the
 * tests assert on specific firings.
 */
export function evaluateRules(window: RulesWindow, settings: RulesSettings, now: Date): EvaluatedRules {
  const firings: RuleFired[] = []
  for (const c of window.creatives) firings.push(...evaluateCreative(c, settings, now))
  const r7 = evaluateR7(window, settings, now)
  if (r7) {
    firings.push({ ruleId: 'R7', creativeKey: null, creativeId: null, action: 'pause', sentence: r7.sentence, inputs: r7.inputs })
  }
  return { firings, r7 }
}

export function thresholdsWithDefaults(partial: Partial<Record<AdsRuleKey, number>> = {}): Record<AdsRuleKey, number> {
  return { ...ADS_RULE_DEFAULTS, ...partial }
}

// ---------------------------------------------------------------------------
// Recipes: the rules as sentences with inline numbers (wires section 9, research pattern 8)
// ---------------------------------------------------------------------------

export interface RecipeField {
  key: AdsRuleKey
  unit: string
  min: number
  max: number
  step: number
  label: string
}

export type RecipePart = string | { field: RecipeField }

export interface RuleRecipe {
  id: RuleId
  title: string
  parts: RecipePart[]
  /** The revive partner shown directly under a kill rule. */
  revive?: RuleId
  /** Plain note under the sentence when the rule has no editable number of its own. */
  note?: string
}

const f = (key: AdsRuleKey, label: string, unit: string, min: number, max: number, step: number): { field: RecipeField } =>
  ({ field: { key, label, unit, min, max, step } })

export const RULE_RECIPES: Record<RuleId, RuleRecipe> = {
  R1: {
    id: 'R1', title: 'Hard kill', revive: 'R4',
    parts: ['Pause when spend passes ', f('ads_rule_r1_be_multiple', 'Break-even multiple', 'x', 0.5, 10, 0.5), ' x break-even with 0 orders after ', f('ads_rule_r1_min_hours', 'Hours live', 'h', 0, 720, 1), 'h live.'],
  },
  R4: {
    id: 'R4', title: 'Revive',
    parts: ['Revive once if a late order brings net ROAS back to break-even within ', f('ads_rule_r4_revive_days', 'Revive window', 'd', 1, 30, 1), 'd. Never twice.'],
  },
  R2: {
    id: 'R2', title: 'Broken creative',
    parts: ['Pause when impressions reach ', f('ads_rule_r2_min_impressions', 'Impressions', '', 100, 100000, 100), ' and link CTR is under ', f('ads_rule_r2_min_ctr_pct', 'CTR floor', '%', 0.05, 5, 0.05), '%.'],
  },
  R3: {
    id: 'R3', title: 'Unprofitable', revive: 'R4',
    parts: ['Pause when 7d spend passes ', f('ads_rule_r3_be_multiple', 'Break-even multiple', 'x', 0.5, 10, 0.5), ' x break-even and net ROAS is under ', f('ads_rule_r3_roas_factor', 'ROAS factor', 'x', 0.1, 2, 0.1), ' x break-even ROAS.'],
  },
  R5: {
    id: 'R5', title: 'Scale',
    parts: ['Scale up ', f('ads_rule_r5_budget_up_pct', 'Budget increase', '%', 1, 100, 1), '% when 7d net ROAS is at least ', f('ads_rule_r5_roas_factor', 'ROAS factor', 'x', 0.5, 5, 0.1), ' x break-even with at least ', f('ads_rule_r5_min_purchases', 'Orders', '', 1, 50, 1), ' orders. At most once per ', f('ads_rule_r5_cooldown_hours', 'Cooldown', 'h', 1, 336, 1), 'h, never past the daily cap.'],
  },
  R6: {
    id: 'R6', title: 'Brake',
    parts: ['Brake ', f('ads_rule_r6_budget_down_pct', 'Budget cut', '%', 1, 90, 1), '% when net ROAS is under break-even in both 3d and 7d with at least ', f('ads_rule_r6_min_spend_be_multiple', 'Spend multiple', 'x', 0.5, 10, 0.5), ' x break-even spend behind it. At most once per ', f('ads_rule_r6_cooldown_hours', 'Cooldown', 'h', 1, 336, 1), 'h.'],
  },
  R7: {
    id: 'R7', title: 'Spend guard',
    parts: ["Pause everything and alert you when today's spend passes the daily cap, or CPM passes ", f('ads_rule_r7_cpm_multiple', 'CPM multiple', 'x', 1, 10, 0.5), ' x its 7-day median.'],
    note: 'The one rule that acts without a tap. The daily cap is set in the cap control above.',
  },
  R8: {
    id: 'R8', title: 'Fatigue',
    parts: ['Flag a refresh when frequency passes ', f('ads_rule_r8_max_frequency', 'Frequency', '', 1, 20, 0.5), ' and CTR falls ', f('ads_rule_r8_ctr_drop_pct', 'CTR drop', '%', 5, 90, 5), '% from its first 3 days.'],
    note: 'Needs frequency, which arrives with the Meta insights import.',
  },
}

/** Display order: each kill rule with its revive partner directly under it. */
export const RECIPE_ORDER: ReadonlyArray<{ rule: RuleId; underneath?: RuleId }> = [
  { rule: 'R1', underneath: 'R4' },
  { rule: 'R2' },
  { rule: 'R3' },
  { rule: 'R5' },
  { rule: 'R6' },
  { rule: 'R7' },
  { rule: 'R8' },
]

export function recipeFields(rule: RuleId): RecipeField[] {
  return RULE_RECIPES[rule].parts.flatMap(p => (typeof p === 'string' ? [] : [p.field]))
}

/** Validate and clamp a proposed value for one rule key. Returns null when it is not a usable number. */
export function validateRuleValue(key: AdsRuleKey, raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isFinite(n)) return null
  for (const rule of RULE_IDS) {
    const field = recipeFields(rule).find(x => x.key === key)
    if (field) return n >= field.min && n <= field.max ? n : null
  }
  return null
}

// ---------------------------------------------------------------------------
// The sample dataset through the real engine
// ---------------------------------------------------------------------------

/** The sample's clock: the end of its last day, so "today" is SAMPLE_END_DAY. */
export function sampleNow(end: string = SAMPLE_END_DAY): Date {
  return new Date(`${end}T23:00:00Z`)
}

/**
 * Run one sample creative through evaluateRules (never R7, which is account
 * level) and return its firings as Live feed rows, highest recommendation first.
 * The Live tab uses this so sample rows show what the engine says, not a
 * separate stand-in.
 */
export function evaluateSampleCreative(c: SampleCreative, settings: RulesSettings, end: string = SAMPLE_END_DAY): RuleFiring[] {
  const input: CreativeRuleInput = {
    key: `sample:${c.key}`, creativeId: null, label: c.label, paused: false, launchedAt: null,
    frequency: c.frequency, budgetMultiplier: 1, days: c.days, events: [],
  }
  const { firings } = evaluateRules({ creatives: [input], accountDays: [] }, settings, sampleNow(end))
  return firings
    .map(f => ({
      ruleId: f.ruleId, sentence: f.sentence, recommendation: RULE_RECOMMENDATION[f.ruleId] ?? 'healthy',
      eventId: null, firedAt: null, applied: false,
    }) satisfies RuleFiring)
    .sort((a, b) => RECOMMENDATION_RANK[a.recommendation] - RECOMMENDATION_RANK[b.recommendation])
}
