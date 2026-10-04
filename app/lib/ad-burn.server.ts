/**
 * Numbers for the Ad Studio burn bar: today's spend and orders from
 * ad_creative_daily_metrics (UTC day, the same window Neon uses), the daily
 * cap, and the spend valve. A failed read returns `ok: false` so the bar can
 * say "spend unknown" instead of showing a false $0.00.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreativeDailyMetrics } from '../../db/schema'
import { getAdsMediaDailyCapCents, getAdsSpendEnabled } from '~/lib/ad-settings.server'

export interface AdBurn {
  ok: boolean
  day: string
  spendCents: number | null
  ordersToday: number | null
  dailyCapCents: number
  spendEnabled: boolean
}

export async function getAdBurn(now: Date = new Date()): Promise<AdBurn> {
  const day = now.toISOString().slice(0, 10)
  const [dailyCapCents, spendEnabled] = await Promise.all([getAdsMediaDailyCapCents(), getAdsSpendEnabled()])
  try {
    const [row] = await db
      .select({
        spend: sql<number>`coalesce(sum(${adCreativeDailyMetrics.spendCents}), 0)::int`,
        orders: sql<number>`coalesce(sum(${adCreativeDailyMetrics.orders}), 0)::int`,
      })
      .from(adCreativeDailyMetrics)
      .where(eq(adCreativeDailyMetrics.day, day))
    return { ok: true, day, spendCents: row?.spend ?? 0, ordersToday: row?.orders ?? 0, dailyCapCents, spendEnabled }
  } catch (err) {
    console.error('[ad-burn] metrics read failed', err)
    return { ok: false, day, spendCents: null, ordersToday: null, dailyCapCents, spendEnabled }
  }
}
