// pricing-apply-v2.server.ts
// Orchestrates the v2 pricing pipeline:
//   resolvePricingConfig -> velocity -> computePrice -> decideStatus -> audit log -> Shopify apply
//
// Coexists with pricing-apply.server.ts (legacy) until cutover.
// Does NOT modify pricing-apply.server.ts.

import { db } from './db.server'
import { pricingAuditLog, pipelineSettings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  computePrice,
  computeDiscontinuedPrice,
  applyVelocityModifier,
} from './pricing-engine-v2.server'
import {
  resolvePricingConfig,
  buildRationale,
} from './pricing-rules.server'
import { getGroupForProductType } from './pricing-rules.server'
import { computeVelocityBucket } from './pricing-velocity.server'
import { findVariantsBySkus, updateVariantPricing } from './shopify.server'
import type { VelocityBucket } from './pricing-engine-v2.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalMode = 'aggressive' | 'balanced' | 'conservative' | 'review_all'

const MODE_THRESHOLD: Record<ApprovalMode, number> = {
  aggressive:   0.10,
  balanced:     0.05,
  conservative: 0.02,
  review_all:   0,
}

export type AuditStatus = 'auto_applied' | 'pending' | 'skipped_no_change' | 'rejected'

export interface DecideStatusParams {
  oldPrice:     number | null
  newPrice:     number
  map:          number | null
  mapBehavior:  string
  marginFloor:  number
  marginAfter:  number
  mode:         ApprovalMode
}

/**
 * Pure function: decide audit status from price diff + thresholds.
 * Exported for unit testing.
 */
export function decideStatus(p: DecideStatusParams): AuditStatus {
  const { oldPrice, newPrice, map, mapBehavior, marginFloor, marginAfter, mode } = p

  if (oldPrice != null && Math.abs(newPrice - oldPrice) < 0.005) {
    return 'skipped_no_change'
  }

  if (marginAfter < marginFloor) return 'rejected'

  const mapApplies = mapBehavior !== 'ignore_map' && map != null
  if (mapApplies && newPrice < map!) return 'rejected'

  if (mode === 'review_all') return 'pending'

  const threshold = MODE_THRESHOLD[mode]
  const deltaPct  = oldPrice != null && oldPrice > 0
    ? Math.abs(newPrice - oldPrice) / oldPrice
    : 1 // no old price -> treat as large change

  if (deltaPct > threshold) return 'pending'

  return 'auto_applied'
}

// ---------------------------------------------------------------------------
// Pipeline-settings reader
// ---------------------------------------------------------------------------

async function getApprovalMode(): Promise<ApprovalMode> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, 'pricing_approval_mode'))
      .limit(1)
    const val = rows[0]?.value
    if (val === 'aggressive' || val === 'balanced' || val === 'conservative' || val === 'review_all') return val
  } catch {
    // fall through
  }
  return 'balanced'
}

// ---------------------------------------------------------------------------
// Single-variant recompute
// ---------------------------------------------------------------------------

export interface RecomputeVariantParams {
  /** Shopify variant GID, e.g. "gid://shopify/ProductVariant/12345" */
  variantId: string
  trigger:   'webhook' | 'batch' | 'manual' | 'clearance_ladder'
}

export interface RecomputeVariantResult {
  status:    AuditStatus
  auditId:   number | null
  applied:   boolean
  error?:    string
}

const TEST_SKU_PREFIX = /^XDX-TEST-/i

