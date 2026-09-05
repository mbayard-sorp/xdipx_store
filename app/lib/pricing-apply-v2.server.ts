// pricing-apply-v2.server.ts
// Orchestrates the v2 pricing pipeline:
//   resolvePricingConfig -> velocity -> computePrice -> decideStatus -> audit log -> Shopify apply
//
// Coexists with pricing-apply.server.ts (legacy) until cutover.
// Does NOT modify pricing-apply.server.ts.

import { db } from './db.server'
import { pricingAuditLog, pipelineSettings } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import {
  computePrice,
  computeDiscontinuedPrice,
  applyVelocityModifier,
  enforceMapFloor,
} from './pricing-engine-v2.server'
import {
  resolvePricingConfig,
  buildRationale,
} from './pricing-rules.server'
import { getGroupForProductType } from './pricing-rules.server'
import { computeVelocityBucket } from './pricing-velocity.server'
import { updateVariantPricing, normalizeMetafieldKey } from './shopify.server'
import type { VelocityBucket } from './pricing-engine-v2.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalMode = 'aggressive' | 'balanced' | 'conservative' | 'review_all'

export const DEFAULT_MODE_THRESHOLD: Record<ApprovalMode, number> = {
  aggressive:   0.10,
  balanced:     0.05,
  conservative: 0.02,
  review_all:   0,
}

// Back-compat alias used by the pure decideStatus default + dry-run fallback.
const MODE_THRESHOLD = DEFAULT_MODE_THRESHOLD

/**
 * Read admin-configured per-mode thresholds from pipeline_settings, merged over
 * the defaults. Stored as JSON under `pricing_mode_thresholds`. review_all is
 * always 0 (every change queues) regardless of stored value.
 */
export async function getModeThresholds(): Promise<Record<ApprovalMode, number>> {
  const merged: Record<ApprovalMode, number> = { ...DEFAULT_MODE_THRESHOLD }
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, 'pricing_mode_thresholds'))
      .limit(1)
    const raw = rows[0]?.value
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ApprovalMode, unknown>>
      for (const mode of ['aggressive', 'balanced', 'conservative'] as const) {
        const v = parsed[mode]
        if (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1) {
          merged[mode] = v
        }
      }
    }
  } catch {
    // fall through to defaults
  }
  merged.review_all = 0
  return merged
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
  /**
   * True when computePrice's margin-floor clamp was subsequently overridden by
   * the MSRP ceiling (the floor-satisfying price exceeds MSRP): an
   * unsatisfiable pricing constraint, not a rule violation, so it queues for a
   * human instead of being rejected and silently recurring forever (#7515).
   */
  msrpBelowFloor?: boolean
  /** Optional per-mode threshold override; defaults to DEFAULT_MODE_THRESHOLD[mode]. */
  threshold?:   number
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

  if (marginAfter < marginFloor) return p.msrpBelowFloor ? 'pending' : 'rejected'

  const mapApplies = mapBehavior !== 'ignore_map' && map != null
  if (mapApplies && newPrice < map!) return 'rejected'

  if (mode === 'review_all') return 'pending'

  const threshold = p.threshold ?? MODE_THRESHOLD[mode]
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
// MAP brand scoping (owner rule 2026-08-29)
// ---------------------------------------------------------------------------

/**
 * MAP (minimum advertised price) is a per-brand contractual floor, not a
 * catalog-wide rule. Only these vendors' products are held at MAP; every other
 * brand is priced purely off the target-margin markup rules and ignores any
 * MAP value the Nalpac feed happens to report.
 *
 * The feed carries a MAP (frequently equal to MSRP) for many brands that impose
 * no such restriction, and the engine's `at_map` floor was dragging those
 * products' sell prices up to MSRP, wiping out promotional pricing across the
 * catalog (diagnosed 2026-08-29: 919 of 925 queued changes were MAP-driven
 * increases, none of them a MAP brand). Scoping MAP to the brands that actually
 * enforce it is the fix.
 *
 * Editable without a deploy via the `pricing_map_brands` pipeline setting (JSON
 * array of vendor names); this constant is the fallback.
 */
