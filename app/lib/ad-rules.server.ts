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
 */
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreativeDailyMetrics, adCreatives, adRuleEvents } from '../../db/schema'
import { getAdsMediaDailyCapCents, getAdsRuleThresholds, getAdsSpendEnabled } from '~/lib/ad-settings.server'
import { AdMetricsError, addDays, currentBreakEven, todayUtc } from '~/lib/ad-metrics.server'
import { formatMoney, type LiveActionKind } from '~/lib/ad-metrics-core'
import { platformApply, type PlatformApplyResult } from '~/lib/ad-platform-apply.server'
import {
  cappedScalePct, evaluateRules,
  type CreativeRuleInput, type RuleEventHistory, type RuleFired, type RulesSettings, type RulesWindow,
} from '~/lib/ad-rules-core'
import type { DailyPoint } from '~/lib/ad-metrics-core'

export * from '~/lib/ad-rules-core'

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

export interface LoadedWindow {
  window: RulesWindow
  events: EventRow[]
}

export async function loadRulesWindow(now: Date): Promise<LoadedWindow> {
  const today = todayUtc(now)
  const from = addDays(today, -LOOKBACK_DAYS)
  const [creatives, metrics, events] = await Promise.all([
    db.select({
      id: adCreatives.id, pausedAt: adCreatives.pausedAt, launchedAt: adCreatives.launchedAt, budgetMultiplier: adCreatives.budgetMultiplier,
    }).from(adCreatives),
    db.select().from(adCreativeDailyMetrics).where(gte(adCreativeDailyMetrics.day, from)),
    db.select().from(adRuleEvents).where(gte(adRuleEvents.firedAt, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS))).orderBy(asc(adRuleEvents.id)),
  ])
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
  for (const c of creatives) {
    const rows = byCreative.get(c.id) ?? []
    const recentlyActive = rows.some(r => r.day >= recent)
    if (!recentlyActive && c.launchedAt == null && c.pausedAt == null) continue
    inputs.push({
      key: String(c.id), creativeId: c.id, label: `#${c.id}`,
      paused: c.pausedAt != null,
      launchedAt: c.launchedAt ? c.launchedAt.toISOString() : null,
      frequency: null,
      budgetMultiplier: Number(c.budgetMultiplier ?? 1) || 1,
      days: foldDays(rows),
      events: history.get(c.id) ?? [],
    })
  }
  return { window: { creatives: inputs, accountDays: foldDays(metrics) }, events }
}

export async function loadRulesSettings(now: Date): Promise<RulesSettings & { spendEnabled: boolean }> {
  const [thresholds, dailyCapCents, breakEven, spendEnabled] = await Promise.all([
    getAdsRuleThresholds(), getAdsMediaDailyCapCents(), currentBreakEven(now), getAdsSpendEnabled(),
  ])
  return { thresholds, dailyCapCents, breakEven, spendEnabled }
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
}

function detailOf(f: RuleFired, simulated: boolean): Record<string, unknown> {
  return { sentence: f.sentence, inputs: f.inputs, simulation: simulated, ...(f.held ? { held: true } : {}) }
}

/**
 * Raise the owner alert for R7. The owner blocker list is where the store puts
 * anything only the owner can move ("it goes on the blocker list or it did not
 * happen"); the daily digest renders it in the queue and the blocker email. One
 * row per UTC day, so a bad afternoon does not file it twice.
 */
async function raiseR7Alert(day: string, sentence: string, pausedCreatives: number): Promise<'filed' | 'failed'> {
  try {
    const { fileBlocker } = await import('~/lib/owner-blockers.server')
    await fileBlocker({
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
    return 'filed'
  } catch (err) {
    console.error('[ad-rules] R7 owner alert failed', err)
    return 'failed'
  }
}

export async function runRulesDaily(now: Date = new Date()): Promise<RulesRunSummary> {
  const day = todayUtc(now)
  const [{ window, events }, settings] = await Promise.all([loadRulesWindow(now), loadRulesSettings(now)])
  const simulated = !settings.spendEnabled
  const result = evaluateRules(window, settings, now)

  const pending: PendingEvent[] = events.map(e => ({
    id: e.id, creativeId: e.creativeId, ruleId: e.ruleId, action: e.action, appliedAt: e.appliedAt ? e.appliedAt.toISOString() : null,
  }))
  const evaluatedCreativeIds = new Set(window.creatives.flatMap(c => (c.creativeId != null ? [c.creativeId] : [])))
  const plan = planPersistence({ firings: result.firings, evaluatedCreativeIds, pending })

  if (plan.inserts.length) {
    await db.insert(adRuleEvents).values(plan.inserts.map(f => ({
      ruleId: f.ruleId, creativeId: f.creativeId, action: f.action, detail: detailOf(f, simulated), appliedBy: null, appliedAt: null,
    })))
  }
  for (const r of plan.refresh) {
    await db.update(adRuleEvents).set({ detail: detailOf(r.firing, simulated) }).where(and(eq(adRuleEvents.id, r.id), isNull(adRuleEvents.appliedAt)))
  }
  if (plan.clear.length) {
    await db.update(adRuleEvents)
      .set({ action: 'none', detail: sql`coalesce(${adRuleEvents.detail}, '{}'::jsonb) || '{"cleared": true}'::jsonb` })
      .where(and(inArray(adRuleEvents.id, plan.clear), isNull(adRuleEvents.appliedAt)))
  }

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
  }
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
    for (const b of before) {
      await platformApply(
        { creativeId: b.creativeId, externalAdId: b.externalAdId ?? null, lane: b.lane ?? null, action: 'pause', budgetMultiplier: 1, reason: r7.sentence },
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
  const ruleId = opts.ruleId && /^R[1-8]$/.test(opts.ruleId) ? opts.ruleId : 'MAN'
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
