/**
 * Ad Studio v2 rules engine, the database half (PR-H). The pure evaluation
 * lives in ad-rules-core.ts and is re-exported here, so callers need only this
 * module.
 *
 *   runRulesDaily()    the routine's Pass 2: evaluate every live or paused
 *                      creative, write one ad_rule_events row per firing
 *                      (applied_by null, a recommendation), apply R7 on its own.
 *   applyRuleAction()  what a Live tap does: change paused_at, pause_reason or
 *                      budget_multiplier, write the event with applied_by set,
 *                      and call the platform seam.
 *
 * With ads_spend_enabled off (simulation) every apply is recorded in the
 * database exactly as it would be live, and no platform call happens.
 *
 * Objective-aware sets (ticket #16428): each creative's campaign objective is
 * read through the entity mirror (ad, ad set, campaign in ad_platform_entities).
 * Lead campaigns get L1 to L8 plus R2 and R7, and their inputs are loaded here:
 * leads per day from ad_creative_daily_metrics.leads, link clicks and landing
 * views from ad_platform_insights_daily, and Klaviyo leads and lead-to-order by
 * utm_content from the lead funnel read. L3's hourly health samples do not
 * exist yet (phase 2d), so the window carries an empty list and L3 stays quiet.
 */
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreativeDailyMetrics, adCreatives, adPlatformEntities, adPlatformInsightsDaily, adRuleEvents } from '../../db/schema'
import { getAdsLeadCplCeilingCents, getAdsMediaDailyCapCents, getAdsRuleThresholds, getAdsSpendEnabled } from '~/lib/ad-settings.server'
import { AdMetricsError, addDays, currentBreakEven, todayUtc } from '~/lib/ad-metrics.server'
import { buildCreativeIndex, formatMoney, type LiveActionKind } from '~/lib/ad-metrics-core'
import { platformApply, type PlatformAction, type PlatformApplyResult } from '~/lib/ad-platform-apply.server'
import {
  cappedScalePct, evaluateRules,
  type CreativeRuleInput, type RuleEventHistory, type RuleFired, type RulesSettings, type RulesWindow,
} from '~/lib/ad-rules-core'
import {
  accountLeadToOrder, buildLeadCohorts, resolveObjectives,
  type CampaignObjective, type CohortLead, type LeadAccountInputs, type LeadDay, type MirrorEntity, type ObjectiveResolution,
} from '~/lib/ad-rules-lead-core'
import type { DailyPoint } from '~/lib/ad-metrics-core'

export * from '~/lib/ad-rules-core'
export * from '~/lib/ad-rules-lead-core'

/** How far back the Klaviyo read goes: L7 needs cohorts at least 30 days old. */
const LEAD_READ_DAYS = 90

/** Inputs the lead rules could not read this run, named so the run summary says why a rule stayed quiet. */
export const LEAD_INPUTS_NOT_BUILT = [
  'L3: hourly health samples (ad_health_samples, phase 2d) do not exist yet; L3 cannot fire',
  'L6: email-1 click and reveal-to-cart by utm_content are not in the lead funnel report; L6 cannot fire',
] as const

const LOOKBACK_DAYS = 120
const DAY_MS = 86_400_000

type EventRow = typeof adRuleEvents.$inferSelect

// ---------------------------------------------------------------------------
// Window loading
// ---------------------------------------------------------------------------

function toHistory(events: EventRow[]): Map<number, RuleEventHistory[]> {
  const undone = new Set<number>()
  for (const e of events) {
    if (e.action !== 'undo') continue
    const u = (e.detail as { undoes?: number } | null)?.undoes
    if (typeof u === 'number') undone.add(u)
  }
  const byCreative = new Map<number, RuleEventHistory[]>()
  for (const e of events) {
    if (e.creativeId == null || e.action === 'undo') continue
    const list = byCreative.get(e.creativeId) ?? []
    list.push({
      id: e.id, ruleId: e.ruleId, action: e.action,
      firedAt: e.firedAt.toISOString(), appliedAt: e.appliedAt ? e.appliedAt.toISOString() : null,
      appliedBy: e.appliedBy, undone: undone.has(e.id),
    })
    byCreative.set(e.creativeId, list)
  }
  return byCreative
}

