import crypto from 'node:crypto'
import { db } from './db.server'
import { pipelineSettings, pricingChanges } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import { kvGet, kvSet } from './kv.server'
import { findVariantsBySkus } from './shopify.server'
import { computeTargetPrice } from './pricing-engine.server'
import type { PricingSnapshot } from './pricing-engine.server'
import { getApprovalMode } from './pricing-agent.server'
import { decideAndApply, flushMetafieldUpdates } from './pricing-apply.server'
import type { DecideAndApplyResult } from './pricing-apply.server'

export interface NalpacCostChangeEvent {
  sku: string
  wholesale?: number
  msrp?: number
  mapPrice?: number
  salePrice?: number
  vendor?: string
  receivedAt?: string
}

export interface WebhookProcessResult {
  receivedCount: number
  processedCount: number
  changesCreated: number
  autoApplied: number
  pending: number
  failed: number
  throttled: number
  unknownSkus: string[]
  errors: Array<{ sku: string; message: string }>
}

async function getPipelineSetting(key: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

function eventHash(e: NalpacCostChangeEvent): string {
  const parts = [
    e.sku,
    e.wholesale != null ? String(e.wholesale) : '',
    e.msrp != null ? String(e.msrp) : '',
    e.mapPrice != null ? String(e.mapPrice) : '',
    e.salePrice != null ? String(e.salePrice) : '',
  ]
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex')
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function processNalpacCostChanges(
  events: NalpacCostChangeEvent[],
  _source: 'webhook' | 'manual-replay',
): Promise<WebhookProcessResult> {
  const result: WebhookProcessResult = {
    receivedCount: events.length,
    processedCount: 0,
    changesCreated: 0,
    autoApplied: 0,
    pending: 0,
    failed: 0,
    throttled: 0,
    unknownSkus: [],
    errors: [],
  }

  const enabledVal = await getPipelineSetting('pricing_webhook_enabled')
  if (enabledVal !== 'true') {
    result.errors.push({ sku: '*', message: 'webhook disabled' })
    return result
  }

  const throttleSecsRaw = await getPipelineSetting('pricing_webhook_throttle_secs')
  const throttleSecs = Math.max(5, Math.min(300, parseInt(throttleSecsRaw ?? '30', 10) || 30))

  const approvalMode = await getApprovalMode()
  const runDate = utcDateString(new Date())

  const deduped: NalpacCostChangeEvent[] = []
  for (const ev of events) {
    const hash = eventHash(ev)
    const seenKey = `pricing:webhook:seen:${hash}`
    const already = await kvGet<string>(seenKey)
    if (already) {
      result.throttled++
      continue
    }
    await kvSet(seenKey, '1', 60)
    deduped.push(ev)
  }

  if (deduped.length === 0) return result

  const skus = [...new Set(deduped.map(e => e.sku))]
  const variantMatches = await findVariantsBySkus(skus)

  const variantBySku = new Map<string, typeof variantMatches[number]>()
  for (const m of variantMatches) {
    if (m.variant.sku && !variantBySku.has(m.variant.sku)) {
      variantBySku.set(m.variant.sku, m)
    }
  }

  const unknownSet = new Set<string>()
  for (const sku of skus) {
    if (!variantBySku.has(sku)) unknownSet.add(sku)
  }
  result.unknownSkus = [...unknownSet]

  type ChangeRow = typeof pricingChanges.$inferInsert
  const rows: ChangeRow[] = []
  const allMetafieldUpdates: DecideAndApplyResult['metafieldUpdates'] = []

  for (const ev of deduped) {
    const match = variantBySku.get(ev.sku)
    if (!match) continue

    const throttleKey = `pricing:webhook:throttle:${match.variant.variantId}`
    const throttled = await kvGet<string>(throttleKey)
    if (throttled) {
      result.throttled++
      continue
    }
    await kvSet(throttleKey, '1', throttleSecs)

    result.processedCount++

    const mf = match.metafields
    const wholesale = ev.wholesale ?? mf.wholesaleCost ?? 0
    const msrp = ev.msrp ?? mf.originalPrice ?? 0
    const mapPrice = ev.mapPrice !== undefined ? ev.mapPrice : (mf.mapPrice ?? null)
    const salePrice = ev.salePrice ?? null
    const vendor = ev.vendor ?? match.vendor

    const inSaleFeed = salePrice != null && msrp > 0 && salePrice < msrp
    const nalpacDiscountPct = inSaleFeed && salePrice != null && msrp > 0
      ? (msrp - salePrice) / msrp
      : null

    const variantTitleVal = match.variant.title !== 'Default Title' ? match.variant.title : undefined
    const snapshot: PricingSnapshot = {
      sku: ev.sku,
      vendor: vendor ?? null,
      msrp,
      wholesale,
      mapPrice: mapPrice != null && mapPrice > 0 ? mapPrice : null,
      currentPrice: match.variant.price,
      currentCompareAt: match.variant.compareAtPrice,
      inSaleFeed,
      nalpacDiscountPct,
      productTitle: match.title,
      ...(variantTitleVal !== undefined ? { variantTitle: variantTitleVal } : {}),
    }

    const computation = computeTargetPrice(snapshot)
    if (computation.tier === 'no-change-needed') continue

    try {
      const applied = await decideAndApply({
        product: {
          productId: match.productId,
          productGid: match.productGid,
          handle: match.handle,
          title: match.title,
          vendor: match.vendor,
        },
        variant: {
          variantId: match.variant.variantId,
          sku: match.variant.sku,
          title: match.variant.title,
          price: match.variant.price,
          compareAtPrice: match.variant.compareAtPrice,
        },
        computation,
        mapPrice: mapPrice != null && mapPrice > 0 ? mapPrice : null,
        oldWholesale: mf.wholesaleCost,
        newWholesale: ev.wholesale ?? null,
        approvalMode,
        dryRun: false,
        runDate,
        sourceTag: 'webhook',
      })

      rows.push(applied.row)
      allMetafieldUpdates.push(...applied.metafieldUpdates)

      if (applied.row.status === 'auto_applied') result.autoApplied++
      else if (applied.row.status === 'pending') result.pending++
      else if (applied.row.status === 'failed') result.failed++

      if (applied.error) {
        result.errors.push({ sku: ev.sku, message: applied.error })
      }
    } catch (err) {
      result.failed++
      result.errors.push({ sku: ev.sku, message: err instanceof Error ? err.message : String(err) })
    }
  }

  if (allMetafieldUpdates.length > 0) {
    const mfErrors = await flushMetafieldUpdates(allMetafieldUpdates)
    for (const e of mfErrors) {
      result.errors.push({ sku: '', message: e })
    }
  }

  if (rows.length > 0) {
    await db.insert(pricingChanges).values(rows)
    result.changesCreated = rows.length
  }

  return result
}

export async function getPipelineSettingPublic(key: string): Promise<string | null> {
  return getPipelineSetting(key)
}

export async function setPipelineSetting(key: string, value: string): Promise<void> {
  await db
    .insert(pipelineSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: pipelineSettings.key,
      set: { value, updatedAt: new Date() },
    })
}

export async function getWebhookActivityToday(): Promise<number> {
  try {
    const todayStr = new Date().toISOString().slice(0, 10)
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pricingChanges)
      .where(
        sql`${pricingChanges.runDate}::text = ${todayStr}
          AND ${pricingChanges.reason} LIKE '[webhook]%'`,
      )
    return rows[0]?.count ?? 0
  } catch {
    return 0
  }
}
