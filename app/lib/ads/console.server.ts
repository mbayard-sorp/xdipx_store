/**
 * Ads console overview, the database half (ticket #16411, plan section 4).
 *
 *   loadOverview()  every figure and alert on /admin/ads
 *   loadTopBar()    today's spend against the daily cap, for the sticky bar
 *
 * No platform call happens in the request path. Everything comes from the
 * entity mirror (ad_platform_entities), the insights table
 * (ad_platform_insights_daily), attributed orders (ad_creative_daily_metrics),
 * the ledger (ad_actions), rule events (ad_rule_events), token readings
 * (ad_channel_health) and the ads settings.
 *
 * Spend, leads and CPL come from the Meta insights rows at ad level only, so
 * campaign and ad set rows for the same money are never added twice. CPA
 * divides that spend by orders attributed in ad_creative_daily_metrics.
 *
 * Each read fails on its own: a failed read becomes null, its figures show
 * "unknown", and its name lands in `failed`. The page never shows a false $0.
 */
import { and, eq, gte, inArray, lte, max, or, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adActions, adCreativeDailyMetrics, adPlatformEntities, adPlatformInsightsDaily, adRuleEvents } from '../../../db/schema'
import {
  getAdsLeadCplCeilingCents, getAdsMediaDailyCapCents, getAdsMediaMonthlyCapCents, getAdsSpendEnabled,
} from '~/lib/ad-settings.server'
import { currentBreakEven } from '~/lib/ad-metrics.server'
import { readChannelHealth } from './token-health.server'
import type { BreakEven } from '~/lib/ad-metrics-core'
import {
  PROBLEM_STATUSES, assembleOverview, shiftDay, ymdUtc,
  type AttributedDay, type ChannelHealthLite, type EntityLevelLite, type EntityStatusCount, type Freshness,
  type InsightsDay, type Overview, type OverviewSettings, type ProblemEntityRow, type RuleEventLite,
} from './console-core'

export * from './console-core'

/** The one platform the mirror and insights pull cover today. */
const PLATFORM = 'meta'

/** Every read loadOverview makes, so a test can hand in rows without a database. */
export interface OverviewSource {
  settings(): Promise<OverviewSettings>
  breakEven(now: Date): Promise<BreakEven>
  insightsByDay(from: string, to: string): Promise<InsightsDay[]>
  attributedByDay(from: string, to: string): Promise<AttributedDay[]>
  entityStatusCounts(): Promise<EntityStatusCount[]>
  problemEntities(): Promise<ProblemEntityRow[]>
  freshness(): Promise<Freshness>
  ruleEventsSince(start: Date): Promise<RuleEventLite[]>
  pendingActionCount(): Promise<number>
  /** Null when no token reading exists yet (migration 131 not applied, or the cron has not run). */
  channelHealth(): Promise<ChannelHealthLite[] | null>
}

/**
 * Ads Manager deep link for one mirrored entity, the same URL shape as the
 * Live tab's link (ad-creative-list.server.ts), extended to campaigns and ad
 * sets. The account comes from the row, else from META_AD_ACCOUNT_ID.
 */
export function adsManagerLink(row: Pick<ProblemEntityRow, 'platform' | 'accountId' | 'level' | 'externalId'>): string | null {
  if (row.platform !== 'meta') return null
  const raw = (row.accountId || process.env['META_AD_ACCOUNT_ID'] || '').trim()
  if (!raw) return null
  const acct = encodeURIComponent(raw.replace(/^act_/, ''))
  const id = encodeURIComponent(row.externalId)
  const base = 'https://adsmanager.facebook.com/adsmanager/manage'
  switch (row.level) {
    case 'campaign': return `${base}/campaigns?act=${acct}&selected_campaign_ids=${id}`
    case 'adset': return `${base}/adsets?act=${acct}&selected_adset_ids=${id}`
    case 'ad': return `${base}/ads?act=${acct}&selected_ad_ids=${id}`
    default: return `${base}/ads?act=${acct}`
  }
}

