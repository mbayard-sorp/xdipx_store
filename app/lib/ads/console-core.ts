/**
 * Ads console overview, the pure half (ticket #16411, plan section 4).
 *
 * Client-safe: no server imports. console.server.ts reads the mirror, the
 * insights table and the settings, then hands the rows to assembleOverview(),
 * which does every sum, ratio and alert decision. Keeping the arithmetic here
 * lets the tests pin CPL, pace and the stale flags without a database.
 *
 * Money is integer cents throughout. A ratio with nothing under it (CPL with
 * zero leads, CPA with zero orders) is null, never a made-up zero.
 */
import type { BreakEven } from '~/lib/ad-metrics-core'

/** Entity sync runs every few hours; past this the mirror reads as stale. */
export const ENTITY_STALE_MS = 8 * 3_600_000
/** The insights pull is hourly; past this the spend figures read as stale. */
export const INSIGHTS_STALE_MS = 2 * 3_600_000
/** Share of the daily cap at which the R7 spend guard reads as close. */
export const R7_NEAR_RATIO = 0.8

export const PROBLEM_STATUSES = ['DISAPPROVED', 'WITH_ISSUES'] as const
const ACTIVE = 'ACTIVE'
const MISSING = 'MISSING'

export type EntityLevelLite = 'campaign' | 'adset' | 'ad' | 'creative'

// ---------------------------------------------------------------------------
// Inputs (what the server reads)
// ---------------------------------------------------------------------------

export interface OverviewSettings {
  spendEnabled: boolean
  dailyCapCents: number
  monthlyCapCents: number
  leadCplCeilingCents: number
}

/** ad_platform_insights_daily, platform meta, level ad, summed per day. */
export interface InsightsDay { day: string; spendCents: number; leads: number }
/** ad_creative_daily_metrics, summed per day. */
export interface AttributedDay { day: string; orders: number; netRevenueCents: number }
export interface EntityStatusCount { level: EntityLevelLite; effectiveStatus: string | null; n: number }

export interface ProblemEntityRow {
  platform: string
  accountId: string
  level: EntityLevelLite
  externalId: string
  name: string | null
  effectiveStatus: string
  reviewFeedback: Record<string, unknown> | null
}

export interface Freshness { lastEntitySyncAt: Date | null; lastInsightsPullAt: Date | null }

/** Today's ad_rule_events rows that matter to R7: R7 firings and any undo. */
export interface RuleEventLite { id: number; ruleId: string; action: string; detail: Record<string, unknown> | null; firedAt: Date }

/** The stored token reading per channel (ad_channel_health, migration 131). */
export interface ChannelHealthLite {
  channel: string
  checkedAt: string
  state: 'ok' | 'expiring' | 'invalid' | 'unknown'
  expiresAt: string | null
  error: string | null
}

/**
 * Every read the overview needs. A field is null when its read failed, and
 * the page then shows "unknown" for what it feeds. channelHealth is null
 * when no reading exists yet.
 */
export interface OverviewInput {
  settings: OverviewSettings
  breakEven: BreakEven
  insights: InsightsDay[] | null
  attributed: AttributedDay[] | null
  entityCounts: EntityStatusCount[] | null
  problems: ProblemEntityRow[] | null
  freshness: Freshness | null
  r7Events: RuleEventLite[] | null
  pendingActions: number | null
  channelHealth: ChannelHealthLite[] | null
  /** Ads Manager link for one entity, or null when no account id is known. */
  linkFor: (row: ProblemEntityRow) => string | null
}

// ---------------------------------------------------------------------------
// Output (what the page renders)
// ---------------------------------------------------------------------------

export interface WindowFigures {
  spendCents: number
  leads: number
  /** spend / leads, cents. Null with zero leads. */
  cplCents: number | null
  orders: number
  netRevenueCents: number
  /** spend / orders, cents. Null with zero orders. */
  cpaCents: number | null
  /** net revenue / spend. Null with zero spend. */
  netRoas: number | null
}

export interface LevelCounts { total: number; active: number; problems: number }

export type AlertSeverity = 'alert' | 'warn'
export interface OverviewAlert {
  key: string
  severity: AlertSeverity
  kind: 'entity' | 'token' | 'stale' | 'r7' | 'pending'
  title: string
  detail: string | null
  href: string | null
}

export type R7State = 'fired' | 'near' | 'armed' | 'unknown'

export interface Overview {
  today: string
  simulation: boolean
  settings: OverviewSettings
  breakEven: BreakEven
  /** Null when the insights read failed. */
  spend: { todayCents: number; yesterdayCents: number; monthCents: number } | null
  pace: {
    month: string
    daysElapsed: number
    daysInMonth: number
    projectedCents: number
    /** Projected month spend as a percent of the monthly cap. Null with no cap. */
    projectedPct: number | null
    /** Where straight-line spend to the cap would be today. */
    onPlanCents: number
  } | null
  windows: { today: WindowFigures; d7: WindowFigures; d30: WindowFigures } | null
  counts: { campaign: LevelCounts; adset: LevelCounts; ad: LevelCounts } | null
  freshness: {
    lastEntitySyncAt: string | null
    lastInsightsPullAt: string | null
    entityStale: boolean
    insightsStale: boolean
  } | null
  r7: { state: R7State; sentence: string | null }
  pendingActions: number | null
  /** Null until the token health cron has stored a reading. */
  tokenHealth: ChannelHealthLite[] | null
  alerts: OverviewAlert[]
  /** Names of reads that failed, for the "some figures are unknown" note. */
  failed: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function ymdUtc(d: Date): string { return d.toISOString().slice(0, 10) }

export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return ymdUtc(d)
}