export async function recomputeVariant(
  params: RecomputeVariantParams,
): Promise<RecomputeVariantResult> {
  const { variantId, trigger } = params

  // 1. Load variant data from Shopify via SKU lookup (reuses existing helper).
  //    We pass the variantId as a pseudo-SKU query by fetching by GID directly.
  let matchData: Awaited<ReturnType<typeof findVariantsBySkus>>[number] | null = null

  try {
    // findVariantsBySkus expects SKUs; for a variantId we need the numeric part.
    // Use a direct GID-based query approach: look up via variant GID filter.
    const gidNum = variantId.replace(/[^0-9]/g, '')
    const matches = await findVariantsBySkus([])

    // Fast path: query by variant GID using admin API directly.
    const data = await (async () => {
      const { adminGraphQL } = await import('./shopify.server')
      const result = await adminGraphQL<{
        productVariant: {
          id: string
          sku: string | null
          title: string
          price: string
          compareAtPrice: string | null
          inventoryItem: { unitCost: { amount: string } | null } | null
          product: {
            id: string
            handle: string
            title: string
            vendor: string | null
            productType: string | null
            metafields: { nodes: Array<{ namespace: string; key: string; value: string }> }
          }
        } | null
      }>(
        `query V($id:ID!){productVariant(id:$id){id sku title price compareAtPrice
          inventoryItem{unitCost{amount}}
          product{id handle title vendor productType
            metafields(keys:["xdipx.nalpac_sku","xdipx.wholesale_cost","xdipx.map_price","xdipx.original_price","xdipx.map_restricted","xdipx.discontinued_at"],first:10){nodes{namespace key value}}}}}`,
        { id: variantId },
      )
      return result.productVariant
    })()

    if (!data) return { status: 'skipped_no_change', auditId: null, applied: false, error: 'variant not found' }
    if (TEST_SKU_PREFIX.test(data.sku ?? '')) {
      return { status: 'skipped_no_change', auditId: null, applied: false, error: 'test SKU excluded' }
    }

    const mfMap: Record<string, string> = {}
    for (const mf of data.product.metafields.nodes) {
      mfMap[mf.key] = mf.value
    }

    matchData = {
      productId:   data.product.id.replace('gid://shopify/Product/', ''),
      productGid:  data.product.id,
      handle:      data.product.handle,
      title:       data.product.title,
      vendor:      data.product.vendor,
      productType: data.product.productType,
      variant: {
        variantId,
        sku:            data.sku ?? '',
        title:          data.title,
        price:          parseFloat(data.price),
        compareAtPrice: data.compareAtPrice != null ? parseFloat(data.compareAtPrice) : null,
        inventoryItemId: null,
        unitCost:       data.inventoryItem?.unitCost?.amount != null ? parseFloat(data.inventoryItem.unitCost.amount) : null,
      },
      metafields: {
        nalpacSku:      mfMap['nalpac_sku']      ?? null,
        wholesaleCost:  mfMap['wholesale_cost']  ? parseFloat(mfMap['wholesale_cost'])  : null,
        mapPrice:       mfMap['map_price']        ? parseFloat(mfMap['map_price'])       : null,
        originalPrice:  mfMap['original_price']  ? parseFloat(mfMap['original_price'])  : null,
        mapRestricted:  mfMap['map_restricted']  === 'true',
        discontinuedAt: mfMap['discontinued_at'] ? new Date(mfMap['discontinued_at'])   : null,
      },
    }
    void matches // suppress unused warning
    void gidNum
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'skipped_no_change', auditId: null, applied: false, error: `shopify fetch: ${msg}` }
  }

  // Prefer Shopify's native variant Cost per item (inventoryItem.unitCost).
  // Fall back to the legacy xdipx.wholesale_cost product metafield only if unset.
  const cost       = matchData.variant.unitCost ?? matchData.metafields.wholesaleCost
  const map        = matchData.metafields.mapPrice
  const msrp       = matchData.metafields.originalPrice
  const oldSell    = matchData.variant.price
  const oldCompare = matchData.variant.compareAtPrice
  const productType = (matchData as { productType?: string | null }).productType ?? null
  const sku        = matchData.variant.sku

  // 2. Resolve config.
  const cfg   = await resolvePricingConfig(productType)
  const group = await getGroupForProductType(productType)
  const mode  = await getApprovalMode()

  // 3. Velocity modifier.
  let velocityBucket: VelocityBucket | undefined
  let effectiveCfg = cfg

  if (cfg.velocity_modifier_enabled) {
    velocityBucket = await computeVelocityBucket(variantId)
    // applyVelocityModifier returns PricingConfig (not ResolvedConfig), so carry
    // groupId/subGroupId forward manually.
    const shifted = applyVelocityModifier(cfg, velocityBucket)
    effectiveCfg = { ...shifted, groupId: cfg.groupId, subGroupId: cfg.subGroupId }
  }

  // 4. Compute price: discontinued or live.
  const isDiscontinued = group?.usesClearanceLadder === true || productType === 'Discontinued'

  let newSell:    number | null = null
  let newCompare: number | null = null
  let daysDisc:   number | undefined

  if (isDiscontinued) {
    const discontinuedAt = matchData.metafields.discontinuedAt ?? null
    daysDisc = discontinuedAt
      ? Math.max(0, Math.floor((Date.now() - discontinuedAt.getTime()) / 86_400_000))
      : 0
    const result = computeDiscontinuedPrice({ cost, msrp, daysDiscontinued: daysDisc, cfg: effectiveCfg })
    if (result) { newSell = result.sell; newCompare = result.compare_at }
  } else {
    const result = computePrice({ cost, map, msrp, cfg: effectiveCfg })
    if (result) {
      newSell = result.sell
      newCompare = result.compare_at
      // Absolute price floor: queue instead of auto-applying prices below the floor
      if (result.belowAbsoluteFloor) {
        return {
          status: 'pending',
          auditId: null,
          applied: false,
          error: `sell price $${result.sell.toFixed(2)} is below absolute floor`,
        }
      }
    }
  }

  if (newSell == null) {
    return { status: 'skipped_no_change', auditId: null, applied: false, error: 'cannot compute price: missing cost' }
  }

  // 5. Margin after.
  const marginAfter  = cost != null && newSell > 0 ? (newSell - cost) / newSell : 0
  const marginBefore = cost != null && oldSell > 0 ? (oldSell - cost) / oldSell : 0

  // 6. Decide status.
  const status = decideStatus({
    oldPrice:    oldSell,
    newPrice:    newSell,
    map,
    mapBehavior: cfg.map_behavior,
    marginFloor: cfg.margin_floor_pct,
    marginAfter,
    mode,
  })

  // 7. Build rationale.
  const deltaPct = oldSell > 0 ? (newSell - oldSell) / oldSell : null
  const rationale = buildRationale({
    oldCost:    cost,
    newCost:    cost,
    oldSell,
    newSell,
    status,
    trigger,
    mapHeld:    map != null && newSell <= map + 0.02,
    marginAfter,
    ...(velocityBucket !== undefined ? { velocityBucket }             : {}),
    ...(daysDisc       !== undefined ? { daysDisc }                  : {}),
    ...(map            != null       ? { map }                       : {}),
    ...(deltaPct       != null       ? { deltaPct }                  : {}),
    approvalThreshold: MODE_THRESHOLD[mode],
  })

  // 8. Write audit log row.
  let auditId: number | null = null
  try {
    const rows = await db
      .insert(pricingAuditLog)
      .values({
        variantId,
        sku:          sku || null,
        productType,
        groupId:      group?.groupId    ?? null,
        subGroupId:   group?.subGroupId ?? null,
        trigger,
        oldCost:      cost   != null ? String(cost)   : null,
        newCost:      cost   != null ? String(cost)   : null,
        oldMap:       map    != null ? String(map)    : null,
        newMap:       map    != null ? String(map)    : null,
        oldMsrp:      msrp   != null ? String(msrp)   : null,
        newMsrp:      msrp   != null ? String(msrp)   : null,
        oldSell:      String(oldSell),
        newSell:      String(newSell),
        oldCompareAt: oldCompare != null ? String(oldCompare) : null,
        newCompareAt: newCompare != null ? String(newCompare) : null,
        marginBefore: String(Math.round(marginBefore * 10000) / 10000),
        marginAfter:  String(Math.round(marginAfter  * 10000) / 10000),
        status,
        rationale,
      })
      .returning({ id: pricingAuditLog.id })
    auditId = rows[0]?.id ?? null
  } catch (err) {
    console.error('[pricing-apply-v2] audit log write failed:', err)
  }

  // 9. Apply to Shopify if auto_applied.
  let applied = false
  let applyError: string | undefined

  if (status === 'auto_applied') {
    try {
      await updateVariantPricing(
        variantId,
        String(newSell),
        newCompare != null ? String(newCompare) : String(newSell),
      )
      applied = true
    } catch (err) {
      applyError = err instanceof Error ? err.message : String(err)
      console.error('[pricing-apply-v2] Shopify price update failed:', applyError)
      // Update audit row to reflect apply error.
      if (auditId != null) {
        try {
          await db
            .update(pricingAuditLog)
            .set({ status: 'pending', rationale: `${rationale} [apply error: ${applyError}]` })
            .where(eq(pricingAuditLog.id, auditId))
        } catch { /* ignore secondary error */ }
      }
    }
  }

  return { status, auditId, applied, ...(applyError ? { error: applyError } : {}) }
}

