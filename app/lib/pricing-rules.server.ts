// pricing-rules.server.ts
// Rule resolution for pricing agent v2.
// Walks: product_type -> sub_group -> group -> global, coalescing NULLs upward.
// Pure resolution logic; no Shopify I/O.

import { eq, inArray } from 'drizzle-orm'
import { db } from './db.server'
import {
  pricingRules,
  pricingProductTypeMap,
  pricingSubGroups,
} from '../../db/schema'
import type { PricingConfig, MapBehavior, CompareAtStrategy } from './pricing-engine-v2.server'
import type { VelocityBucket } from './pricing-engine-v2.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedConfig extends PricingConfig {
  groupId: string
  subGroupId: string
}

export interface GroupLookup {
  groupId: string
  subGroupId: string
  usesClearanceLadder: boolean
}

// ---------------------------------------------------------------------------
// In-memory cache (5 min TTL, invalidated by rule writes)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const CONFIG_CACHE = new Map<string, CacheEntry<ResolvedConfig>>()
const GROUP_CACHE  = new Map<string, CacheEntry<GroupLookup | null>>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = map.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    map.delete(key)
    return undefined
  }
  return entry.value
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** Call after any rule write so next resolution picks up fresh data. */
export function invalidatePricingRuleCache(): void {
  CONFIG_CACHE.clear()
  GROUP_CACHE.clear()
}

// ---------------------------------------------------------------------------
// Global defaults (hard-coded fallbacks if DB has no global row)
// ---------------------------------------------------------------------------

