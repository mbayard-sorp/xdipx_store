/**
 * Insights pull for the Ads Control Plane (plan §3.4, phase 2b, ticket #16408).
 *
 * Asks a channel's adapter for ad-level daily insights over a date range and
 * writes three things, all to our own database:
 *
 * 1. ad_platform_insights_daily, one row per (platform, level, external_id,
 *    day), upserted. The hourly pull re-upserts today's row; the 09:00 UTC
 *    pull re-upserts the last 7 days because Meta restates inside its
 *    attribution window.
 * 2. ad_creative_daily_metrics with source 'api'. An ad whose mirror row in
 *    ad_platform_entities carries a creative_id lands on that creative: spend,
 *    impressions, clicks and leads, summed when several ads share a creative.
 *    orders and net_revenue_cents are never written here, because Shopify
 *    attribution owns them. Spend from ads with no creative link lands on one
 *    account-level row per day (creative_id null), the same shape the CSV
 *    import uses, so the day's ad_spend rollup and the admin P&L both see every
 *    cent the platform reports.
 * 3. Nothing in pnl_ad_spend. That table is the owner's hand-entered monthly
 *    spend, and the P&L adds it on top of ad_creative_daily_metrics
 *    (pnl-core.ts, manualAdOverlaps calls the overlap a double count). Writing
 *    Meta's daily spend there as well would count it twice. The P&L reads the
 *    api rows from step 2 directly.
 *
 * The cron body (runInsightsCron) then rolls the pulled days up into
 * daily_profit_summary.ad_spend, and on the 09:00 UTC restatement run it runs
 * the rules pass, the same two calls the ads routine makes through
 * POST /api/team/ad-metrics op daily. Every run then takes the health step
 * (health.server.ts, ticket #16410): the hourly counters and rule L3. Then
 * the applier (apply-run.server.ts, ticket #16432) expires stale proposals
 * and sends approved ledger rows under the daily cap, and the pager
 * (pager.server.ts) files owner blockers for the plan §9.8 pages. A failure
 * in any of those three is reported in its own field and never fails the pull.
 *
 * The pull itself never calls a platform write endpoint. The applier reaches
 * one only through channels/apply.server.ts, with both valves on.
 */
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'

import { db as defaultDb, type DB } from '~/lib/db.server'
import { adCreativeDailyMetrics, adPlatformEntities, adPlatformInsightsDaily } from '../../../db/schema'
import { isChannelNotReady } from './channels/errors'
import { getChannel, listChannels } from './channels/registry.server'
import type { ChannelAdapter, ChannelId, ChannelNotReadyReason, DateRange, NormalizedInsightRow, TokenHealth } from './channels/types'
import { noteChannelReadiness, summarizeTokenHealth, type RecordReadinessFn } from './token-health.server'

export const API_SOURCE = 'api'
/** The UTC hour whose run also re-pulls the last RESTATE_DAYS days and runs the rules. */
export const RESTATE_HOUR_UTC = 9
export const RESTATE_DAYS = 7

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** One ad_creative_daily_metrics row as this pull writes it. creativeId null is the account-level row. */
export interface CreativeMetricRow {
  creativeId: number | null
  day: string
  platform: string
  spendCents: number
  impressions: number
  clicks: number
  leads: number
}

/** The database half, behind an interface so the planning logic is testable without a database. */
export interface InsightsStore {
  upsertInsights(rows: NormalizedInsightRow[], now: Date): Promise<number>
  /** ad_platform_entities.creative_id keyed by external_id, for ad rows on this platform that have one. */
  creativeIdsForAds(platform: string, externalIds: string[]): Promise<Map<string, number>>
  /** Upsert on (creative_id, day, platform). Leaves orders and net_revenue_cents alone. */
  upsertCreativeMetrics(rows: CreativeMetricRow[]): Promise<number>
  /**
   * Replace this platform's api account-level rows (creative_id null) for the
   * given days with `rows`. A null key never conflicts, so upsert cannot do it.
   */
  replaceAccountMetrics(platform: string, days: string[], rows: CreativeMetricRow[]): Promise<number>
}

