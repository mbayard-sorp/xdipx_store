/**
 * Ads console tree, the database half (ticket #16412, plan section 4, phase 3b).
 *
 *   loadTree({ platform?, status?, campaignId? })
 *
 * Reads Neon only: the entity mirror (ad_platform_entities), 30 days of
 * insights (ad_platform_insights_daily), attributed orders per creative
 * (ad_creative_daily_metrics), the creatives' idea ids for the Ad Studio
 * link, and the ads settings. No platform call happens in the request path.
 * The aggregation itself lives in tree-core.ts.
 *
 * The mirror read is the one that must succeed: without it there is no tree,
 * so it throws and the route's error boundary says so. Insights and orders
 * fail on their own: a failed read leaves those columns empty, names itself
 * in `failed`, and the page says the figures are unknown rather than $0.
 */
import { and, eq, gte, inArray, isNotNull, lte, max, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreativeDailyMetrics, adCreatives, adPlatformEntities, adPlatformInsightsDaily } from '../../../db/schema'
import { getAdsLeadCplCeilingCents, getAdsSpendEnabled } from '~/lib/ad-settings.server'
import { currentBreakEven } from '~/lib/ad-metrics.server'
import type { BreakEven } from '~/lib/ad-metrics-core'
import { adsManagerLink } from './console.server'
import { ymdUtc, type EntityLevelLite } from './console-core'
import {
  TREE_LEVELS, buildTree, parseStatusFilter, treeWindows,
  type CreativeDayRow, type CreativeRef, type StatusFilter, type Tree, type TreeEntityRow, type TreeInsightRow,
} from './tree-core'

export * from './tree-core'

export interface TreeSource {
  settings(): Promise<{ spendEnabled: boolean; leadCplCeilingCents: number }>
  breakEven(now: Date): Promise<BreakEven>
  entities(platform: string | null): Promise<TreeEntityRow[]>
  insights(platform: string | null, from: string, to: string): Promise<TreeInsightRow[]>
  creativeDays(creativeIds: number[], from: string, to: string): Promise<CreativeDayRow[]>
  creatives(ids: number[]): Promise<CreativeRef[]>
  lastSyncedAt(): Promise<Date | null>
}

export interface LoadTreeOptions {
  platform?: string | null
  status?: string | null
  campaignId?: string | null
}

export interface TreePage extends Tree {
  today: string
  filters: { platform: string | null; status: StatusFilter; campaignId: string | null }
  simulation: boolean
  leadCplCeilingCents: number
  breakEvenRoas: number
  lastSyncedAt: string | null
  failed: string[]
}