function foldDays(rows: Array<{ day: string; spendCents: number; impressions: number; clicks: number; orders: number; netRevenueCents: number }>): DailyPoint[] {
  const m = new Map<string, DailyPoint>()
  for (const r of rows) {
    const cur = m.get(r.day) ?? { day: r.day, spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0 }
    cur.spendCents += r.spendCents; cur.impressions += r.impressions; cur.clicks += r.clicks
    cur.orders += r.orders; cur.netRevenueCents += r.netRevenueCents
    m.set(r.day, cur)
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export interface ObjectiveReport {
  counts: Record<CampaignObjective, number>
  /** One line per evaluated creative: which set it got and why. */
  byCreative: Array<{ creativeId: number; objective: CampaignObjective; rawObjective: string | null; ruleSet: 'leads' | 'sales'; note: string }>
  /** What the lead rules could not read this run. Empty when no lead creative was evaluated. */
  leadGaps: string[]
}

export interface LoadedWindow {
  window: RulesWindow
  events: EventRow[]
  objectives: ObjectiveReport
}

type InsightRow = { externalId: string; day: string; linkClicks: number | null; actions: Record<string, number> | null }

/**
 * Lead days for one creative: platform leads from the metrics rows (null when
 * no row carried the column), link clicks and landing views from insights.
 * A present actions object without landing_page_view reads as 0 views, since
 * Meta omits zero-count actions; no insights row reads as unread.
 */
export function buildLeadDays(
  metricRows: ReadonlyArray<{ day: string; leads: number | null }>,
  insightRows: readonly InsightRow[],
): LeadDay[] {
  const m = new Map<string, LeadDay>()
  const get = (day: string) => m.get(day) ?? { day, leads: null, linkClicks: null, landingViews: null }
  for (const r of metricRows) {
    const d = get(r.day)
    if (r.leads != null) d.leads = (d.leads ?? 0) + r.leads
    m.set(r.day, d)
  }
  for (const r of insightRows) {
    const d = get(r.day)
    if (r.linkClicks != null) d.linkClicks = (d.linkClicks ?? 0) + r.linkClicks
    if (r.actions && typeof r.actions === 'object') d.landingViews = (d.landingViews ?? 0) + (Number(r.actions['landing_page_view']) || 0)
    m.set(r.day, d)
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export async function loadRulesWindow(now: Date): Promise<LoadedWindow> {
  const today = todayUtc(now)
  const from = addDays(today, -LOOKBACK_DAYS)
  const [creatives, metrics, events, mirror] = await Promise.all([
    db.select({
      id: adCreatives.id, pausedAt: adCreatives.pausedAt, launchedAt: adCreatives.launchedAt, budgetMultiplier: adCreatives.budgetMultiplier,
      externalAdId: adCreatives.externalAdId, exportPayload: adCreatives.exportPayload,
    }).from(adCreatives),
    db.select().from(adCreativeDailyMetrics).where(gte(adCreativeDailyMetrics.day, from)),
    db.select().from(adRuleEvents).where(gte(adRuleEvents.firedAt, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS))).orderBy(asc(adRuleEvents.id)),
    db.select({
      platform: adPlatformEntities.platform, level: adPlatformEntities.level, externalId: adPlatformEntities.externalId,
      parentExternalId: adPlatformEntities.parentExternalId, objective: adPlatformEntities.objective, creativeId: adPlatformEntities.creativeId,
    }).from(adPlatformEntities) as Promise<MirrorEntity[]>,
  ])
  const resolved = resolveObjectives(creatives.map(c => ({ creativeId: c.id, externalAdId: c.externalAdId ?? null })), mirror)
  const history = toHistory(events)
  const recent = addDays(today, -30)
  const byCreative = new Map<number, typeof metrics>()
  for (const m of metrics) {
    if (m.creativeId == null) continue
    const list = byCreative.get(m.creativeId) ?? []
    list.push(m)
    byCreative.set(m.creativeId, list)
  }
  const inputs: CreativeRuleInput[] = []
  const report: ObjectiveReport = { counts: { leads: 0, sales: 0, other: 0, unknown: 0 }, byCreative: [], leadGaps: [] }
  for (const c of creatives) {
    const rows = byCreative.get(c.id) ?? []
    const recentlyActive = rows.some(r => r.day >= recent)
    if (!recentlyActive && c.launchedAt == null && c.pausedAt == null) continue
    const o: ObjectiveResolution = resolved.get(c.id) ?? {
      objective: 'unknown', rawObjective: null, adExternalId: null, adsetExternalId: null, campaignExternalId: null, note: 'not resolved',
    }
    report.counts[o.objective] += 1
    report.byCreative.push({ creativeId: c.id, objective: o.objective, rawObjective: o.rawObjective, ruleSet: o.objective === 'leads' ? 'leads' : 'sales', note: o.note })
    inputs.push({
      key: String(c.id), creativeId: c.id, label: `#${c.id}`,
      paused: c.pausedAt != null,
      launchedAt: c.launchedAt ? c.launchedAt.toISOString() : null,
      frequency: null,
      budgetMultiplier: Number(c.budgetMultiplier ?? 1) || 1,
      days: foldDays(rows),
      events: history.get(c.id) ?? [],
      ...(o.objective === 'leads' ? { objective: 'leads' as const, adsetExternalId: o.adsetExternalId } : {}),
    })
  }

  // Lead inputs, read only when a lead creative is in the window.
  let lead: LeadAccountInputs | null = null
  const leadInputs = inputs.filter(i => i.objective === 'leads')
  if (leadInputs.length) {
    report.leadGaps.push(...LEAD_INPUTS_NOT_BUILT)
    const extIds = leadInputs.flatMap(i => {
      const ext = creatives.find(c => c.id === i.creativeId)?.externalAdId
      return ext ? [ext] : []
    })
    const insights: InsightRow[] = extIds.length
      ? (await db.select({
          externalId: adPlatformInsightsDaily.externalId, day: adPlatformInsightsDaily.day,
          linkClicks: adPlatformInsightsDaily.linkClicks, actions: adPlatformInsightsDaily.actions,
        }).from(adPlatformInsightsDaily).where(and(
          eq(adPlatformInsightsDaily.level, 'ad'), inArray(adPlatformInsightsDaily.externalId, extIds), gte(adPlatformInsightsDaily.day, from),
        ))) as InsightRow[]
      : []
    if (!insights.length) report.leadGaps.push('L4 and outbound CTR: no ad-level insights rows yet; R2 uses clicks over impressions and L4 stays quiet')

    const { readLeadFunnelRaw } = await import('~/lib/lead-funnel-report.server')
    const raw = await readLeadFunnelRaw({ windowDays: LEAD_READ_DAYS })
    let cohorts: Map<number, CohortLead[]> | null = null
    if (raw.complete) {
      const index = buildCreativeIndex(creatives.map(c => ({ id: c.id, externalAdId: c.externalAdId ?? null, exportPayload: c.exportPayload })))
      cohorts = buildLeadCohorts(raw.leads, raw.orders, index)
      const acct = accountLeadToOrder(raw.leads, raw.orders, now, 14)
      lead = { leadToOrder14d: acct.rate, leads14d: acct.leads, healthSamples: [] }
    } else {
      report.leadGaps.push(`Klaviyo leads unread (${raw.gaps.join('; ') || 'unknown'}); L5 and L7 stay quiet and L1 reads platform leads only`)
      lead = { leadToOrder14d: null, leads14d: null, healthSamples: [] }
    }

    for (const i of leadInputs) {
      const ext = creatives.find(c => c.id === i.creativeId)?.externalAdId ?? null
      i.lead = {
        days: buildLeadDays(byCreative.get(i.creativeId!) ?? [], ext ? insights.filter(r => r.externalId === ext) : []),
        cohort: cohorts ? cohorts.get(i.creativeId!) ?? [] : null,
        quality: null,
      }
    }
  }
  return { window: { creatives: inputs, accountDays: foldDays(metrics), lead }, events, objectives: report }
}

export async function loadRulesSettings(now: Date): Promise<RulesSettings & { spendEnabled: boolean }> {
  const [thresholds, dailyCapCents, breakEven, spendEnabled, leadCplCeilingCents] = await Promise.all([
    getAdsRuleThresholds(), getAdsMediaDailyCapCents(), currentBreakEven(now), getAdsSpendEnabled(), getAdsLeadCplCeilingCents(),
  ])
  return { thresholds, dailyCapCents, breakEven, spendEnabled, leadCplCeilingCents }
}

// ---------------------------------------------------------------------------
// Persistence plan (pure, so the dedupe and clearing rules are testable)
// ---------------------------------------------------------------------------

export interface PendingEvent {
  id: number
  creativeId: number | null
  ruleId: string
  action: string
  appliedAt: string | null
}

export interface PersistPlan {
  inserts: RuleFired[]
  /** Existing unapplied rows whose numbers move forward with today's evaluation. */
  refresh: Array<{ id: number; firing: RuleFired }>
  /** Existing unapplied rows whose rule no longer fires. They become action `none`, cleared. */
  clear: number[]
}

/**
 * Today's firings against the unapplied recommendations already on file. A rule
 * that is still firing updates its row rather than writing a second one, a rule
 * that stopped firing is cleared so the Live tab does not keep recommending it,
 * and applied rows are never touched. R7 is handled by the caller.
 */
export function planPersistence(args: {
  firings: RuleFired[]
  evaluatedCreativeIds: ReadonlySet<number>
  pending: readonly PendingEvent[]
}): PersistPlan {
  const open = args.pending.filter(p => p.appliedAt == null && p.creativeId != null && p.ruleId !== 'R7' && p.ruleId !== 'MAN' && p.action !== 'undo')
  const plan: PersistPlan = { inserts: [], refresh: [], clear: [] }
  const matched = new Set<number>()
  for (const f of args.firings) {
    if (f.ruleId === 'R7' || f.creativeId == null) continue
    const hit = open.find(p => !matched.has(p.id) && p.creativeId === f.creativeId && p.ruleId === f.ruleId && p.action === f.action)
    if (hit) { matched.add(hit.id); plan.refresh.push({ id: hit.id, firing: f }) } else plan.inserts.push(f)
  }
  for (const p of open) {
    if (matched.has(p.id) || p.action === 'none') continue
    if (p.creativeId != null && args.evaluatedCreativeIds.has(p.creativeId)) plan.clear.push(p.id)
  }
  return plan
}

// ---------------------------------------------------------------------------
// runRulesDaily
// ---------------------------------------------------------------------------

export interface RulesRunSummary {
  day: string
  /** True when ads_spend_enabled is off: everything below is recorded, no platform call happens. */
  simulated: boolean
  evaluated: number
  fired: Array<{ ruleId: string; creativeId: number | null; action: string; sentence: string }>
  inserted: number
  refreshed: number
  cleared: number
  r7: null | { eventId: number; trigger: string; pausedCreatives: number; alert: 'filed' | 'failed' | 'skipped' }
  /** Which rule set each creative got, by mirrored campaign objective, and what the lead rules could not read. */
  objectives: ObjectiveReport
}

/**
 * The stored row detail. Lead-rule sentences carry a SIMULATION label while the
 * spend valve is off; R1 to R8 keep their sentences exactly as before and say
 * it through the `simulation` flag the Live tab already reads.
 */
function detailOf(f: RuleFired, simulated: boolean): Record<string, unknown> {
  const sentence = simulated && f.ruleId.startsWith('L') ? `SIMULATION. ${f.sentence}` : f.sentence
  return { sentence, inputs: f.inputs, simulation: simulated, ...(f.held ? { held: true } : {}) }
}

/**
 * Raise the owner alert for R7. The owner blocker list is where the store puts
 * anything only the owner can move ("it goes on the blocker list or it did not
 * happen"); the daily digest renders it in the queue and the blocker email. One
 * row per UTC day, so a bad afternoon does not file it twice. It goes through
 * the ads pager (pager.server.ts), which owns every plan §9.8 page.
 */
async function raiseR7Alert(day: string, sentence: string, pausedCreatives: number): Promise<'filed' | 'failed'> {
  const { pageOwner } = await import('~/lib/ads/pager.server')
  const r = await pageOwner('r7', {
    dedupeKey: `ads-r7-spend-guard-${day}`,
    title: `R7 paused every Ad Studio ad: ${sentence.replace(/^R7 paused all: /, '')}`,
    detail: `The account spend guard fired on ${day}. It paused ${pausedCreatives} live creative${pausedCreatives === 1 ? '' : 's'} on its own. Nothing resumes until you resume it from the Live tab, where the R7 row has an Undo.`,
    unblocks: 'Resume the paused ads once you have checked the spend',
    whereToGo: 'https://xdipx.com/admin/ad-studio/live',
    category: 'approval',
    priority: 1,
    source: 'agent',
    sourceRef: 'ad-rules:R7',
  })
  if (!r.filed) console.error('[ad-rules] R7 owner alert failed', r.error)
  return r.filed ? 'filed' : 'failed'
}

export async function runRulesDaily(now: Date = new Date()): Promise<RulesRunSummary> {
  const day = todayUtc(now)
  const [{ window, events, objectives }, settings] = await Promise.all([loadRulesWindow(now), loadRulesSettings(now)])
  const simulated = !settings.spendEnabled
  const result = evaluateRules(window, settings, now)

  const pending: PendingEvent[] = events.map(e => ({
    id: e.id, creativeId: e.creativeId, ruleId: e.ruleId, action: e.action, appliedAt: e.appliedAt ? e.appliedAt.toISOString() : null,
  }))
  const evaluatedCreativeIds = new Set(window.creatives.flatMap(c => (c.creativeId != null ? [c.creativeId] : [])))
  const plan = planPersistence({ firings: result.firings, evaluatedCreativeIds, pending })

  const firingEvents: Array<{ firing: RuleFired; eventId: number | null }> = plan.refresh.map(r => ({ firing: r.firing, eventId: r.id }))
  if (plan.inserts.length) {
    const ids = await db.insert(adRuleEvents).values(plan.inserts.map(f => ({
      ruleId: f.ruleId, creativeId: f.creativeId, action: f.action, detail: detailOf(f, simulated), appliedBy: null, appliedAt: null,
    }))).returning({ id: adRuleEvents.id })
    plan.inserts.forEach((f, i) => firingEvents.push({ firing: f, eventId: ids[i]?.id ?? null }))
  }
  for (const r of plan.refresh) {
    await db.update(adRuleEvents).set({ detail: detailOf(r.firing, simulated) }).where(and(eq(adRuleEvents.id, r.id), isNull(adRuleEvents.appliedAt)))
  }
  if (plan.clear.length) {
    await db.update(adRuleEvents)
      .set({ action: 'none', detail: sql`coalesce(${adRuleEvents.detail}, '{}'::jsonb) || '{"cleared": true}'::jsonb` })
      .where(and(inArray(adRuleEvents.id, plan.clear), isNull(adRuleEvents.appliedAt)))
  }

  await recordFiringsInLedger(firingEvents, simulated)

  let r7Summary: RulesRunSummary['r7'] = null
  if (result.r7) {
    const already = events.some(e => e.ruleId === 'R7' && e.firedAt.toISOString().slice(0, 10) === day && e.action !== 'undo'
      && !events.some(u => u.action === 'undo' && (u.detail as { undoes?: number } | null)?.undoes === e.id))
    if (!already) r7Summary = await applyR7(result.r7, window, day, simulated, now)
  }

  return {
    day, simulated, evaluated: window.creatives.length,
    fired: result.firings.map(f => ({ ruleId: f.ruleId, creativeId: f.creativeId, action: f.action, sentence: f.sentence })),
    inserted: plan.inserts.length, refreshed: plan.refresh.length, cleared: plan.clear.length,
    r7: r7Summary,
    objectives,
  }
}

/** Rule actions that map to a platform change. flag and none never reach the ledger. */
const LEDGER_ACTION: Partial<Record<string, PlatformAction>> = {
  pause: 'pause', revive: 'resume', scale: 'scale', brake: 'brake', refresh: 'refresh',
}

/**
 * Phase 4c hook (ticket #16429): every firing with a platform action also goes
 * through the ledger dispatcher, so each one leaves an ad_actions row. With a
 * valve off the row is dry_run; the dispatcher decides, not this code.
 */
async function recordFiringsInLedger(items: Array<{ firing: RuleFired; eventId: number | null }>, simulated: boolean): Promise<void> {
  const todo = items.filter(i => i.firing.creativeId != null && !i.firing.held && LEDGER_ACTION[i.firing.action])
  if (!todo.length) return
  const ids = [...new Set(todo.map(i => i.firing.creativeId as number))]
  const rows = await db.select({ id: adCreatives.id, externalAdId: adCreatives.externalAdId, lane: adCreatives.lane, budgetMultiplier: adCreatives.budgetMultiplier })
    .from(adCreatives).where(inArray(adCreatives.id, ids))
  const byId = new Map(rows.filter(r => ids.includes(r.id)).map(r => [r.id, r]))
  for (const { firing, eventId } of todo) {
    const c = byId.get(firing.creativeId as number)
    if (!c) continue
    const action = LEDGER_ACTION[firing.action]!
    const mult = Number(c.budgetMultiplier ?? 1) || 1
    const inputs = firing.inputs as { upPct?: unknown; downPct?: unknown }
    const pct = action === 'scale' ? Number(inputs.upPct) : action === 'brake' ? Number(inputs.downPct) : NaN
    const nextMult = Number.isFinite(pct) && (action === 'scale' || action === 'brake') ? nextMultiplier(mult, action, pct) : mult
    await platformApply(
      {
        creativeId: c.id, externalAdId: c.externalAdId ?? null, lane: c.lane ?? null, action,
        budgetMultiplier: nextMult, previousBudgetMultiplier: mult, reason: firing.sentence,
        ruleEventId: eventId, proposedBy: `rule:${firing.ruleId}`,
      },
      { spendEnabled: !simulated },
    )
  }
}

const R7_HALT_CHANNELS = new Set(['meta', 'microsoft', 'google', 'snap'])

/** The channels R7 halts: each distinct channel lane among the live creatives, Meta when none names one. */
export function r7HaltLanes(lanes: ReadonlyArray<string | null | undefined>): string[] {
  const out = [...new Set(lanes.filter((l): l is string => !!l && R7_HALT_CHANNELS.has(l)))].sort()
  return out.length ? out : ['meta']
}

async function applyR7(
  r7: NonNullable<ReturnType<typeof evaluateRules>['r7']>,
  window: RulesWindow,
  day: string,
  simulated: boolean,
  now: Date,
): Promise<NonNullable<RulesRunSummary['r7']>> {
  const live = window.creatives.filter(c => !c.paused && c.creativeId != null)
  const ids = live.map(c => c.creativeId as number)
  const before = ids.length
    ? await db.select({ creativeId: adCreatives.id, pausedAt: adCreatives.pausedAt, pauseReason: adCreatives.pauseReason, lane: adCreatives.lane, externalAdId: adCreatives.externalAdId })
        .from(adCreatives).where(inArray(adCreatives.id, ids))
    : []
  const [event] = await db.insert(adRuleEvents).values({
    ruleId: 'R7', creativeId: null, action: 'pause',
    detail: {
      sentence: r7.sentence, inputs: r7.inputs, simulation: simulated, pausedKeys: ids,
      beforeAll: before.map(b => ({ creativeId: b.creativeId, pausedAt: b.pausedAt ? b.pausedAt.toISOString() : null, pauseReason: b.pauseReason })),
    },
    appliedBy: 'rule:R7', appliedAt: now,
  }).returning({ id: adRuleEvents.id })
  if (ids.length) {
    await db.update(adCreatives).set({ pausedAt: now, pauseReason: r7.sentence, updatedAt: now })
      .where(and(inArray(adCreatives.id, ids), isNull(adCreatives.pausedAt)))
    // Ticket #16432: one halt_all per channel, not one pause per ad. A halt is
    // one action against the daily cap and sits outside the 3-a-day automatic
    // pause cap, so the spend guard cannot be swallowed by the pauses before it.
    for (const lane of r7HaltLanes(before.map(b => b.lane))) {
      await platformApply(
        {
          creativeId: null, externalAdId: null, lane, action: 'halt', budgetMultiplier: 1, reason: r7.sentence,
          ruleEventId: event?.id ?? null, proposedBy: 'rule:R7',
        },
        { spendEnabled: !simulated },
      )
    }
  }
  const alert = await raiseR7Alert(day, r7.sentence, ids.length)
  return { eventId: event!.id, trigger: r7.trigger, pausedCreatives: ids.length, alert }
}

// ---------------------------------------------------------------------------
// applyRuleAction: what a Live tap does
// ---------------------------------------------------------------------------

export type ApplyKind = LiveActionKind

export interface ApplyOptions {
  /** The recommended rule's id when the tap follows a recommendation, else MAN. */
  ruleId?: string | null
  /** The sentence to record as the pause reason. */
  reason?: string | null
  now?: Date
}

export interface ApplyResult {
  eventId: number
  simulated: boolean
  message: string
  platform: PlatformApplyResult
  budgetMultiplier: number
}

const EVENT_VERB: Record<ApplyKind, string> = { pause: 'pause', resume: 'resume', scale: 'scale', brake: 'brake', refresh: 'refresh' }
/** Which unapplied recommendation rows a tap resolves. */
const RESOLVES: Record<ApplyKind, string[]> = { pause: ['pause'], resume: ['revive'], scale: ['scale'], brake: ['brake'], refresh: ['refresh'] }

function round3(n: number): number { return Math.round(n * 1000) / 1000 }

export function nextMultiplier(current: number, kind: 'scale' | 'brake', pct: number): number {
  const factor = kind === 'scale' ? 1 + pct / 100 : 1 - pct / 100
  return Math.min(20, Math.max(0.05, round3(current * factor)))
}

export async function applyRuleAction(
  creativeId: number,
  kind: ApplyKind,
  actor: string,
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const now = opts.now ?? new Date()
  const [c] = await db.select({
    id: adCreatives.id, pausedAt: adCreatives.pausedAt, pauseReason: adCreatives.pauseReason,
    budgetMultiplier: adCreatives.budgetMultiplier, externalAdId: adCreatives.externalAdId, lane: adCreatives.lane,
  }).from(adCreatives).where(eq(adCreatives.id, creativeId))
  if (!c) throw new AdMetricsError('Unknown creative.', 'bad_request')

  const [thresholds, dailyCap, spendEnabled] = await Promise.all([getAdsRuleThresholds(), getAdsMediaDailyCapCents(), getAdsSpendEnabled()])
  const simulated = !spendEnabled
  const ruleId = opts.ruleId && /^[RL][1-8]$/.test(opts.ruleId) ? opts.ruleId : 'MAN'
  const mult = Number(c.budgetMultiplier ?? 1) || 1

  if (kind === 'pause' && c.pausedAt != null) throw new AdMetricsError(`#${creativeId} is already paused.`)
  if (kind === 'resume' && c.pausedAt == null) throw new AdMetricsError(`#${creativeId} is not paused.`)

  // The unapplied recommendation rows this tap answers. The first one's sentence
  // becomes the pause reason, so "why is this paused" reads the rule's own words.
  const open = await db.select({ id: adRuleEvents.id, detail: adRuleEvents.detail }).from(adRuleEvents).where(and(
    eq(adRuleEvents.creativeId, creativeId), isNull(adRuleEvents.appliedAt),
    inArray(adRuleEvents.action, RESOLVES[kind]), sql`${adRuleEvents.ruleId} <> 'MAN'`,
  ))
  const ruleSentenceText = (open[0]?.detail as { sentence?: string } | null)?.sentence ?? null

  const before = {
    pausedAt: c.pausedAt ? c.pausedAt.toISOString() : null,
    pauseReason: c.pauseReason ?? null,
    budgetMultiplier: mult,
  }
  let nextMult = mult
  let pct: number | null = null
  const patch: Partial<typeof adCreatives.$inferInsert> = {}

  if (kind === 'pause') {
    patch.pausedAt = now
    patch.pauseReason = (opts.reason ?? ruleSentenceText)?.slice(0, 500) || (ruleId === 'MAN' ? `Paused by ${actor}` : `Paused by ${actor} on ${ruleId}`)
  } else if (kind === 'resume') {
    patch.pausedAt = null
    patch.pauseReason = null
  } else if (kind === 'scale') {
    if (c.pausedAt != null) throw new AdMetricsError('Resume it first.')
    const from = addDays(todayUtc(now), -6)
    const [spent] = await db.select({ spend: sql<number>`coalesce(sum(${adCreativeDailyMetrics.spendCents}), 0)::int` })
      .from(adCreativeDailyMetrics).where(and(eq(adCreativeDailyMetrics.creativeId, creativeId), gte(adCreativeDailyMetrics.day, from)))
    const cap = cappedScalePct((spent?.spend ?? 0) / 7, dailyCap, thresholds.ads_rule_r5_budget_up_pct)
    if (cap.held) throw new AdMetricsError(`Scale held: #${creativeId} already spends the ${formatMoney(dailyCap)} daily cap.`)
    pct = cap.pct
    nextMult = nextMultiplier(mult, 'scale', pct)
    patch.budgetMultiplier = String(nextMult)
  } else if (kind === 'brake') {
    if (c.pausedAt != null) throw new AdMetricsError('Resume it first.')
    pct = thresholds.ads_rule_r6_budget_down_pct
    nextMult = nextMultiplier(mult, 'brake', pct)
    patch.budgetMultiplier = String(nextMult)
  } else if (c.pausedAt != null) {
    throw new AdMetricsError('Resume it first.')
  }

  if (Object.keys(patch).length) {
    await db.update(adCreatives).set({ ...patch, updatedAt: now }).where(eq(adCreatives.id, creativeId))
  }

  // Resolve the unapplied recommendation rows this tap answers.
  const resolves = open.map(o => o.id)
  if (resolves.length) {
    await db.update(adRuleEvents).set({ appliedBy: actor, appliedAt: now }).where(and(inArray(adRuleEvents.id, resolves), isNull(adRuleEvents.appliedAt)))
  }

  const verb = kind === 'resume' && ruleId === 'R4' ? 'revive' : EVENT_VERB[kind]
  const platform = await platformApply(
    {
      creativeId, externalAdId: c.externalAdId ?? null, lane: c.lane ?? null,
      action: kind, budgetMultiplier: nextMult, reason: opts.reason ?? `${kind} by ${actor}`,
      previousBudgetMultiplier: mult, ruleEventId: resolves[0] ?? null, proposedBy: actor,
    },
    { spendEnabled },
  )
  const [row] = await db.insert(adRuleEvents).values({
    ruleId, creativeId, action: verb,
    detail: {
      simulation: simulated, before,
      after: { pausedAt: patch.pausedAt === undefined ? before.pausedAt : patch.pausedAt ? now.toISOString() : null, budgetMultiplier: nextMult },
      ...(pct != null ? { pct } : {}),
      ...(resolves.length ? { resolves } : {}),
      platform: { applied: platform.applied, note: platform.note, ...(platform.error ? { error: true } : {}) },
    },
    appliedBy: actor, appliedAt: now,
  }).returning({ id: adRuleEvents.id })
  if (!row) throw new AdMetricsError('Could not record the action.', 'write_failed')

  const noun = `#${creativeId}`
  const tail = simulated ? ' in simulation' : ''
  const messages: Record<ApplyKind, string> = {
    pause: simulated ? `Paused ${noun} in simulation. Nothing was live.` : `Paused ${noun}.`,
    resume: simulated ? `Resumed ${noun} in simulation. Nothing was live.` : `Resumed ${noun}.`,
    scale: `Scaled ${noun} budget ${pct ?? 20}%${tail}.`,
    brake: `Braked ${noun} budget ${pct ?? 30}%${tail}.`,
    refresh: `Refresh queued for ${noun} on the next render pass.`,
  }
  const message = platform.error ? `${messages[kind]} The platform call failed: ${platform.note}` : messages[kind]
  return { eventId: row.id, simulated, message, platform, budgetMultiplier: nextMult }
}