export interface PullResult {
  channel: ChannelId
  range: DateRange
  /** ad_platform_insights_daily rows upserted. */
  insightRows: number
  /** Distinct ads that mapped to a creative through the mirror. */
  matchedAds: number
  unmatchedAds: number
  creativeRows: number
  accountRows: number
  /** Days the platform returned rows for, plus every day in the range (each one was rewritten). */
  days: string[]
  spendCentsByDay: Record<string, number>
  pulledAt: string
}

export interface InsightsDeps {
  store?: InsightsStore
  adapterFor?: (channel: ChannelId) => ChannelAdapter | null
  now?: () => Date
  /** Stores or clears a channel's not-ready reason. Defaults to ad_channel_health. */
  recordReadiness?: RecordReadinessFn
}

export class InsightsError extends Error {
  constructor(readonly channel: string, message: string) {
    super(message)
    this.name = 'InsightsError'
  }
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return ymd(d)
}

/** Every day from since to until, inclusive. */
export function daysInRange(range: DateRange): string[] {
  const out: string[] = []
  for (let d = range.since; d <= range.until; d = addDays(d, 1)) out.push(d)
  return out
}

function assertRange(range: DateRange): void {
  if (!DAY_RE.test(range.since) || !DAY_RE.test(range.until) || range.since > range.until) {
    throw new InsightsError('-', `Bad date range ${range.since}..${range.until}.`)
  }
}

const registryAdapter = (channel: ChannelId): ChannelAdapter | null => getChannel(channel)?.adapter ?? null

/** The same (level, external_id, day) twice in one pull keeps the last copy, so one upsert never hits a row twice. */
function dedupe(rows: NormalizedInsightRow[]): NormalizedInsightRow[] {
  const byKey = new Map<string, NormalizedInsightRow>()
  for (const r of rows) byKey.set(`${r.level}|${r.externalId}|${r.day}`, r)
  return [...byKey.values()]
}

/**
 * Pure fold from ad-level insight rows to ad_creative_daily_metrics rows.
 * Ads sharing a creative are summed; ads with no creative link are summed into
 * one account-level row per day. Exported for tests.
 */
export function planCreativeMetrics(
  platform: string,
  rows: NormalizedInsightRow[],
  creativeByAd: Map<string, number>,
): { creativeRows: CreativeMetricRow[]; accountRows: CreativeMetricRow[]; matchedAds: number; unmatchedAds: number } {
  const creative = new Map<string, CreativeMetricRow>()
  const account = new Map<string, CreativeMetricRow>()
  const matched = new Set<string>()
  const unmatched = new Set<string>()
  for (const r of rows) {
    if (r.level !== 'ad') continue
    const creativeId = creativeByAd.get(r.externalId) ?? null
    ;(creativeId === null ? unmatched : matched).add(r.externalId)
    const key = `${creativeId ?? 'acct'}|${r.day}`
    const bucket = creativeId === null ? account : creative
    const acc = bucket.get(key) ?? { creativeId, day: r.day, platform, spendCents: 0, impressions: 0, clicks: 0, leads: 0 }
    acc.spendCents += r.spendCents
    acc.impressions += r.impressions
    acc.clicks += r.clicks
    acc.leads += r.leads
    bucket.set(key, acc)
  }
  const byDay = (a: CreativeMetricRow, b: CreativeMetricRow) => a.day.localeCompare(b.day) || (a.creativeId ?? 0) - (b.creativeId ?? 0)
  return {
    creativeRows: [...creative.values()].sort(byDay),
    // A day with no spend and no delivery from unmatched ads writes no account row.
    accountRows: [...account.values()].filter(r => r.spendCents || r.impressions || r.clicks || r.leads).sort(byDay),
    matchedAds: matched.size,
    unmatchedAds: unmatched.size,
  }
}

