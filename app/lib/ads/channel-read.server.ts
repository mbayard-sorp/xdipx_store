/**
 * Read-only view of one channel's mirror, for routines that hold the team
 * token but not the platform's own key. R-EXO reads ExoClick this way, so the
 * key (which can spend) stays in production. Reads only the mirror tables.
 */
import { and, eq, gte } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adPlatformEntities, adPlatformInsightsDaily } from '../../../db/schema'

export interface ChannelEntityRow {
  level: string
  externalId: string
  parentExternalId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
  lastSyncedAt: Date | string | null
}

export interface ChannelInsightRow {
  level: string
  externalId: string
  day: string
  spendCents: number
  impressions: number
  clicks: number
}

/**
 * Pure: totals one level only, because a channel can mirror the same spend at
 * ad and campaign level and adding both would double it. Ad level wins.
 */
export function summarizeChannelInsights(rows: ChannelInsightRow[]) {
  const level = rows.some(r => r.level === 'ad') ? 'ad' : 'campaign'
  const counted = rows.filter(r => r.level === level)
  const byExternalId: Record<string, { spendCents: number; impressions: number; clicks: number }> = {}
  const totals = { spendCents: 0, impressions: 0, clicks: 0 }
  for (const r of counted) {
    const row = (byExternalId[r.externalId] ??= { spendCents: 0, impressions: 0, clicks: 0 })
    row.spendCents += r.spendCents
    row.impressions += r.impressions
    row.clicks += r.clicks
    totals.spendCents += r.spendCents
    totals.impressions += r.impressions
    totals.clicks += r.clicks
  }
  return { level, totals, byExternalId }
}

export async function readChannelMirror(platform: string, sinceDay: string) {
  const entities: ChannelEntityRow[] = await db
    .select({
      level: adPlatformEntities.level,
      externalId: adPlatformEntities.externalId,
      parentExternalId: adPlatformEntities.parentExternalId,
      name: adPlatformEntities.name,
      status: adPlatformEntities.status,
      effectiveStatus: adPlatformEntities.effectiveStatus,
      dailyBudgetCents: adPlatformEntities.dailyBudgetCents,
      lifetimeBudgetCents: adPlatformEntities.lifetimeBudgetCents,
      lastSyncedAt: adPlatformEntities.lastSyncedAt,
    })
    .from(adPlatformEntities)
    .where(eq(adPlatformEntities.platform, platform))
  const insights: ChannelInsightRow[] = await db
    .select({
      level: adPlatformInsightsDaily.level,
      externalId: adPlatformInsightsDaily.externalId,
      day: adPlatformInsightsDaily.day,
      spendCents: adPlatformInsightsDaily.spendCents,
      impressions: adPlatformInsightsDaily.impressions,
      clicks: adPlatformInsightsDaily.clicks,
    })
    .from(adPlatformInsightsDaily)
    .where(and(eq(adPlatformInsightsDaily.platform, platform), gte(adPlatformInsightsDaily.day, sinceDay)))
  return { platform, sinceDay, entities, insights: summarizeChannelInsights(insights) }
}