export const DEFAULT_MAP_BRANDS: readonly string[] = ['Lovense', 'Playground']

/**
 * Pure predicate: does MAP enforcement apply to this vendor? Case-insensitive,
 * whitespace-trimmed exact match against the MAP-brand list. A null/blank
 * vendor never matches, so an unbranded product is priced off markup rules.
 * Exported for unit testing.
 */
export function mapAppliesToVendor(
  vendor: string | null | undefined,
  mapBrands: readonly string[],
): boolean {
  if (!vendor) return false
  const v = vendor.trim().toLowerCase()
  if (!v) return false
  return mapBrands.some(b => b.trim().toLowerCase() === v)
}

/**
 * Read the MAP-brand list from `pricing_map_brands` (JSON array of strings),
 * falling back to DEFAULT_MAP_BRANDS. Read once per run and carried on
 * RunContext so a batch does not re-read it per variant.
 */
export async function getMapBrands(): Promise<string[]> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, 'pricing_map_brands'))
      .limit(1)
    const raw = rows[0]?.value
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const brands = parsed.filter(
          (b): b is string => typeof b === 'string' && b.trim().length > 0,
        )
        if (brands.length > 0) return brands
      }
    }
  } catch {
    // fall through to defaults
  }
  return [...DEFAULT_MAP_BRANDS]
}

// ---------------------------------------------------------------------------
// Single-variant recompute
// ---------------------------------------------------------------------------

/**
 * Every value the `trigger` column may hold, and the single source of truth for
 * it on the code side.
 *
 * It has a twin in the database -- `pricing_audit_log_trigger_check` -- and the
 * two drifted apart for months without anyone noticing, because the audit write
 * is wrapped in a try/catch: the CHECK still listed only the first four while
 * the code had started passing 'batch_catchup' and then 'batch_continuation',
 * so every one of those inserts was rejected, swallowed, and reported as a
 * successful run. pricing-trigger-values.test.ts now holds the two lists equal
 * so the next value added here cannot ship ahead of the migration that permits
 * it. See db/migrations/093_pricing_audit_trigger_values.sql.
 */
export const PRICING_TRIGGERS = [
  'webhook', 'batch', 'manual', 'clearance_ladder', 'batch_catchup', 'batch_continuation',
] as const

export type PricingTrigger = (typeof PRICING_TRIGGERS)[number]

export interface RecomputeVariantParams {
  /** Shopify variant GID, e.g. "gid://shopify/ProductVariant/12345" */
  variantId: string
  /**
   * What caused this recompute. `batch_catchup` is a rescue run the pricing-ops
   * agent fires after noticing the scheduled 07:00 pass produced nothing; it is
   * kept distinct from `batch` so a rescue can never be mistaken for (or
   * satisfy the check for) a healthy scheduled run.
   */
  // 'batch_continuation' is a resumed slice of the same day's walk. Kept distinct
  // from 'batch' on purpose: the digest's liveness check asks whether the 07:00
  // cron itself fired, while coverage counts every slice.
  trigger:   PricingTrigger
}

export interface RecomputeVariantResult {
  status:    AuditStatus
  auditId:   number | null
  applied:   boolean
  error?:    string
  /**
   * The audit row could not be written, so this price change happened without
   * a record. Surfaced rather than only logged: see the counter on
   * RecomputeCatalogResult for what that silence cost.
   */
  auditFailed?: boolean
}

const TEST_SKU_PREFIX = /^XDX-TEST-/i

// Shared per-run context so batch runs read settings once, not once per variant.
interface RunContext {
  trigger:    RecomputeVariantParams['trigger']
  mode:       ApprovalMode
  thresholds: Record<ApprovalMode, number>
  /** Vendors whose MAP the engine honors; every other brand ignores MAP. */
  mapBrands:  string[]
}

// Minimal variant/product data the compute core needs. Matches both the
// bulkFetchProductsForPricing snapshot shape and the single-variant fetch.
interface VariantInput {
  variantId:      string
  sku:            string
  price:          number
  compareAtPrice: number | null
  unitCost:       number | null
}