const GLOBAL_DEFAULTS: PricingConfig = {
  target_margin_pct:         0.50,
  margin_floor_pct:          0.25,
  map_behavior:              'at_map',
  compare_at_strategy:       'msrp',
  velocity_modifier_enabled: false,
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface RawRule {
  targetMarginPct:         string | null
  marginFloorPct:          string | null
  mapBehavior:             string | null
  compareAtStrategy:       string | null
  velocityModifierEnabled: boolean | null
}

function toPartial(raw: RawRule): Partial<PricingConfig> {
  const out: Partial<PricingConfig> = {}
  if (raw.targetMarginPct         != null) out.target_margin_pct         = parseFloat(raw.targetMarginPct)
  if (raw.marginFloorPct          != null) out.margin_floor_pct          = parseFloat(raw.marginFloorPct)
  if (raw.mapBehavior             != null) out.map_behavior              = raw.mapBehavior as MapBehavior
  if (raw.compareAtStrategy       != null) out.compare_at_strategy       = raw.compareAtStrategy as CompareAtStrategy
  if (raw.velocityModifierEnabled != null) out.velocity_modifier_enabled = raw.velocityModifierEnabled
  return out
}

async function fetchRules(scopePairs: Array<[string, string]>): Promise<Map<string, RawRule>> {
  if (scopePairs.length === 0) return new Map()

  const ids = scopePairs.map(([, id]) => id)
  const rows = await db
    .select()
    .from(pricingRules)
    .where(inArray(pricingRules.scopeId, ids))

  const map = new Map<string, RawRule>()
  for (const row of rows) {
    const key = `${row.scopeLevel}:${row.scopeId}`
    map.set(key, {
      targetMarginPct:         row.targetMarginPct         ?? null,
      marginFloorPct:          row.marginFloorPct          ?? null,
      mapBehavior:             row.mapBehavior             ?? null,
      compareAtStrategy:       row.compareAtStrategy       ?? null,
      velocityModifierEnabled: row.velocityModifierEnabled ?? null,
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Group lookup
// ---------------------------------------------------------------------------

export async function getGroupForProductType(
  productType: string | null,
): Promise<GroupLookup | null> {
  const cacheKey = productType ?? '__null__'
  const cached = cacheGet(GROUP_CACHE, cacheKey)
  if (cached !== undefined) return cached

  if (!productType) {
    cacheSet(GROUP_CACHE, cacheKey, null)
    return null
  }

  const rows = await db
    .select({
      subGroupId: pricingProductTypeMap.subGroupId,
      groupId:    pricingSubGroups.groupId,
    })
    .from(pricingProductTypeMap)
    .innerJoin(
      pricingSubGroups,
      eq(pricingProductTypeMap.subGroupId, pricingSubGroups.id),
    )
    .where(eq(pricingProductTypeMap.productType, productType))
    .limit(1)

  if (rows.length === 0) {
    cacheSet(GROUP_CACHE, cacheKey, null)
    return null
  }

  // Fetch uses_clearance_ladder from pricing_groups via a second query.
  const { pricingGroups } = await import('../../db/schema')
  const groupRows = await db
    .select({ usesClearanceLadder: pricingGroups.usesClearanceLadder })
    .from(pricingGroups)
    .where(eq(pricingGroups.id, rows[0]!.groupId))
    .limit(1)

  const result: GroupLookup = {
    groupId:             rows[0]!.groupId,
    subGroupId:          rows[0]!.subGroupId,
    usesClearanceLadder: groupRows[0]?.usesClearanceLadder ?? false,
  }

  cacheSet(GROUP_CACHE, cacheKey, result)
  return result
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Walk: product_type -> sub_group -> group -> global, coalescing NULLs upward.
 * Returns a fully resolved PricingConfig (no nulls) ready for computePrice.
 * Falls back to GLOBAL_DEFAULTS if DB has no matching rows.
 */
export async function resolvePricingConfig(
  productType: string | null,
): Promise<ResolvedConfig> {
  const cacheKey = productType ?? '__null__'
  const cached = cacheGet(CONFIG_CACHE, cacheKey)
  if (cached !== undefined) return cached

  const group = await getGroupForProductType(productType)

  const groupId    = group?.groupId    ?? 'unknown'
  const subGroupId = group?.subGroupId ?? 'unknown'

  // Determine which scope pairs to fetch.
  const scopePairs: Array<[string, string]> = [['global', 'global']]
  if (groupId !== 'unknown') {
    scopePairs.push(['group', groupId])
  }
  if (subGroupId !== 'unknown' && subGroupId !== groupId) {
    scopePairs.push(['sub_group', subGroupId])
  }
  if (productType) {
    scopePairs.push(['product_type', productType])
  }

  const ruleMap = await fetchRules(scopePairs)

  // Coalesce from broadest to narrowest (last write wins on each field).
  let merged: PricingConfig = { ...GLOBAL_DEFAULTS }

  for (const [level, id] of scopePairs) {
    const raw = ruleMap.get(`${level}:${id}`)
    if (raw) {
      merged = { ...merged, ...toPartial(raw) }
    }
  }

  const result: ResolvedConfig = { ...merged, groupId, subGroupId }
  cacheSet(CONFIG_CACHE, cacheKey, result)
  return result
}

// ---------------------------------------------------------------------------
// Rationale templates (spec ss8)
// ---------------------------------------------------------------------------

export interface RationaleParams {
  oldCost:        number | null
  newCost:        number | null
  oldSell:        number | null
  newSell:        number | null
  status:         'auto_applied' | 'pending' | 'skipped_no_change' | 'rejected'
  trigger:        string
  velocityBucket?: VelocityBucket
  daysDisc?:      number
  mapHeld:        boolean
  marginAfter:    number | null
  map?:           number | null
  msrp?:          number | null
  /** True when the MSRP ceiling, not a rule violation, is what pinned the price below the margin floor (#7515). */
  msrpBelowFloor?: boolean
  deltaPct?:      number | null
  approvalThreshold?: number | null
}

export function buildRationale(p: RationaleParams): string {
  const margin = p.marginAfter != null ? `${Math.round(p.marginAfter * 100)}%` : '?%'

  // No-change case.
  if (p.status === 'skipped_no_change') {
    return 'Cost unchanged; recompute matched current price; no action.'
  }

  // Discontinued clearance ladder.
  if (p.daysDisc != null) {
    const tier = p.daysDisc <= 30 ? '15%' :
                 p.daysDisc <= 60 ? '25%' :
                 p.daysDisc <= 90 ? '35%' : '50%'
    const sell = p.newSell != null ? `$${p.newSell.toFixed(2)}` : '?'
    return `Discontinued day ${p.daysDisc} -> clearance tier ${tier} off cost-based target -> ${sell}.`
  }

  // Velocity adjustment.
  if (p.velocityBucket && p.velocityBucket !== 'normal') {
    const dir    = p.velocityBucket === 'top'  ? '+5pp' :
                   p.velocityBucket === 'slow' ? '-5pp' : '-10pp'
    const label  = p.velocityBucket === 'top'  ? 'fast' :
                   p.velocityBucket === 'slow' ? 'slow' : 'dead'
    const oldFmt = p.oldSell != null ? `$${p.oldSell.toFixed(2)}` : '?'
    const newFmt = p.newSell != null ? `$${p.newSell.toFixed(2)}` : '?'
    return `Velocity: ${label} -> target margin ${dir}; new sell ${newFmt} (was ${oldFmt}).`
  }

  // Queued because MSRP pins the price below the margin floor — an
  // unsatisfiable constraint (#7515), not a rule violation, so it needs an
  // owner decision (raise/verify MSRP, accept the lower margin, or an
  // exception) rather than a silent, permanently recurring rejection.
  if (p.status === 'pending' && p.msrpBelowFloor) {
    const sell = p.newSell != null ? `$${p.newSell.toFixed(2)}` : '?'
    const msrpFmt = p.msrp != null ? `$${p.msrp.toFixed(2)}` : '?'
    return `Queued: MSRP ceiling ${msrpFmt} holds sell at ${sell} below the margin floor (margin ${margin}); needs an MSRP decision.`
  }

  // Queued because delta exceeds threshold. Direction is taken from the actual
  // sell prices, not the (abs) magnitude, so an increase is never labelled a
  // "drop" (a below-MAP product raised to MAP is an increase, not a drop).
  if (p.status === 'pending' && p.deltaPct != null && p.approvalThreshold != null) {
    const pct = Math.round(Math.abs(p.deltaPct) * 100)
    const thr = Math.round(p.approvalThreshold * 100)
    const dir =
      p.oldSell != null && p.newSell != null && p.newSell < p.oldSell
        ? 'drop'
        : 'increase'
    return `Queued: ${pct}% price ${dir} exceeds ${thr}% auto-approve threshold.`
  }

  // Cost change with MAP held.
  if (p.mapHeld && p.map != null) {
    const delta   = p.oldCost != null && p.newCost != null ? p.newCost - p.oldCost : null
    const deltaPct = delta != null && p.oldCost ? Math.round((delta / p.oldCost) * 100) : null
    if (delta != null && deltaPct != null) {
      const sign = delta >= 0 ? '+' : ''
      return `Cost ${sign}$${delta.toFixed(2)} (${sign}${deltaPct}%) -> held sell at MAP $${p.map.toFixed(2)}; margin now ${margin}.`
    }
  }

  // Generic auto-applied.
  if (p.status === 'auto_applied') {
    const oldFmt = p.oldSell != null ? `$${p.oldSell.toFixed(2)}` : '?'
    const newFmt = p.newSell != null ? `$${p.newSell.toFixed(2)}` : '?'
    return `Auto-applied: sell ${oldFmt} -> ${newFmt}; margin now ${margin}.`
  }

  // Rejected.
  if (p.status === 'rejected') {
    return `Rejected: margin ${margin} below floor or MAP not satisfied.`
  }

  return `Recomputed via ${p.trigger}; margin ${margin}.`
}
