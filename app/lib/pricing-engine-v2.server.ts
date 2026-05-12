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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100
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
 */
export function computePrice(params: {
  cost:  number | null
  map:   number | null
  msrp:  number | null
  cfg:   PricingConfig
}): PriceResult | null {
  const { cost, map, msrp, cfg } = params

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

  const compare_at =
    cfg.compare_at_strategy === 'msrp' && msrp != null && sell < msrp
      ? msrp
      : null

  return { sell, compare_at }
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