/**
 * Pull one channel's ad-level insights for the range and store them. Throws
 * when the channel has no adapter with insights capability or the pull fails;
 * a failed pull writes nothing.
 */
export async function pullChannelInsights(
  channelId: ChannelId,
  range: DateRange,
  deps: InsightsDeps = {},
): Promise<PullResult> {
  assertRange(range)
  const adapter = (deps.adapterFor ?? registryAdapter)(channelId)
  if (!adapter) throw new InsightsError(channelId, `Channel ${channelId} has no adapter.`)
  if (!adapter.capabilities.insights) throw new InsightsError(channelId, `Channel ${channelId} cannot report insights.`)
  const store = deps.store ?? drizzleInsightsStore()
  const now = (deps.now ?? (() => new Date()))()

  const pulled = dedupe(await adapter.pullInsights(range, 'ad'))
    // Belt and braces: an adapter that strays outside the range must not rewrite days we did not ask for.
    .filter(r => r.day >= range.since && r.day <= range.until)
    .map(r => ({ ...r, platform: channelId }))

  const insightRows = pulled.length > 0 ? await store.upsertInsights(pulled, now) : 0

  const adIds = [...new Set(pulled.filter(r => r.level === 'ad').map(r => r.externalId))]
  const creativeByAd = adIds.length > 0 ? await store.creativeIdsForAds(channelId, adIds) : new Map<string, number>()
  const plan = planCreativeMetrics(channelId, pulled, creativeByAd)

  const creativeRows = plan.creativeRows.length > 0 ? await store.upsertCreativeMetrics(plan.creativeRows) : 0
  // Every day in the range is replaced, so an unmatched ad that later gained a
  // creative link, or a day Meta restated to zero, does not leave a stale row.
  const rangeDays = daysInRange(range)
  const accountRows = await store.replaceAccountMetrics(channelId, rangeDays, plan.accountRows)

  const spendCentsByDay: Record<string, number> = {}
  for (const d of rangeDays) spendCentsByDay[d] = 0
  for (const r of pulled) if (r.level === 'ad') spendCentsByDay[r.day] = (spendCentsByDay[r.day] ?? 0) + r.spendCents

  return {
    channel: channelId,
    range,
    insightRows,
    matchedAds: plan.matchedAds,
    unmatchedAds: plan.unmatchedAds,
    creativeRows,
    accountRows,
    days: rangeDays,
    spendCentsByDay,
    pulledAt: now.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// The cron body.
// ---------------------------------------------------------------------------

export interface ChannelInsightsReport {
  channel: ChannelId
  outcome: 'pulled' | 'skipped' | 'failed'
  result?: PullResult
  reason?: string
  /** Set when the channel was skipped because its account cannot be used yet. */
  notReady?: ChannelNotReadyReason
  health?: Pick<TokenHealth, 'valid' | 'expiresAt' | 'error' | 'ready' | 'notReadyReason'>
}

export interface RollupOutcome {
  day: string
  spendCents: number
  written: boolean
  reason?: string
}

export type RulesOutcome = { ok: true; summary: unknown } | { ok: false; error: string }

/** The health step's outcome. A failure is reported here and never fails the pull. */
export type HealthOutcome = { ok: true; summary: unknown } | { ok: false; error: string }

export interface InsightsCronResult {
  restatement: boolean
  range: DateRange
  channels: ChannelInsightsReport[]
  rollup: RollupOutcome[]
  /** Present only on the restatement run. */
  rules?: RulesOutcome
  /** The hourly health counters and L3 (health.server.ts). Present on every run. */
  health: HealthOutcome
  /** The applier (apply-run.server.ts): expiry, then approved rows under the cap. Never fails the pull. */
  apply: StepOutcome
  /** The pager checks (pager.server.ts). Never fails the pull. */
  pager: StepOutcome
}

/** A step that reports its own failure and never fails the pull. */
export type StepOutcome = { ok: true; summary: unknown } | { ok: false; error: string }

export interface InsightsCronDeps extends InsightsDeps {
  channels?: () => ChannelId[]
  /** Defaults to rollupDaily from ad-metrics.server. */
  rollup?: (day: string) => Promise<RollupOutcome>
  /** Defaults to runRulesDaily from ad-rules.server. */
  runRules?: (now: Date) => Promise<unknown>
  /** Force the 7-day restatement and the rules pass regardless of the hour. */
  restate?: boolean
  /** Defaults to runAdHealth from health.server. */
  health?: (now: Date) => Promise<unknown>
  /** Defaults to applyApprovedActions from apply-run.server. */
  apply?: (now: Date) => Promise<unknown>
  /** Defaults to runPagerChecks from pager.server. */
  pager?: (now: Date) => Promise<unknown>
}

/** The range one cron run pulls: today and yesterday, or the last 7 days plus today on the restatement run. */
export function cronRange(now: Date, restatement: boolean): DateRange {
  const today = ymd(now)
  return { since: addDays(today, restatement ? -RESTATE_DAYS : -1), until: today }
}

export function isRestatementRun(now: Date): boolean {
  return now.getUTCHours() === RESTATE_HOUR_UTC
}

/**
 * Pull every channel with insights capability and a valid token, roll the
 * pulled days up into daily_profit_summary.ad_spend, and on the 09:00 UTC run
 * (or with restate) also run the rules pass. One channel failing does not stop
 * the others. A token problem skips the channel; the token health cron files
 * the blocker. A ChannelNotReadyError (an account the platform will not serve
 * yet) skips the channel with its reason and is stored for the Channels page.
 *
 * The rollup runs on every hourly pass because it is two small queries per
 * day and keeps ad_spend current through the day. The rules run once a day,
 * after the restatement, so they judge settled numbers.
 */
export async function runInsightsCron(deps: InsightsCronDeps = {}): Promise<InsightsCronResult> {
  const now = (deps.now ?? (() => new Date()))()
  const restatement = deps.restate === true || isRestatementRun(now)
  const range = cronRange(now, restatement)
  const ids = deps.channels
    ? deps.channels()
    : listChannels().filter(c => c.hasAdapter && c.capabilities?.insights).map(c => c.id)
  const adapterFor = deps.adapterFor ?? registryAdapter

  const channels: ChannelInsightsReport[] = []
  for (const channel of ids) {
    const adapter = adapterFor(channel)
    if (!adapter || !adapter.capabilities.insights) {
      channels.push({ channel, outcome: 'skipped', reason: 'no adapter with insights' })
      continue
    }
    let health: TokenHealth
    try {
      health = await adapter.auth.health()
    } catch (e) {
      channels.push({ channel, outcome: 'skipped', reason: `health check threw: ${(e as Error).message}` })
      continue
    }
    const healthSummary = summarizeTokenHealth(health)
    if (!health.valid) {
      channels.push({ channel, outcome: 'skipped', reason: `token not valid: ${health.error ?? 'invalid'}`, health: healthSummary })
      continue
    }
    try {
      const result = await pullChannelInsights(channel, range, { ...deps, adapterFor: () => adapter, now: () => now })
      channels.push({ channel, outcome: 'pulled', result, health: healthSummary })
      await noteChannelReadiness(deps.recordReadiness, channel, health, null)
    } catch (e) {
      if (isChannelNotReady(e)) {
        // A good token on an account the platform will not serve yet (Microsoft
        // Pending in the Adult Advertising Program): skipped with the reason,
        // so this money cron stays green for the channels that did pull.
        channels.push({ channel, outcome: 'skipped', reason: `${e.reason}: ${e.message}`, notReady: e.reason, health: healthSummary })
        await noteChannelReadiness(deps.recordReadiness, channel, health, e.reason)
        continue
      }
      channels.push({ channel, outcome: 'failed', reason: (e as Error).message, health: healthSummary })
    }
  }

  const pulledDays = [...new Set(channels.flatMap(c => c.result?.days ?? []))].sort()
  const rollup: RollupOutcome[] = []
  if (pulledDays.length > 0) {
    const rollupDay = deps.rollup ?? (async (day: string) => (await import('~/lib/ad-metrics.server')).rollupDaily(day))
    for (const day of pulledDays) rollup.push(await rollupDay(day))
  }

  const out: Omit<InsightsCronResult, 'health' | 'apply' | 'pager'> = { restatement, range, channels, rollup }
  if (restatement) {
    const runRules = deps.runRules ?? (async (at: Date) => (await import('~/lib/ad-rules.server')).runRulesDaily(at))
    // Same contract as POST /api/team/ad-metrics op daily: the rules read what
    // the rollup just wrote, and a rules failure never hides the pull result.
    out.rules = await runRules(now).then(
      (summary): RulesOutcome => ({ ok: true, summary }),
      (err: unknown): RulesOutcome => {
        console.error('[ads-insights] runRulesDaily failed', err)
        return { ok: false, error: err instanceof Error ? err.message : 'rules pass failed' }
      },
    )
  }

  // The health step runs whether or not any channel pulled: /hello and the
  // lead counter matter even with the token down. It never fails the pull.
  const runHealth = deps.health ?? (async (at: Date) => summarizeHealth(await (await import('./health.server')).runAdHealth({ now: () => at })))
  const health = await runHealth(now).then(
    (summary): HealthOutcome => ({ ok: true, summary }),
    (err: unknown): HealthOutcome => {
      console.error('[ads-insights] health step failed', err)
      return { ok: false, error: err instanceof Error ? err.message : 'health step failed' }
    },
  )

  // Phase 5b (ticket #16432): apply approved ledger rows, then the pager. Both
  // run after health, one after the other, and neither can fail the pull.
  const step = (name: string, fn: (at: Date) => Promise<unknown>): Promise<StepOutcome> => fn(now).then(
    (summary): StepOutcome => ({ ok: true, summary }),
    (err: unknown): StepOutcome => {
      console.error(`[ads-insights] ${name} step failed`, err)
      return { ok: false, error: err instanceof Error ? err.message : `${name} step failed` }
    },
  )
  const apply = await step('apply', deps.apply
    ?? (async (at: Date) => (await import('./apply-run.server')).applyApprovedActions({ now: () => at })))
  const pager = await step('pager', deps.pager
    ?? (async (at: Date) => (await import('./pager.server')).runPagerChecks({ now: () => at })))
  return { ...out, health, apply, pager }
}

/** The cron response carries the verdicts and the values, not every detail blob. */
function summarizeHealth(r: import('./health.server').AdHealthResult) {
  return {
    samples: Object.fromEntries(r.samples.map(s => [s.key, s.value])),
    l3: { fires: r.l3.fires, reasons: r.l3.reasons, sentence: r.l3.sentence, landingViews6h: r.l3.landingViews6h, leadPosts6h: r.l3.leadPosts6h },
    ruleEvent: r.ruleEvent,
    funnelBlocker: r.funnelBlocker,
    growthBlocker: r.growthBlocker,
  }
}

// ---------------------------------------------------------------------------
// The Drizzle store.
// ---------------------------------------------------------------------------

const UPSERT_CHUNK = 200

/** The INSERT ... ON CONFLICT for one chunk of insight rows. Exported so a test can read its SQL. */
export function buildInsightsUpsertQuery(database: DB, rows: NormalizedInsightRow[], now: Date) {
  const t = adPlatformInsightsDaily
  return database
    .insert(t)
    .values(rows.map(r => ({
      platform: r.platform,
      level: r.level,
      externalId: r.externalId,
      day: r.day,
      spendCents: r.spendCents,
      impressions: r.impressions,
      reach: r.reach,
      frequency: String(r.frequency),
      clicks: r.clicks,
      linkClicks: r.linkClicks,
      leads: r.leads,
      platformPurchases: r.platformPurchases,
      platformPurchaseValueCents: r.platformPurchaseValueCents,
      actions: r.actions,
      pulledAt: now,
    })))
    .onConflictDoUpdate({
      target: [t.platform, t.level, t.externalId, t.day],
      set: {
        spendCents: sql`excluded.spend_cents`,
        impressions: sql`excluded.impressions`,
        reach: sql`excluded.reach`,
        frequency: sql`excluded.frequency`,
        clicks: sql`excluded.clicks`,
        linkClicks: sql`excluded.link_clicks`,
        leads: sql`excluded.leads`,
        platformPurchases: sql`excluded.platform_purchases`,
        platformPurchaseValueCents: sql`excluded.platform_purchase_value_cents`,
        actions: sql`excluded.actions`,
        pulledAt: sql`excluded.pulled_at`,
      },
    })
}

/** The creative-level upsert. Exported so a test can prove orders and net revenue are never in the SET. */
export function buildCreativeMetricsUpsertQuery(database: DB, rows: CreativeMetricRow[]) {
  const t = adCreativeDailyMetrics
  return database
    .insert(t)
    .values(rows.map(r => ({
      creativeId: r.creativeId,
      day: r.day,
      platform: r.platform,
      spendCents: r.spendCents,
      impressions: r.impressions,
      clicks: r.clicks,
      leads: r.leads,
      source: API_SOURCE,
    })))
    .onConflictDoUpdate({
      target: [t.creativeId, t.day, t.platform],
      // orders and net_revenue_cents belong to Shopify attribution.
      set: {
        spendCents: sql`excluded.spend_cents`,
        impressions: sql`excluded.impressions`,
        clicks: sql`excluded.clicks`,
        leads: sql`excluded.leads`,
        source: sql`excluded.source`,
      },
    })
}

export function drizzleInsightsStore(database: DB = defaultDb): InsightsStore {
  return {
    async upsertInsights(rows, now) {
      let n = 0
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const part = rows.slice(i, i + UPSERT_CHUNK)
        await buildInsightsUpsertQuery(database, part, now)
        n += part.length
      }
      return n
    },

    async creativeIdsForAds(platform, externalIds) {
      const out = new Map<string, number>()
      if (externalIds.length === 0) return out
      const t = adPlatformEntities
      const rows = await database
        .select({ externalId: t.externalId, creativeId: t.creativeId })
        .from(t)
        .where(and(eq(t.platform, platform), eq(t.level, 'ad'), inArray(t.externalId, externalIds)))
      for (const r of rows) if (r.creativeId != null) out.set(r.externalId, r.creativeId)
      return out
    },

    async upsertCreativeMetrics(rows) {
      let n = 0
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const part = rows.slice(i, i + UPSERT_CHUNK)
        await buildCreativeMetricsUpsertQuery(database, part)
        n += part.length
      }
      return n
    },

    async replaceAccountMetrics(platform, days, rows) {
      if (days.length === 0) return 0
      const sorted = [...days].sort()
      const t = adCreativeDailyMetrics
      await database.delete(t).where(and(
        isNull(t.creativeId),
        eq(t.platform, platform),
        eq(t.source, API_SOURCE),
        gte(t.day, sorted[0]!),
        lte(t.day, sorted[sorted.length - 1]!),
      ))
      if (rows.length === 0) return 0
      await database.insert(t).values(rows.map(r => ({
        creativeId: null,
        day: r.day,
        platform: r.platform,
        spendCents: r.spendCents,
        impressions: r.impressions,
        clicks: r.clicks,
        leads: r.leads,
        source: API_SOURCE,
      })))
      return rows.length
    },
  }
}