async function readSettings(): Promise<OverviewSettings> {
  const [spendEnabled, dailyCapCents, monthlyCapCents, leadCplCeilingCents] = await Promise.all([
    getAdsSpendEnabled(), getAdsMediaDailyCapCents(), getAdsMediaMonthlyCapCents(), getAdsLeadCplCeilingCents(),
  ])
  return { spendEnabled, dailyCapCents, monthlyCapCents, leadCplCeilingCents }
}

/**
 * Token readings from ad_channel_health (migration 131), written daily by
 * /cron/ads-token-health. No rows yet, or a failed read, means "not yet
 * reported" on the page, never a made-up "ok".
 */
async function readChannelHealthLite(): Promise<ChannelHealthLite[] | null> {
  try {
    const rows = await readChannelHealth()
    if (rows.length === 0) return null
    return rows.map(r => ({ channel: r.channel, checkedAt: r.checkedAt, state: r.state, expiresAt: r.expiresAt, error: r.error }))
  } catch (err) {
    console.error('[ads-console] token health read failed', err)
    return null
  }
}

export const dbOverviewSource: OverviewSource = {
  settings: readSettings,
  breakEven: now => currentBreakEven(now),

  async insightsByDay(from, to) {
    const rows = await db
      .select({
        day: adPlatformInsightsDaily.day,
        spendCents: sql<number>`coalesce(sum(${adPlatformInsightsDaily.spendCents}), 0)::int`,
        leads: sql<number>`coalesce(sum(${adPlatformInsightsDaily.leads}), 0)::int`,
      })
      .from(adPlatformInsightsDaily)
      .where(and(
        eq(adPlatformInsightsDaily.platform, PLATFORM),
        eq(adPlatformInsightsDaily.level, 'ad'),
        gte(adPlatformInsightsDaily.day, from),
        lte(adPlatformInsightsDaily.day, to),
      ))
      .groupBy(adPlatformInsightsDaily.day)
    return rows.map(r => ({ day: String(r.day), spendCents: Number(r.spendCents), leads: Number(r.leads) }))
  },

  async attributedByDay(from, to) {
    const rows = await db
      .select({
        day: adCreativeDailyMetrics.day,
        orders: sql<number>`coalesce(sum(${adCreativeDailyMetrics.orders}), 0)::int`,
        netRevenueCents: sql<number>`coalesce(sum(${adCreativeDailyMetrics.netRevenueCents}), 0)::int`,
      })
      .from(adCreativeDailyMetrics)
      .where(and(gte(adCreativeDailyMetrics.day, from), lte(adCreativeDailyMetrics.day, to)))
      .groupBy(adCreativeDailyMetrics.day)
    return rows.map(r => ({ day: String(r.day), orders: Number(r.orders), netRevenueCents: Number(r.netRevenueCents) }))
  },

  async entityStatusCounts() {
    const rows = await db
      .select({
        level: adPlatformEntities.level,
        effectiveStatus: adPlatformEntities.effectiveStatus,
        n: sql<number>`count(*)::int`,
      })
      .from(adPlatformEntities)
      .where(eq(adPlatformEntities.platform, PLATFORM))
      .groupBy(adPlatformEntities.level, adPlatformEntities.effectiveStatus)
    return rows.map(r => ({ level: r.level as EntityLevelLite, effectiveStatus: r.effectiveStatus, n: Number(r.n) }))
  },

  async problemEntities() {
    const rows = await db
      .select({
        platform: adPlatformEntities.platform,
        accountId: adPlatformEntities.accountId,
        level: adPlatformEntities.level,
        externalId: adPlatformEntities.externalId,
        name: adPlatformEntities.name,
        effectiveStatus: adPlatformEntities.effectiveStatus,
        reviewFeedback: adPlatformEntities.reviewFeedback,
      })
      .from(adPlatformEntities)
      .where(inArray(adPlatformEntities.effectiveStatus, [...PROBLEM_STATUSES]))
      .orderBy(adPlatformEntities.level, adPlatformEntities.externalId)
      .limit(50)
    return rows.map(r => ({ ...r, level: r.level as EntityLevelLite, effectiveStatus: r.effectiveStatus ?? '' }))
  },

  async freshness() {
    const [[e], [i]] = await Promise.all([
      db.select({ at: max(adPlatformEntities.lastSyncedAt) }).from(adPlatformEntities).where(eq(adPlatformEntities.platform, PLATFORM)),
      db.select({ at: max(adPlatformInsightsDaily.pulledAt) }).from(adPlatformInsightsDaily).where(eq(adPlatformInsightsDaily.platform, PLATFORM)),
    ])
    const asDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)))
    return { lastEntitySyncAt: asDate(e?.at), lastInsightsPullAt: asDate(i?.at) }
  },

  async ruleEventsSince(start) {
    const rows = await db
      .select({ id: adRuleEvents.id, ruleId: adRuleEvents.ruleId, action: adRuleEvents.action, detail: adRuleEvents.detail, firedAt: adRuleEvents.firedAt })
      .from(adRuleEvents)
      .where(and(gte(adRuleEvents.firedAt, start), or(eq(adRuleEvents.ruleId, 'R7'), eq(adRuleEvents.action, 'undo'))))
    return rows.map(r => ({ ...r, detail: (r.detail ?? null) as Record<string, unknown> | null }))
  },

  async pendingActionCount() {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(adActions).where(eq(adActions.status, 'proposed'))
    return Number(row?.n ?? 0)
  },

  channelHealth: readChannelHealthLite,
}