interface ProductInput {
  vendor: string | null
  productType: string | null
  metafields: {
    wholesaleCost:  number | null
    mapPrice:       number | null
    originalPrice:  number | null
    discontinuedAt: Date | null
  }
}

/**
 * Compute + audit + apply for one variant from already-fetched data.
 * No Shopify reads; the only Shopify call is the price mutation on auto_apply.
 */
async function recomputeFromData(
  product: ProductInput,
  variant: VariantInput,
  ctx: RunContext,
): Promise<RecomputeVariantResult> {
  const { variantId } = variant
  const { trigger, mode, thresholds, mapBrands } = ctx

  // Prefer Shopify's native variant Cost per item (inventoryItem.unitCost).
  // Fall back to the legacy xdipx.wholesale_cost product metafield only if unset.
  const cost        = variant.unitCost ?? product.metafields.wholesaleCost
  // MAP is a per-brand contractual floor (owner rule 2026-08-29): honor the
  // feed's MAP only for the MAP brands. Every other vendor resolves MAP to null
  // so it prices off the markup rules instead of being held at MAP/MSRP.
  const map         = mapAppliesToVendor(product.vendor, mapBrands)
    ? product.metafields.mapPrice
    : null
  const msrp        = product.metafields.originalPrice
  const oldSell     = variant.price
  const oldCompare  = variant.compareAtPrice
  const productType = product.productType
  const sku         = variant.sku

  const cfg   = await resolvePricingConfig(productType)
  const group = await getGroupForProductType(productType)

  let velocityBucket: VelocityBucket | undefined
  let effectiveCfg = cfg

  if (cfg.velocity_modifier_enabled) {
    velocityBucket = await computeVelocityBucket(variantId)
    // applyVelocityModifier returns PricingConfig (not ResolvedConfig), so carry
    // groupId/subGroupId forward manually.
    const shifted = applyVelocityModifier(cfg, velocityBucket)
    effectiveCfg = { ...shifted, groupId: cfg.groupId, subGroupId: cfg.subGroupId }
  }

  const isDiscontinued = group?.usesClearanceLadder === true || productType === 'Discontinued'

  let newSell:    number | null = null
  let newCompare: number | null = null
  let daysDisc:   number | undefined
  let msrpBelowFloor = false

  if (isDiscontinued) {
    const discontinuedAt = product.metafields.discontinuedAt ?? null
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
      msrpBelowFloor = result.msrpBelowFloor
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

  const marginAfter  = cost != null && newSell > 0 ? (newSell - cost) / newSell : 0
  const marginBefore = cost != null && oldSell > 0 ? (oldSell - cost) / oldSell : 0

  const status = decideStatus({
    oldPrice:    oldSell,
    newPrice:    newSell,
    map,
    mapBehavior: cfg.map_behavior,
    marginFloor: cfg.margin_floor_pct,
    marginAfter,
    mode,
    msrpBelowFloor,
    threshold: thresholds[mode],
  })

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
    msrpBelowFloor,
    ...(velocityBucket !== undefined ? { velocityBucket }             : {}),
    ...(daysDisc       !== undefined ? { daysDisc }                  : {}),
    ...(map            != null       ? { map }                       : {}),
    ...(msrp           != null       ? { msrp }                      : {}),
    ...(deltaPct       != null       ? { deltaPct }                  : {}),
    approvalThreshold: thresholds[mode],
  })

  let auditId: number | null = null
  let auditFailed = false
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
    auditFailed = true
  }

  let applied = false
  let applyError: string | undefined

  if (status === 'auto_applied') {
    try {
      // MAP floor invariant (ticket #3714): last-line guard at the write path.
      // decideStatus already rejects below-MAP prices and computePrice clamps
      // after rounding, but nothing may reach Shopify below a positive MAP.
      // Discontinued items are exempt (clearance ladder, MAP does not apply),
      // as is an explicit ignore_map config.
      const mapFloor = !isDiscontinued && cfg.map_behavior !== 'ignore_map' ? map : null
      const guardedSell = enforceMapFloor(newSell, mapFloor)
      if (guardedSell !== newSell) {
        console.warn(`[pricing-apply-v2] MAP floor guard raised ${sku} from $${newSell} to $${guardedSell}`)
      }
      await updateVariantPricing(
        variantId,
        String(guardedSell),
        newCompare != null ? String(newCompare) : String(guardedSell),
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

  return {
    status,
    auditId,
    applied,
    ...(applyError  ? { error: applyError } : {}),
    ...(auditFailed ? { auditFailed: true } : {}),
  }
}

export async function recomputeVariant(
  params: RecomputeVariantParams,
): Promise<RecomputeVariantResult> {
  const { variantId, trigger } = params

  let product: ProductInput | null = null
  let variant: VariantInput | null = null

  try {
    // Query by variant GID using the admin API directly.
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
      mfMap[normalizeMetafieldKey(mf)] = mf.value
    }

    product = {
      vendor: data.product.vendor,
      productType: data.product.productType,
      metafields: {
        wholesaleCost:  mfMap['wholesale_cost']  ? parseFloat(mfMap['wholesale_cost'])  : null,
        mapPrice:       mfMap['map_price']        ? parseFloat(mfMap['map_price'])       : null,
        originalPrice:  mfMap['original_price']  ? parseFloat(mfMap['original_price'])  : null,
        discontinuedAt: mfMap['discontinued_at'] ? new Date(mfMap['discontinued_at'])   : null,
      },
    }
    variant = {
      variantId,
      sku:            data.sku ?? '',
      price:          parseFloat(data.price),
      compareAtPrice: data.compareAtPrice != null ? parseFloat(data.compareAtPrice) : null,
      unitCost:       data.inventoryItem?.unitCost?.amount != null ? parseFloat(data.inventoryItem.unitCost.amount) : null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'skipped_no_change', auditId: null, applied: false, error: `shopify fetch: ${msg}` }
  }

  const mode       = await getApprovalMode()
  const thresholds = await getModeThresholds()
  const mapBrands  = await getMapBrands()

  return recomputeFromData(product, variant, { trigger, mode, thresholds, mapBrands })
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
  const thresholds = await getModeThresholds()
  const mapBrands = await getMapBrands()

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
        // MAP is brand-scoped (owner rule 2026-08-29): non-MAP brands ignore MAP.
        const vendor = (product as { vendor?: string | null }).vendor ?? null
        const map = mapAppliesToVendor(vendor, mapBrands) ? product.metafields.mapPrice : null
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
          const threshold = thresholds[mode]
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
              : (mode === 'review_all' || (oldSell > 0 && Math.abs(newSell - oldSell) / oldSell > thresholds[mode]))
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

/**
 * Rest between catalog pages, mirroring PRICING_FETCH_PAGE_DELAY_MS in
 * shopify.server.ts. Kept in step with it deliberately: the streaming walk owns
 * its own pacing now that it no longer goes through bulkFetchProductsForPricing.
 */
const PRICING_PAGE_PACING_MS = 500

export interface RecomputeCatalogResult {
  total:         number
  autoApplied:   number
  pending:       number
  skipped:       number
  rejected:      number
  errors:        number
  durationMs:    number
  /** False when the wall-clock budget stopped the walk before the catalog ran out. */
  done:          boolean
  /** Pages fetched by this invocation (not cumulative across the day). */
  pages:         number
  /** Variants priced across every invocation for this UTC day, this one included. */
  dayTotal:      number
  /**
   * Variants whose audit row could not be written. Nonzero means prices moved
   * that the pricing audit log does not know about.
   *
   * This is counted because it once was not. `pricing_audit_log_trigger_check`
   * allowed only webhook|batch|manual|clearance_ladder, while the code had been
   * passing 'batch_catchup' and then 'batch_continuation' for months. Every one
   * of those inserts failed the CHECK, was caught by the try/catch around the
   * write, logged to a console nobody reads, and the run reported success. On
   * 2026-09-03 the four continuation passes applied 1,426 price changes and
   * wrote zero audit rows; the only surviving trace was the id sequence, which
   * had advanced 3,320 past the highest surviving row.
   *
   * The cost was not just the missing history. Catalog coverage -- the A1
   * milestone's whole acceptance criterion -- is measured off this table, so it
   * read 44% while the walk had in fact reached 94%. A fix that works and a
   * metric that says it does not is the same failure the resumable walk was
   * built to end.
   *
   * Deliberately counted rather than made fatal: a price the shopper sees
   * should not be held hostage to its bookkeeping row. But it must be loud.
   */
  auditWriteFailures: number
}

/**
 * Where a partial catalog walk left off.
 *
 * One row, with the day inside the value rather than in the key: `pipeline_settings`
 * already carries 2,182 keys and a date-scoped key name would add one per day
 * forever. A stored day that is not today is treated as absent, so a stale cursor
 * can never silently resume into a catalog that has since been reordered.
 */
export const PRICING_BATCH_CURSOR_KEY = 'pricing_batch_cursor'

interface PricingBatchCursor {
  day:      string
  cursor:   string | null
  done:     boolean
  dayTotal: number
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export async function readPricingBatchCursor(day: string): Promise<PricingBatchCursor | null> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, PRICING_BATCH_CURSOR_KEY))
      .limit(1)
    const raw = rows[0]?.value
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PricingBatchCursor>
    if (parsed.day !== day) return null
    return {
      day,
      cursor:   typeof parsed.cursor === 'string' ? parsed.cursor : null,
      done:     parsed.done === true,
      dayTotal: typeof parsed.dayTotal === 'number' ? parsed.dayTotal : 0,
    }
  } catch (err) {
    // A cursor we cannot read means "start from the top", never "stop".
    console.warn('[pricing-batch] cursor read failed (starting fresh):', err)
    return null
  }
}

