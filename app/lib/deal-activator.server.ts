import { db } from './db.server'
import { dealHistory } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { setDealStatus } from './shopify.server'
import { triggerDailyDealEmail } from './klaviyo.server'
import { kvSet, KV_KEYS } from './kv.server'

/**
 * Runs at 11:59 PM via /cron/deal-activator
 *
 * 1. Archive today's live deal
 * 2. Activate tomorrow's approved deal
 * 3. Trigger Klaviyo daily deal email
 * 4. Update Vercel KV with today's deal handle
 */
export async function dealActivator(): Promise<{ archived: string | null; activated: string | null }> {
  const today    = new Date().toISOString().split('T')[0]!
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

  // 1. Find + archive today's live deal
  const [liveToday] = await db
    .select()
    .from(dealHistory)
    .where(and(eq(dealHistory.dealDate, today), eq(dealHistory.status, 'live')))
    .limit(1)

  if (liveToday?.shopifyProductId) {
    await setDealStatus(liveToday.shopifyProductId, 'archived')
    await db
      .update(dealHistory)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(dealHistory.id, liveToday.id))
  }

  // 2. Find + activate tomorrow's approved deal
  const [nextDeal] = await db
    .select()
    .from(dealHistory)
    .where(and(eq(dealHistory.dealDate, tomorrow), eq(dealHistory.status, 'approved')))
    .limit(1)

  if (nextDeal?.shopifyProductId) {
    await setDealStatus(nextDeal.shopifyProductId, 'live')
    await db
      .update(dealHistory)
      .set({ status: 'live', activatedAt: new Date() })
      .where(eq(dealHistory.id, nextDeal.id))

    // Cache for fast KV reads
    await kvSet(KV_KEYS.dealOfDay, {
      sku:    nextDeal.sku,
      title:  nextDeal.seoTitle,
      date:   tomorrow,
    })

    // 3. Trigger Klaviyo email (subject line = first email_subject metafield or fallback)
    await triggerDailyDealEmail({
      title:       nextDeal.seoTitle ?? '',
      tagline:     '',
      dealPrice:   parseFloat(nextDeal.dealPrice ?? '0'),
      msrp:        parseFloat(nextDeal.msrp ?? '0'),
      handle:      nextDeal.sku,
      imageUrl:    '',
      subjectLine: `New deal just dropped — ${nextDeal.seoTitle ?? 'check it out'} ♥`,
    })
  }

  return {
    archived:  liveToday?.sku ?? null,
    activated: nextDeal?.sku ?? null,
  }
}