export const dbTreeSource: TreeSource = {
  async settings() {
    const [spendEnabled, leadCplCeilingCents] = await Promise.all([getAdsSpendEnabled(), getAdsLeadCplCeilingCents()])
    return { spendEnabled, leadCplCeilingCents }
  },

  breakEven: now => currentBreakEven(now),

  async entities(platform) {
    const t = adPlatformEntities
    const rows = await db
      .select({
        platform: t.platform,
        accountId: t.accountId,
        level: t.level,
        externalId: t.externalId,
        parentExternalId: t.parentExternalId,
        name: t.name,
        status: t.status,
        effectiveStatus: t.effectiveStatus,
        objective: t.objective,
        dailyBudgetCents: t.dailyBudgetCents,
        lifetimeBudgetCents: t.lifetimeBudgetCents,
        creativeId: t.creativeId,
      })
      .from(t)
      .where(and(
        inArray(t.level, [...TREE_LEVELS]),
        platform ? eq(t.platform, platform) : undefined,
      ))
    return rows.map(r => ({ ...r, level: String(r.level) }))
  },

  async insights(platform, from, to) {
    const t = adPlatformInsightsDaily
    const rows = await db
      .select({
        level: t.level,
        externalId: t.externalId,
        day: t.day,
        spendCents: t.spendCents,
        impressions: t.impressions,
        clicks: t.clicks,
        leads: t.leads,
      })
      .from(t)
      .where(and(
        platform ? eq(t.platform, platform) : undefined,
        inArray(t.level, [...TREE_LEVELS]),
        gte(t.day, from),
        lte(t.day, to),
      ))
    return rows.map(r => ({
      level: String(r.level),
      externalId: r.externalId,
      day: String(r.day),
      spendCents: Number(r.spendCents),
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      leads: r.leads == null ? null : Number(r.leads),
    }))
  },

  async creativeDays(creativeIds, from, to) {
    if (creativeIds.length === 0) return []
    const t = adCreativeDailyMetrics
    const rows = await db
      .select({
        creativeId: t.creativeId,
        day: t.day,
        orders: sql<number>`coalesce(sum(${t.orders}), 0)::int`,
        netRevenueCents: sql<number>`coalesce(sum(${t.netRevenueCents}), 0)::int`,
      })
      .from(t)
      .where(and(isNotNull(t.creativeId), inArray(t.creativeId, creativeIds), gte(t.day, from), lte(t.day, to)))
      .groupBy(t.creativeId, t.day)
    return rows
      .filter((r): r is typeof r & { creativeId: number } => r.creativeId != null)
      .map(r => ({ creativeId: r.creativeId, day: String(r.day), orders: Number(r.orders), netRevenueCents: Number(r.netRevenueCents) }))
  },

  async creatives(ids) {
    if (ids.length === 0) return []
    return db.select({ id: adCreatives.id, ideaId: adCreatives.ideaId }).from(adCreatives).where(inArray(adCreatives.id, ids))
  },

  async lastSyncedAt() {
    const [row] = await db.select({ at: max(adPlatformEntities.lastSyncedAt) }).from(adPlatformEntities)
    const v = row?.at
    return v == null ? null : v instanceof Date ? v : new Date(String(v))
  },
}

async function attempt<T>(name: string, failed: string[], fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    console.error(`[ads-tree] ${name} read failed`, err)
    failed.push(name)
    return fallback
  }
}

export async function loadTree(
  opts: LoadTreeOptions = {},
  source: TreeSource = dbTreeSource,
  now: Date = new Date(),
): Promise<TreePage> {
  const today = ymdUtc(now)
  const windows = treeWindows(today)
  const [from, to] = windows.d30
  const platform = opts.platform?.trim() || null
  const status = parseStatusFilter(opts.status)
  const campaignId = opts.campaignId?.trim() || null
  const failed: string[] = []

  const [settings, breakEven, entities, insights, lastSyncedAt] = await Promise.all([
    source.settings(),
    source.breakEven(now),
    source.entities(platform),
    attempt('insights', failed, [] as TreeInsightRow[], () => source.insights(platform, from, to)),
    attempt('sync time', failed, null as Date | null, () => source.lastSyncedAt()),
  ])

  const creativeIds = [...new Set(entities.filter(e => e.level === 'ad' && e.creativeId != null).map(e => e.creativeId as number))]
  const [creativeDays, creatives] = await Promise.all([
    attempt('attributed orders', failed, [] as CreativeDayRow[], () => source.creativeDays(creativeIds, from, to)),
    attempt('creatives', failed, [] as CreativeRef[], () => source.creatives(creativeIds)),
  ])

  const tree = buildTree(
    { entities, insights, creativeDays, creatives, leadCplCeilingCents: settings.leadCplCeilingCents, breakEven, linkFor: r => adsManagerLink({ ...r, level: r.level as EntityLevelLite }) },
    { platform, status, campaignId },
    today,
  )

  return {
    ...tree,
    today,
    filters: { platform, status, campaignId },
    simulation: !settings.spendEnabled,
    leadCplCeilingCents: settings.leadCplCeilingCents,
    breakEvenRoas: breakEven.roas,
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    failed,
  }
}