async function writePricingBatchCursor(state: PricingBatchCursor): Promise<void> {
  // Ephemeral run state, not a valve: deliberately not routed through the
  // audited settings setter, which would write one audit row per continuation.
  try {
    await db
      .insert(pipelineSettings)
      .values({ key: PRICING_BATCH_CURSOR_KEY, value: JSON.stringify(state) })
      .onConflictDoUpdate({
        target: pipelineSettings.key,
        set: { value: JSON.stringify(state), updatedAt: sql`now()` },
      })
  } catch (err) {
    // Losing the checkpoint costs a repeat of today's head, not correctness.
    console.warn('[pricing-batch] cursor write failed (ignored):', err)
  }
}

/**
 * Walk the catalog and recompute every variant, resumably.
 *
 * The 07:00 pass used to drain the whole catalog into memory and then price it
 * one variant at a time, restarting from the head every single day. When the
 * 300s serverless ceiling killed it partway the run left no trace: `res.json`
 * never fired, the thrown-error alarm never fired (a SIGKILL is not a throw),
 * and the digest printed GOOD on any nonzero row count. The observable result
 * was 2,349 SKUs whose last reprice was 2026-08-16 while every watcher read
 * green, because the walk always re-priced the same head and starved the tail.
 *
 * So the walk now streams page by page, checkpoints the cursor at each page
 * boundary, and stops cleanly when `budgetMs` is spent. Checkpointing is at the
 * page boundary and never mid-page: a page is at most ~50 products, which the
 * margin under the ceiling comfortably covers, and a half-page checkpoint would
 * skip the variants it had not reached.
 */