export function ratioCents(numCents: number, den: number): number | null {
  return den > 0 ? Math.round(numCents / den) : null
}

/** Meta's ad_review_feedback is { global: { "Policy": "Message" } }. Flatten it to one line. */
export function feedbackText(feedback: Record<string, unknown> | null): string | null {
  if (!feedback || typeof feedback !== 'object') return null
  const parts: string[] = []
  const walk = (v: unknown, label: string | null) => {
    if (typeof v === 'string') { parts.push(label ? `${label}: ${v}` : v); return }
    if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        walk(inner, k === 'global' || k === 'placement_specific' || /^\d+$/.test(k) ? label : k)
      }
    }
  }
  walk(feedback, null)
  const text = parts.join(' ').trim()
  return text || null
}

function windowFigures(insights: InsightsDay[], attributed: AttributedDay[], from: string, to: string): WindowFigures {
  let spendCents = 0, leads = 0, orders = 0, netRevenueCents = 0
  for (const r of insights) if (r.day >= from && r.day <= to) { spendCents += r.spendCents; leads += r.leads }
  for (const r of attributed) if (r.day >= from && r.day <= to) { orders += r.orders; netRevenueCents += r.netRevenueCents }
  return {
    spendCents, leads, cplCents: ratioCents(spendCents, leads),
    orders, netRevenueCents, cpaCents: ratioCents(spendCents, orders),
    netRoas: spendCents > 0 ? netRevenueCents / spendCents : null,
  }
}

function levelCounts(rows: EntityStatusCount[], level: EntityLevelLite): LevelCounts {
  const out: LevelCounts = { total: 0, active: 0, problems: 0 }
  for (const r of rows) {
    if (r.level !== level || r.effectiveStatus === MISSING) continue
    out.total += r.n
    if (r.effectiveStatus === ACTIVE) out.active += r.n
    if ((PROBLEM_STATUSES as readonly string[]).includes(r.effectiveStatus ?? '')) out.problems += r.n
  }
  return out
}

