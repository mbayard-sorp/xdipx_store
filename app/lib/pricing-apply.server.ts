import { pricingChanges } from '../../db/schema'
import { updateVariantPricing, updateProductMetafield } from './shopify.server'
import { enforceMapFloor } from './pricing-engine-v2.server'
import type { PriceComputation } from './pricing-engine.server'
import type { ApprovalMode } from './pricing-agent.server'

export interface DecideAndApplyParams {
  product: {
    productId: string
    productGid: string
    handle: string
    title: string
    vendor: string | null
  }
  variant: {
    variantId: string
    sku: string
    title: string
    price: number
    compareAtPrice: number | null
  }
  computation: PriceComputation
  mapPrice: number | null
  oldWholesale: number | null
  newWholesale: number | null
  approvalMode: ApprovalMode
  dryRun: boolean
  runDate: string
  sourceTag: string
}

export interface DecideAndApplyResult {
  row: typeof pricingChanges.$inferInsert
  applied: boolean
  error?: string
  metafieldUpdates: Array<{ productId: string; key: string; value: string; oldValue: string | null }>
}

export async function decideAndApply(params: DecideAndApplyParams): Promise<DecideAndApplyResult> {
  const { product, variant, computation, mapPrice, oldWholesale, newWholesale, approvalMode, dryRun, runDate, sourceTag } = params

  type ChangeRow = typeof pricingChanges.$inferInsert

  let status: ChangeRow['status']
  let applyNow = false
  const metafieldUpdates: DecideAndApplyResult['metafieldUpdates'] = []

  if (computation.tier === 'refuse-missing-data') {
    status = 'failed'
  } else if (dryRun) {
    status = 'skipped_dry_run'
  } else if (approvalMode === 'all') {
    status = 'pending'
  } else if (approvalMode === 'guardrails') {
    const safeToAuto =
      computation.mapRespected &&
      computation.marginPct >= 0.20 &&
      Math.abs(computation.deltaPct) <= 0.15
    if (safeToAuto) {
      status = 'auto_applied'
      applyNow = true
    } else {
      status = 'pending'
    }
  } else {
    const blocked = !computation.mapRespected || computation.marginPct < 0.20
    if (blocked) {
      status = 'pending'
    } else {
      status = 'auto_applied'
      applyNow = true
    }
  }

  let applyError: string | null = null
  let applied = false

  if (applyNow) {
    try {
      // MAP floor invariant (ticket #3714): never write a price below MAP.
      await updateVariantPricing(
        variant.variantId,
        String(enforceMapFloor(computation.newPrice, mapPrice)),
        String(computation.newCompareAt),
      )
      applied = true

      if (newWholesale != null && newWholesale > 0) {
        if (oldWholesale == null || Math.abs(oldWholesale - newWholesale) > 0.001) {
          metafieldUpdates.push({
            productId: product.productGid,
            key: 'wholesale_cost',
            value: String(newWholesale),
            oldValue: oldWholesale != null ? String(oldWholesale) : null,
          })
        }
      }

      if (mapPrice != null) {
        metafieldUpdates.push({
          productId: product.productGid,
          key: 'map_price',
          value: String(mapPrice),
          oldValue: null,
        })
      }
    } catch (err) {
      applyError = err instanceof Error ? err.message : String(err)
      status = 'failed'
      applied = false
    }
  }

  const reasonPrefixed = `[${sourceTag}] ${computation.reason}`

  const row: ChangeRow = {
    runDate,
    sku: variant.sku,
    productId: product.productGid,
    productHandle: product.handle,
    productTitle: product.title,
    variantId: variant.variantId,
    variantTitle: variant.title !== 'Default Title' ? variant.title : null,
    vendor: product.vendor,
    tier: computation.tier,
    oldPrice: String(variant.price),
    newPrice: String(computation.newPrice),
    oldCompareAt: variant.compareAtPrice != null ? String(variant.compareAtPrice) : null,
    newCompareAt: String(computation.newCompareAt),
    oldWholesale: oldWholesale != null ? String(oldWholesale) : null,
    newWholesale: newWholesale != null && newWholesale > 0 ? String(newWholesale) : null,
    mapPrice: mapPrice != null ? String(mapPrice) : null,
    marginPct: String(computation.marginPct),
    reason: reasonPrefixed,
    mapRespected: computation.mapRespected,
    status,
    appliedAt: status === 'auto_applied' ? new Date() : null,
    applyError,
  }

  return { row, applied, ...(applyError ? { error: applyError } : {}), metafieldUpdates }
}

export async function flushMetafieldUpdates(
  updates: Array<{ productId: string; key: string; value: string; oldValue: string | null }>,
): Promise<string[]> {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const upd of updates) {
    const dedupeKey = `${upd.productId}:${upd.key}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    try {
      await updateProductMetafield(upd.productId, upd.key, upd.value, 'number_decimal')
    } catch (err) {
      errors.push(`metafield ${upd.key} for ${upd.productId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return errors
}