async function attempt<T>(name: string, failed: string[], read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    console.error(`[ads-console] ${name} read failed`, err)
    failed.push(name)
    return null
  }
}

export async function loadOverview(source: OverviewSource = dbOverviewSource, now: Date = new Date()): Promise<Overview> {
  const today = ymdUtc(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const from30 = shiftDay(today, -29)
  const from = from30 < monthStart ? from30 : monthStart
  const startOfDay = new Date(`${today}T00:00:00Z`)
  const failed: string[] = []

  const [settings, breakEven, insights, attributed, entityCounts, problems, freshness, r7Events, pendingActions, channelHealth] = await Promise.all([
    source.settings(),
    source.breakEven(now),
    attempt('insights', failed, () => source.insightsByDay(from, today)),
    attempt('attributed orders', failed, () => source.attributedByDay(from, today)),
    attempt('entity counts', failed, () => source.entityStatusCounts()),
    attempt('entity problems', failed, () => source.problemEntities()),
    attempt('sync freshness', failed, () => source.freshness()),
    attempt('rule events', failed, () => source.ruleEventsSince(startOfDay)),
    attempt('pending actions', failed, () => source.pendingActionCount()),
    source.channelHealth().catch((): null => null),
  ])

  return assembleOverview({
    settings, breakEven, insights, attributed, entityCounts, problems, freshness, r7Events, pendingActions, channelHealth,
    linkFor: adsManagerLink,
  }, now, failed)
}

export interface AdsTopBar {
  /** Null when the insights read failed: the bar says "spend unknown". */
  spendTodayCents: number | null
  dailyCapCents: number
  spendEnabled: boolean
}

export async function loadTopBar(source: Pick<OverviewSource, 'settings' | 'insightsByDay'> = dbOverviewSource, now: Date = new Date()): Promise<AdsTopBar> {
  const today = ymdUtc(now)
  const [settings, rows] = await Promise.all([
    source.settings(),
    source.insightsByDay(today, today).catch((err): null => { console.error('[ads-console] top bar spend read failed', err); return null }),
  ])
  return {
    spendTodayCents: rows ? rows.filter(r => r.day === today).reduce((a, r) => a + r.spendCents, 0) : null,
    dailyCapCents: settings.dailyCapCents,
    spendEnabled: settings.spendEnabled,
  }
}