const LEVEL_WORD: Record<EntityLevelLite, string> = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad', creative: 'Creative' }

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ageWords(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) {
    const m = Math.max(1, Math.round(ms / 60_000))
    return `${m} minute${m === 1 ? '' : 's'}`
  }
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.floor(h / 24)} days`
}

/**
 * R7 from today's rule events and spend. Fired means an R7 pause today that
 * no undo row points at. Near means spend is at 80% of the daily cap or more.
 * Otherwise the guard is armed: the daily rules run will fire it on a breach.
 */
export function r7State(
  events: RuleEventLite[] | null,
  todaySpendCents: number | null,
  dailyCapCents: number,
): { state: R7State; sentence: string | null } {
  if (events) {
    const undone = new Set(events.filter(e => e.action === 'undo').map(e => Number(e.detail?.['undoes'])))
    const fired = events.find(e => e.ruleId === 'R7' && e.action !== 'undo' && e.action !== 'none' && !undone.has(e.id))
    if (fired) {
      const s = fired.detail?.['sentence']
      return { state: 'fired', sentence: typeof s === 'string' ? s : null }
    }
  }
  if (todaySpendCents != null && dailyCapCents > 0 && todaySpendCents >= dailyCapCents * R7_NEAR_RATIO) {
    return { state: 'near', sentence: null }
  }
  return { state: events ? 'armed' : 'unknown', sentence: null }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function assembleOverview(input: OverviewInput, now: Date, failed: string[] = []): Overview {
  const today = ymdUtc(now)
  const yesterday = shiftDay(today, -1)
  const monthStart = `${today.slice(0, 7)}-01`
  const s = input.settings

  let spend: Overview['spend'] = null
  let pace: Overview['pace'] = null
  let windows: Overview['windows'] = null
  if (input.insights) {
    const rows = input.insights
    const sum = (from: string, to: string) => rows.filter(r => r.day >= from && r.day <= to).reduce((a, r) => a + r.spendCents, 0)
    spend = { todayCents: sum(today, today), yesterdayCents: sum(yesterday, yesterday), monthCents: sum(monthStart, today) }
    const [y, m, d] = today.split('-').map(Number) as [number, number, number]
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const projectedCents = Math.round((spend.monthCents / d) * daysInMonth)
    pace = {
      month: today.slice(0, 7), daysElapsed: d, daysInMonth, projectedCents,
      projectedPct: s.monthlyCapCents > 0 ? Math.round((projectedCents / s.monthlyCapCents) * 100) : null,
      onPlanCents: Math.round((s.monthlyCapCents * d) / daysInMonth),
    }
    const attributed = input.attributed ?? []
    windows = {
      today: windowFigures(rows, attributed, today, today),
      d7: windowFigures(rows, attributed, shiftDay(today, -6), today),
      d30: windowFigures(rows, attributed, shiftDay(today, -29), today),
    }
  }

  const counts = input.entityCounts
    ? {
        campaign: levelCounts(input.entityCounts, 'campaign'),
        adset: levelCounts(input.entityCounts, 'adset'),
        ad: levelCounts(input.entityCounts, 'ad'),
      }
    : null

  let freshness: Overview['freshness'] = null
  if (input.freshness) {
    const f = input.freshness
    // "Never" is not stale: an empty mirror before the first sync has nothing to be behind on.
    freshness = {
      lastEntitySyncAt: f.lastEntitySyncAt?.toISOString() ?? null,
      lastInsightsPullAt: f.lastInsightsPullAt?.toISOString() ?? null,
      entityStale: f.lastEntitySyncAt != null && now.getTime() - f.lastEntitySyncAt.getTime() > ENTITY_STALE_MS,
      insightsStale: f.lastInsightsPullAt != null && now.getTime() - f.lastInsightsPullAt.getTime() > INSIGHTS_STALE_MS,
    }
  }

  const r7 = r7State(input.r7Events, spend?.todayCents ?? null, s.dailyCapCents)

  const alerts: OverviewAlert[] = []
  for (const p of input.problems ?? []) {
    const disapproved = p.effectiveStatus === 'DISAPPROVED'
    alerts.push({
      key: `entity:${p.platform}:${p.externalId}`,
      severity: disapproved ? 'alert' : 'warn',
      kind: 'entity',
      title: `${LEVEL_WORD[p.level]} ${p.name ? `"${p.name}"` : p.externalId} is ${disapproved ? 'disapproved' : 'running with issues'}`,
      detail: feedbackText(p.reviewFeedback),
      href: input.linkFor(p),
    })
  }
  for (const h of input.channelHealth ?? []) {
    if (h.state === 'ok') continue
    const expires = h.expiresAt ? `Expires ${h.expiresAt.slice(0, 10)}.` : null
    alerts.push({
      key: `token:${h.channel}`,
      severity: h.state === 'invalid' ? 'alert' : 'warn',
      kind: 'token',
      title: h.state === 'invalid'
        ? `The ${h.channel} token no longer works`
        : h.state === 'expiring' ? `The ${h.channel} token expires soon` : `The ${h.channel} token could not be checked`,
      detail: [h.error, expires].filter(Boolean).join(' ') || null,
      href: null,
    })
  }
  if (freshness?.entityStale && freshness.lastEntitySyncAt) {
    alerts.push({
      key: 'stale:entities', severity: 'warn', kind: 'stale',
      title: `Last entity sync was ${ageWords(now.getTime() - Date.parse(freshness.lastEntitySyncAt))} ago`,
      detail: 'Statuses here may not match Ads Manager. The sync should run at least every 8 hours.',
      href: null,
    })
  }
  if (freshness?.insightsStale && freshness.lastInsightsPullAt) {
    alerts.push({
      key: 'stale:insights', severity: 'warn', kind: 'stale',
      title: `Last insights pull was ${ageWords(now.getTime() - Date.parse(freshness.lastInsightsPullAt))} ago`,
      detail: 'Spend and leads may be behind. The pull should run every hour.',
      href: null,
    })
  }
  if (r7.state === 'fired') {
    alerts.push({
      key: 'r7:fired', severity: 'alert', kind: 'r7',
      title: 'R7 paused every ad today',
      detail: r7.sentence ?? 'The account spend guard fired. Nothing resumes until someone undoes it.',
      href: null,
    })
  } else if (r7.state === 'near' && spend) {
    alerts.push({
      key: 'r7:near', severity: 'warn', kind: 'r7',
      title: `Spend today is ${money(spend.todayCents)} of the ${money(s.dailyCapCents)} daily cap`,
      detail: 'R7 pauses every ad once spend passes the cap.',
      href: null,
    })
  }
  if (input.pendingActions != null && input.pendingActions > 0) {
    const n = input.pendingActions
    alerts.push({
      key: 'pending', severity: 'warn', kind: 'pending',
      title: `${n} proposed action${n === 1 ? '' : 's'} waiting for a decision`,
      detail: 'Approve or reject them in the Actions view.',
      href: '/admin/ads/actions',
    })
  }
  // Stable sort: alerts first, warnings after, each group in the order above.
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'alert' ? -1 : 1))

  return {
    today, simulation: !s.spendEnabled, settings: s, breakEven: input.breakEven,
    spend, pace, windows, counts, freshness, r7,
    pendingActions: input.pendingActions,
    tokenHealth: input.channelHealth,
    alerts, failed,
  }
}
