// Pricing engine v2 — target-margin model per Pricing Agent refactor spec ss2.
// Pure functions only; no I/O, no DB. Coexists with pricing-engine.server.ts
// until cutover.

export type MapBehavior = 'at_map' | 'above_map_only' | 'ignore_map'
export type CompareAtStrategy = 'msrp' | 'none'
export type VelocityBucket = 'top' | 'normal' | 'slow' | 'dead'

export interface PricingConfig {
  target_margin_pct: number
  margin_floor_pct: number
  map_behavior: MapBehavior
  compare_at_strategy: CompareAtStrategy
  velocity_modifier_enabled: boolean
}

export interface PriceResult {
  sell: number
  compare_at: number | null
}

/**
 * Absolute minimum sell price — prevents margin math from producing
 * nonsense prices like $0.35 on cheap accessories.
 * Products priced below this floor are queued instead of auto-applied.
 * Override via engine config; this constant is the fallback.
 */
export const ABSOLUTE_PRICE_FLOOR_DEFAULT = 2.99

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * MAP floor invariant (ticket #3714): a sell price may never be written below
 * a positive MAP. Pure clamp shared by every Shopify price write path, so a
 * write path that skips computePrice still cannot set price below map_price.
 * Returns the price unchanged when no MAP applies.
 */
export function enforceMapFloor(price: number, map: number | null | undefined): number {
  if (map == null || map <= 0) return price
  return price < map ? round2(map) : price
}

/**
 * Brands whose MAP is formally (contractually) enforced. Owner direction
 * 2026-08-18: only Lovense and Playground are MAP-restricted; every other
 * brand's map_price is advisory and must never raise the sell price. Matched
 * case-insensitively against the Shopify vendor. Overridable at runtime via the
 * `pricing_map_enforced_brands` pipeline setting (see getMapEnforcedBrands).
 */
export const DEFAULT_MAP_ENFORCED_BRANDS: readonly string[] = ['lovense', 'playground']

/**
 * True when a product's brand (Shopify vendor) is on the MAP-enforced list, so
 * the MAP floor binds. For every other brand the caller must treat MAP as
 * non-binding: pass map=null into computePrice and skip the write-path guard.
 */
export function isMapEnforcedBrand(
  vendor: string | null | undefined,
  brands: readonly string[] = DEFAULT_MAP_ENFORCED_BRANDS,
): boolean {
  if (!vendor) return false
  const v = vendor.trim().toLowerCase()
  return brands.some(b => b.trim().toLowerCase() === v)
}

/**
 * Psychological rounding: result ends in .99 and is <= input.
 * Convention: floor(n) - 0.01. e.g. 24.37 -> floor=24 -> 23.99.
 * For n < 1 we skip the ladder and return round2(n).
 */
export function roundPsychological(n: number, ending: '.99' | '.95' | '.49' = '.99'): number {
  if (n < 1) return round2(n)
  const suffix = parseFloat(ending) // 0.99 | 0.95 | 0.49
  const floored = Math.floor(n)
  // e.g. 24.37 -> floor=24, candidate=23.99 (24 - 0.01 when ending=.99)
  const candidate = floored - (1 - suffix)
  // If input is already exactly at or above candidate, use candidate.
  // If candidate < 0 (shouldn't happen for n>=1), fall back to round2.
  return candidate > 0 ? round2(candidate) : round2(n)
}

// ---------------------------------------------------------------------------
// Velocity modifier (spec ss4)
// Returns a new cfg with target_margin_pct shifted; margin_floor_pct unchanged.
// ---------------------------------------------------------------------------

const VELOCITY_SHIFT: Record<VelocityBucket, number> = {
  top:    +0.05,
  normal:  0.00,
  slow:   -0.05,
  dead:   -0.10,
}

export function applyVelocityModifier(cfg: PricingConfig, bucket: VelocityBucket): PricingConfig {
  const shift = VELOCITY_SHIFT[bucket]
  return {
    ...cfg,
    target_margin_pct: cfg.target_margin_pct + shift,
  }
}

// ---------------------------------------------------------------------------
// Main pricing formula (spec ss2.2)
// ---------------------------------------------------------------------------

/**
 * Compute sell and compare_at prices for a live SKU.
 * Returns null when cost is missing (cannot price without cost).
 *
 * @param absolutePriceFloor - Optional minimum sell price. When the computed
 *   sell price would fall below this value the result is flagged so the caller
 *   can queue the change instead of auto-applying it.
 *   Defaults to ABSOLUTE_PRICE_FLOOR_DEFAULT when not supplied.
 */
export function computePrice(params: {
  cost:               number | null
  map:                number | null
  msrp:               number | null
  cfg:                PricingConfig
  absolutePriceFloor?: number
}): PriceResult & { belowAbsoluteFloor: boolean } | null {
  const { cost, map, msrp, cfg } = params
  const absolutePriceFloor = params.absolutePriceFloor ?? ABSOLUTE_PRICE_FLOOR_DEFAULT

  if (cost == null) return null

  const target = cost / (1 - cfg.target_margin_pct)
  const floor  = cost / (1 - cfg.margin_floor_pct)

  let sell = target

  // MAP enforcement
  if (cfg.map_behavior !== 'ignore_map' && map != null) {
    sell = Math.max(sell, map)
    if (cfg.map_behavior === 'above_map_only' && sell === map) {
      sell += 0.01
    }
  }

  // Margin floor (applied after MAP so floor can override MAP)
  sell = Math.max(sell, floor)

  // MSRP ceiling
  if (msrp != null) {
    sell = Math.min(sell, msrp)
  }

  sell = roundPsychological(sell)

  // MAP re-clamp AFTER rounding (ticket #3714). roundPsychological only rounds
  // down, so a MAP-clamped sell came out below MAP (MAP 25.00 -> 24.99, and
  // MAP 24.99 -> 23.99, a full dollar under the advertised floor). That made
  // the engine's own output violate its MAP floor, decideStatus then rejected
  // the recompute, and any product already priced below MAP stayed there
  // forever. Compliance beats the .99 aesthetic: land exactly on MAP
  // (above_map_only lands a cent over).
  if (cfg.map_behavior !== 'ignore_map' && map != null && sell < map) {
    sell = cfg.map_behavior === 'above_map_only' ? round2(map + 0.01) : round2(map)
  }

  const compare_at =
    cfg.compare_at_strategy === 'msrp' && msrp != null && sell < msrp
      ? msrp
      : null

  return { sell, compare_at, belowAbsoluteFloor: sell < absolutePriceFloor }
}

// ---------------------------------------------------------------------------
// Discontinued clearance ladder (spec ss2.3)
// ---------------------------------------------------------------------------

const CLEARANCE_LADDER: Array<[number, number]> = [
  [30,    0.15],
  [60,    0.25],
  [90,    0.35],
  [10_000, 0.50],
]

/**
 * Compute sell price for a discontinued item using age-based markdown.
 * MAP does not apply to discontinued items.
 * Returns null when cost or msrp is missing.
 */
export function computeDiscontinuedPrice(params: {
  cost:             number | null
  msrp:             number | null
  daysDiscontinued: number
  cfg:              Pick<PricingConfig, 'margin_floor_pct'>
}): PriceResult | null {
  const { cost, msrp, daysDiscontinued, cfg } = params

  if (msrp == null || cost == null) return null

  const entry = CLEARANCE_LADDER.find(([maxDays]) => daysDiscontinued <= maxDays)
  const discountPct = entry ? entry[1] : 0.50

  let sell = msrp * (1 - discountPct)
  const floor = cost / (1 - cfg.margin_floor_pct)
  sell = Math.max(sell, floor)

  return { sell: roundPsychological(sell), compare_at: msrp }
}
