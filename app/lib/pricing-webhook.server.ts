import crypto from 'node:crypto'
import { db } from './db.server'
import { pipelineSettings, pricingAuditLog } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import { kvGet, kvSet } from './kv.server'
import { findVariantsBySkus, updateProductMetafield } from './shopify.server'
import { recomputeVariant } from './pricing-apply-v2.server'

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

  // Default to enabled when no row exists (spec ss6 — webhook is on out of the box).
  const enabledVal = await getPipelineSetting('pricing_webhook_enabled')
  if (enabledVal === 'false') {
    result.errors.push({ sku: '*', message: 'webhook disabled' })
    return result
  }

  const throttleSecsRaw = await getPipelineSetting('pricing_webhook_throttle_secs')
  const throttleSecs = Math.max(5, Math.min(300, parseInt(throttleSecsRaw ?? '30', 10) || 30))

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

    // ADR-007 decision 4: reprice through the v2 engine (recomputeVariant),
    // never v1's decideAndApply. Mirrors app/lib/cost-sync.server.ts's WS3
    // path exactly -- sync whatever fresh cost/MAP the event carries to the
    // Shopify metafields recomputeVariant reads, then let it fetch, compute,
    // audit (pricing_audit_log, the monitored table), and apply in one call.
    // v1's Nalpac-sale-feed pass-through (ev.salePrice) has no v2 equivalent
    // and is intentionally dropped here: v2's model is cost/MAP-driven, and
    // WS3's own drop-sync path already made the same tradeoff (ADR-007
    // decision 1). ev.msrp is likewise unused for a metafield write, matching
    // the pre-existing behavior -- the webhook never wrote xdipx.original_price
    // even under v1.
    try {
      if (ev.wholesale != null) {
        await updateProductMetafield(match.productGid, 'wholesale_cost', String(ev.wholesale), 'number_decimal')
      }
      if (ev.mapPrice != null) {
        await updateProductMetafield(match.productGid, 'map_price', String(ev.mapPrice), 'number_decimal')
      }

      const recomputed = await recomputeVariant({ variantId: match.variant.variantId, trigger: 'webhook' })

      if (recomputed.auditId != null) result.changesCreated++
      if (recomputed.applied) result.autoApplied++
      else if (recomputed.status === 'pending') result.pending++
      else if (recomputed.status === 'rejected') result.failed++
      // 'skipped_no_change' counts toward processedCount above and nothing
      // else, matching v1's own no-change-needed continue.

      if (recomputed.error) {
        result.errors.push({ sku: ev.sku, message: recomputed.error })
      }
    } catch (err) {
      result.failed++
      result.errors.push({ sku: ev.sku, message: err instanceof Error ? err.message : String(err) })
    }
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

/**
 * ADR-007 decision 4: the webhook reprices through recomputeVariant now, so
 * its rows land in pricing_audit_log (trigger='webhook') instead of the
 * retired pricing_changes write path. Counts today's UTC calendar date to
 * match this module's other date handling.
 */
export async function getWebhookActivityToday(): Promise<number> {
  try {
    const todayStr = new Date().toISOString().slice(0, 10)
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pricingAuditLog)
      .where(
        sql`${pricingAuditLog.trigger} = 'webhook'
          AND ${pricingAuditLog.occurredAt}::date = ${todayStr}::date`,
      )
    return rows[0]?.count ?? 0
  } catch {
    return 0
  }
}