// ---------------------------------------------------------------------------
// Dry-run rule change (spec ss9.2 / acceptance criterion 9)
// Simulates applying overrides without writing audit log rows or touching Shopify.
// Returns counts so the UI can render the confirm modal.
// ---------------------------------------------------------------------------

export interface RuleOverride {
  scope_level: 'global' | 'group' | 'sub_group' | 'product_type'
  scope_id: string
  target_margin_pct?: number
  margin_floor_pct?: number
  map_behavior?: string
  compare_at_strategy?: string
  velocity_modifier_enabled?: boolean
}

export interface VariantDelta {
  variantId: string
  sku: string | null
  productType: string | null
  oldSell: number
  newSell: number
  status: AuditStatus
  rationale: string
}

export interface DryRunResult {
  totalAffected: number
  withinThreshold: number
  willQueue: number
  breachMap: number
  breachFloor: number
  cappedAt: number | null
  samples: VariantDelta[]
}

const DRY_RUN_CAP = 5000
const DRY_RUN_SAMPLES = 10

export async function dryRunRuleChange(opts: {
  overrides: RuleOverride[]
}): Promise<DryRunResult> {
  const { overrides } = opts

  // Build a lookup from the overrides so we can patch resolvePricingConfig output.
  // Map: "scopeLevel:scopeId" -> partial config patch
  const overrideMap = new Map<string, Partial<import('./pricing-engine-v2.server').PricingConfig>>()
  for (const o of overrides) {
    const key = `${o.scope_level}:${o.scope_id}`
    overrideMap.set(key, {
      ...(o.target_margin_pct != null ? { target_margin_pct: o.target_margin_pct } : {}),
      ...(o.margin_floor_pct != null ? { margin_floor_pct: o.margin_floor_pct } : {}),
      ...(o.map_behavior != null ? { map_behavior: o.map_behavior as import('./pricing-engine-v2.server').MapBehavior } : {}),
      ...(o.compare_at_strategy != null ? { compare_at_strategy: o.compare_at_strategy as import('./pricing-engine-v2.server').CompareAtStrategy } : {}),
      ...(o.velocity_modifier_enabled != null ? { velocity_modifier_enabled: o.velocity_modifier_enabled } : {}),
    })
  }

  const { bulkFetchProductsForPricing } = await import('./shopify.server')
  const mode = await getApprovalMode()

  const result: DryRunResult = {
    totalAffected: 0,
    withinThreshold: 0,
    willQueue: 0,
    breachMap: 0,
    breachFloor: 0,
    cappedAt: null,
    samples: [],
  }

  let processed = 0
  let capped = false

  const products = await bulkFetchProductsForPricing()

  for (const product of products) {
    if (capped) break
    for (const variant of product.variants) {
      if (TEST_SKU_PREFIX.test(variant.sku ?? '')) continue
      if (processed >= DRY_RUN_CAP) { capped = true; break }
      processed++

      try {
        const productType = (product as { productType?: string | null }).productType ?? null
        const group = await getGroupForProductType(productType)

        // Build base config from resolver, then patch with overrides.
        const base = await resolvePricingConfig(productType)
        let cfg = { ...base }

        // Apply overrides narrowest-to-broadest (product_type > sub_group > group > global)
        const scopeKeys = [
          'global:global',
          group?.groupId ? `group:${group.groupId}` : null,
          group?.subGroupId ? `sub_group:${group.subGroupId}` : null,
          productType ? `product_type:${productType}` : null,
        ].filter(Boolean) as string[]

        for (const key of scopeKeys) {
          const patch = overrideMap.get(key)
          if (patch) cfg = { ...cfg, ...patch }
        }

        // Prefer Shopify's native variant Cost per item (inventoryItem.unitCost).
        // Fall back to the legacy xdipx.wholesale_cost product metafield only if unset.
        const cost = variant.unitCost ?? product.metafields.wholesaleCost
        const map = product.metafields.mapPrice
        const msrp = product.metafields.originalPrice
        const oldSell = variant.price

        if (cost == null) continue

        const isDiscontinued = group?.usesClearanceLadder === true || productType === 'Discontinued'
        let newSell: number | null = null

        if (isDiscontinued) {
          const discontinuedAt = product.metafields.discontinuedAt ?? null
          const daysDiscontinued = discontinuedAt
            ? Math.max(0, Math.floor((Date.now() - discontinuedAt.getTime()) / 86_400_000))
            : 0
          const r = computeDiscontinuedPrice({ cost, msrp, daysDiscontinued, cfg })
          if (r) newSell = r.sell
        } else {
          const r = computePrice({ cost, map, msrp, cfg })
          if (r) {
            newSell = r.sell
            // Treat below-floor results as "will queue" in dry-run
            if (r.belowAbsoluteFloor) { newSell = null }
          }
        }

        if (newSell == null) continue

        // Skip if price unchanged
        if (Math.abs(newSell - oldSell) < 0.005) continue

        result.totalAffected++

        const marginAfter = newSell > 0 ? (newSell - cost) / newSell : 0
        const mapApplies = cfg.map_behavior !== 'ignore_map' && map != null
        const breachesMap = mapApplies && newSell < (map as number)
        const breachesFloor = marginAfter < cfg.margin_floor_pct

        if (breachesMap) {
          result.breachMap++
        } else if (breachesFloor) {
          result.breachFloor++
        } else {
          const threshold = MODE_THRESHOLD[mode]
          const deltaPct = oldSell > 0 ? Math.abs(newSell - oldSell) / oldSell : 1
          if (mode === 'review_all' || deltaPct > threshold) {
            result.willQueue++
          } else {
            result.withinThreshold++
          }
        }

        if (result.samples.length < DRY_RUN_SAMPLES) {
          const status: AuditStatus =
            breachesMap || breachesFloor
              ? 'rejected'
              : (mode === 'review_all' || (oldSell > 0 && Math.abs(newSell - oldSell) / oldSell > MODE_THRESHOLD[mode]))
                ? 'pending'
                : 'auto_applied'

          result.samples.push({
            variantId: variant.variantId,
            sku: variant.sku || null,
            productType,
            oldSell,
            newSell,
            status,
            rationale: breachesMap
              ? `Would breach MAP $${(map as number).toFixed(2)}`
              : breachesFloor
                ? `Would breach margin floor ${Math.round(cfg.margin_floor_pct * 100)}%`
                : `${oldSell.toFixed(2)} -> ${newSell.toFixed(2)}`,
          })
        }
      } catch { /* skip problem variant */ }
    }
  }

  if (capped) result.cappedAt = DRY_RUN_CAP

  return result
}