export async function recomputeCatalog(opts: {
  trigger: Extract<PricingTrigger, 'batch' | 'manual' | 'batch_catchup' | 'batch_continuation'>
  /** Wall-clock budget. Omit for an unbounded walk (scripts, tests). */
  budgetMs?: number
  /** Resume from today's checkpoint instead of starting at the catalog head. */
  resume?: boolean
  /**
   * Clock, injectable so budget behaviour can be tested without depending on
   * wall-clock timing. A test that races a real deadline is the same class of
   * bug as the rail-seed coin flip, so it is not one worth writing.
   */
  now?: () => number
}): Promise<RecomputeCatalogResult> {
  const { fetchPricingProductsPage } = await import('./shopify.server')
  const now = opts.now ?? Date.now
  const startedAt = now()
  const deadline = opts.budgetMs != null ? startedAt + opts.budgetMs : null
  const day = utcDay()

  const counts: RecomputeCatalogResult = {
    total: 0, autoApplied: 0, pending: 0, skipped: 0, rejected: 0, errors: 0,
    durationMs: 0, done: false, pages: 0, dayTotal: 0, auditWriteFailures: 0,
  }

  const prior = opts.resume ? await readPricingBatchCursor(day) : null
  if (prior?.done) {
    // The catalog already ran out today. Nothing to do, and say so honestly
    // rather than starting a second full walk.
    counts.done = true
    counts.dayTotal = prior.dayTotal
    counts.durationMs = now() - startedAt
    return counts
  }

  let cursor: string | null = prior?.cursor ?? null
  let dayTotal = prior?.dayTotal ?? 0

  // Read settings once per run; recomputeFromData reuses the fetched product
  // data so the only per-variant Shopify call is the apply mutation.
  // (Refetching every variant + settings per variant blew past the 300s
  // serverless limit on manual runs.)
  const mode       = await getApprovalMode()
  const thresholds = await getModeThresholds()
  const mapBrands  = await getMapBrands()
  const ctx: RunContext = { trigger: opts.trigger, mode, thresholds, mapBrands }

  for (;;) {
    // Budget is checked at the page boundary, before fetching more work.
    if (deadline != null && now() >= deadline) break

    if (counts.pages > 0) {
      // Preserve the deliberate inter-page spacing. Three separate throttle
      // incidents (2026-07-28, 07-30, 08-19) bought this delay; a resumable
      // walk is not a reason to spend it.
      await new Promise(r => setTimeout(r, PRICING_PAGE_PACING_MS))
    }

    const page = await fetchPricingProductsPage({ cursor })
    counts.pages++

    for (const product of page.products) {
      for (const variant of product.variants) {
        if (TEST_SKU_PREFIX.test(variant.sku ?? '')) continue
        counts.total++
        dayTotal++
        try {
          const result = await recomputeFromData(product, variant, ctx)
          if (result.auditFailed)                      counts.auditWriteFailures++
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

    cursor = page.endCursor
    if (!page.hasNextPage) {
      counts.done = true
      break
    }
  }

  counts.dayTotal = dayTotal
  await writePricingBatchCursor({ day, cursor, done: counts.done, dayTotal })

  counts.durationMs = now() - startedAt
  return counts
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * How long a prunable audit row is kept.
 *
 * The table grows about 5,000 rows a day from the full-catalog recompute and
 * had no retention at all, sitting at 310,170 rows. A 90-day prune was promised
 * alongside the recompute alarm and never shipped, so this closes that.
 *
 * Tightened 90 -> 30 (owner direction, 2026-09-04): at 440,593 rows / 192MB,
 * 86% of them 'skipped_no_change' or 'rejected' rows the daily batch writes
 * for every SKU whether or not anything changed. Only the prunable window
 * moved; PRUNABLE_AUDIT_STATUSES is unchanged, so 'applied', 'auto_applied',
 * and 'pending' rows -- the permanent price-change trail and any live pending
 * decision -- are untouched at any retention window.
 */
export const PRICING_AUDIT_RETENTION_DAYS = 30

/**
 * The only statuses the prune may delete.
 *
 * This is an allowlist rather than a blocklist on purpose. `applied` and
 * `auto_applied` rows ARE the price-change history this table exists to be, and
 * `pending` is a live approval-queue row the pricing sweep still reads with no
 * date floor: deleting an old one would destroy an unanswered decision rather
 * than surface it. Only the two noise statuses go.
 *
 * That is not a small carve-out. Measured on 2026-07-30, `skipped_no_change`
 * and `rejected` are 297,730 of 310,170 rows, so pruning only these still
 * removes 96% of the growth while keeping 100% of the actual audit trail.
 * A new status added to AuditStatus later is retained by default, which is the
 * right way for this list to fail.
 */
export const PRUNABLE_AUDIT_STATUSES: readonly string[] = ['skipped_no_change', 'rejected']

/**
 * Rows deleted per call. The first real prune has a large backlog to clear and
 * this handler shares the cron's maxDuration with a full-catalog recompute, so
 * it takes a bite rather than the whole table. The job runs daily; a backlog
 * drains over a few days without ever risking the recompute it rides on.
 */
const PRUNE_CHUNK = 20_000

/**
 * Delete aged-out noise rows. Returns how many went.
 *
 * Callers should treat a throw as non-fatal: a recompute that succeeded must
 * not be reported as failed because housekeeping did not.
 */
export async function prunePricingAuditLog(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM pricing_audit_log
     WHERE id IN (
       SELECT id
         FROM pricing_audit_log
        WHERE occurred_at < now() - make_interval(days => ${PRICING_AUDIT_RETENTION_DAYS})
          AND status = ANY (${sql.raw(`ARRAY['${PRUNABLE_AUDIT_STATUSES.join("','")}']`)})
        ORDER BY id
        LIMIT ${PRUNE_CHUNK}
     )
     RETURNING id`)
  return (res.rows ?? []).length
}

// ---------------------------------------------------------------------------
// Partial-run detection (ticket #7516)
// ---------------------------------------------------------------------------

/**
 * How far below the trailing baseline a day's `trigger='batch'` row count
 * must fall to be flagged partial, rather than ordinary day-to-day
 * catalog-size fluctuation. The 2026-08-30..09-02 partial-run streak (a
 * maxDuration-limited walk) logged 1,154-2,138 rows against a 3,000-5,900+
 * healthy baseline — comfortably under 60% of it — so this threshold catches
 * that streak without being noisy on ordinary variation.
 */
export const PARTIAL_BATCH_THRESHOLD = 0.6

/**
 * Pure function: is today's `trigger='batch'` row count a partial run against
 * its trailing baseline?
 *
 * The daily digest's existing check (`owner-digest.server.ts`) only asks
 * whether any `trigger='batch'` rows exist for the day, and the cron
 * handler's own check compares against a hardcoded floor (`EXPECTED_MIN_PRODUCTS
 * = 800`). Neither catches this class of failure: every day in the
 * 2026-08-30..09-02 streak logged well over 800 rows, so a run killed
 * partway through the catalog by the serverless time budget read as healthy
 * on both checks while un-priced SKUs went stale until the next (possibly
 * also partial) run.
 *
 * Returns false — never "partial" — when there is no positive trailing
 * baseline to compare against; an empty or all-zero history cannot judge a
 * shortfall, and a genuine zero-row day is a full miss, caught separately.
 */
export function isPartialBatchDay(todayCount: number, baselineCounts: number[]): boolean {
  const positive = baselineCounts.filter(n => n > 0)
  if (positive.length === 0) return false
  const sorted = [...positive].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return todayCount > 0 && todayCount < median * PARTIAL_BATCH_THRESHOLD
}

/**
 * Trailing `trigger='batch'` daily row counts from `pricing_audit_log`,
 * oldest constraint applied via the date filter, one entry per day that has
 * at least one such row (a day with none is a full miss, not a `0` baseline
 * sample — folding it in would silently drag the median down and mask the
 * next partial day). Excludes today (UTC) so the current day is never its
 * own baseline. Feeds `isPartialBatchDay`.
 */
export async function getRecentBatchDayCounts(days = 7): Promise<number[]> {
  const res = await db.execute(sql`
    SELECT date_trunc('day', occurred_at)::date AS day, COUNT(*)::int AS n
      FROM pricing_audit_log
     WHERE trigger = 'batch'
       AND occurred_at >= now()::date - make_interval(days => ${days})
       AND occurred_at <  now()::date
     GROUP BY day`)
  return (res.rows ?? []).map(r => Number((r as { n: unknown }).n ?? 0))
}