// ---------------------------------------------------------------------------
// Catalog batch recompute
// ---------------------------------------------------------------------------

export interface RecomputeCatalogResult {
  total:         number
  autoApplied:   number
  pending:       number
  skipped:       number
  rejected:      number
  errors:        number
  durationMs:    number
}

/**
 * Iterate all Shopify variants (paginated via bulkFetchProductsForPricing)
 * and recompute each. Returns aggregate counts.
 */
export async function recomputeCatalog(opts: {
  trigger: 'batch' | 'manual'
}): Promise<RecomputeCatalogResult> {
  const { bulkFetchProductsForPricing } = await import('./shopify.server')
  const startedAt = Date.now()

  const counts: RecomputeCatalogResult = {
    total: 0, autoApplied: 0, pending: 0, skipped: 0, rejected: 0, errors: 0, durationMs: 0,
  }

  const products = await bulkFetchProductsForPricing()

  for (const product of products) {
    for (const variant of product.variants) {
      if (TEST_SKU_PREFIX.test(variant.sku ?? '')) continue
      counts.total++
      try {
        const result = await recomputeVariant({
          variantId: variant.variantId,
          trigger: opts.trigger,
        })
        if (result.error)                            counts.errors++
        else if (result.status === 'auto_applied')   counts.autoApplied++
        else if (result.status === 'pending')        counts.pending++
        else if (result.status === 'rejected')       counts.rejected++
        else                                         counts.skipped++
      } catch (err) {
        counts.errors++
        console.error('[pricing-batch] variant error', variant.variantId, err)
      }
    }
  }

  counts.durationMs = Date.now() - startedAt
  return counts
}
