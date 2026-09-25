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

/**
 * Psychological rounding that never lands below the input: the smallest value
 * ending in .99 that is >= n. e.g. 18.82 -> 18.99, 13.22 -> 13.99, 8.06 -> 8.99.
 * Used to keep a floor-clamped price on a clean .99 point instead of the raw
 * floor value, while staying at or above that floor.
 */
export function roundUpPsychological(n: number): number {
  const base = Math.floor(n)
  let candidate = base + 0.99
  // Guard the rare case where n's fractional part already exceeds .99
  // (e.g. 18.995): step to the next dollar's .99.
  if (candidate < n) candidate = base + 1 + 0.99
  return round2(candidate)
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
  /**
   * Whether MSRP caps the sell price. Off by default in production via the
   * `pricing_msrp_ceiling_enabled` valve (owner direction 2026-09-25: MSRP is
   * irrelevant to pricing; only Lovense/Playground MAP binds). When off, MSRP
   * still supplies the compare-at strike-through where the strategy asks for
   * it, but never pulls the sell price down and can never produce
   * `msrpBelowFloor`. Defaults to true here so pure callers and existing tests
   * keep the historical formula.
   */
  msrpCeiling?:       boolean
}): PriceResult & { belowAbsoluteFloor: boolean; msrpBelowFloor: boolean } | null {
  const { cost, map, cfg } = params
  const absolutePriceFloor = params.absolutePriceFloor ?? ABSOLUTE_PRICE_FLOOR_DEFAULT
  // With the ceiling off, treat MSRP as absent for every sell-price step below;
  // it is re-read only for compare_at.
  const msrp = params.msrpCeiling === false ? null : params.msrp

  if (cost == null) return null

  const target = cost / (1 - cfg.target_margin_pct)
  const floor  = cost / (1 - cfg.margin_floor_pct)

  // The margin-floor clamp below only raises `sell` to `floor`; the MSRP
  // ceiling that follows can still pull it back down past that floor when
  // `msrp` itself sits below the floor-satisfying price. That is not a
  // pricing-rule violation to silently drop (ticket #7515) — it is an
  // unsatisfiable constraint (MSRP too low for the configured margin floor)
  // that decideStatus surfaces to a human instead of rejecting outright.
  const msrpBelowFloor = msrp != null && floor > msrp

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

  // Margin-floor re-clamp AFTER rounding (ticket #7884). roundPsychological
  // only rounds down, so a sell price clamped exactly to the margin floor at
  // line 147 can round back below it (floor 15.38 -> 14.99), manufacturing a
  // margin-floor violation that decideStatus then rejects, forever, out of a
  // price that was actually satisfiable. This is the same rounding defect
  // computeDiscontinuedPrice below already guards against; velocity's -10pp
  // "dead" shift (applyVelocityModifier) pushes target_margin_pct toward the
  // floor often enough to turn this into a recurring reject storm on the
  // affected group. Skip the guard when MSRP itself is the binding, sub-floor
  // ceiling (msrpBelowFloor) — that case is a real unsatisfiable constraint
  // routed to 'pending' for an owner decision (#7515), not a rounding
  // artifact to paper over.
  if (!msrpBelowFloor && sell < floor) {
    sell = roundUpPsychological(floor)
    if (msrp != null) sell = Math.min(sell, msrp)
  }

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

  const compareMsrp = params.msrp
  const compare_at =
    cfg.compare_at_strategy === 'msrp' && compareMsrp != null && sell < compareMsrp
      ? compareMsrp
      : null

  return { sell, compare_at, belowAbsoluteFloor: sell < absolutePriceFloor, msrpBelowFloor }
}

// ---------------------------------------------------------------------------
// Discontinued clearance ladder (spec ss2.3)
// ---------------------------------------------------------------------------

/** [maxDaysDiscontinued, markdownFraction] steps, ascending by days. */
export type ClearanceLadder = ReadonlyArray<readonly [number, number]>

export const DEFAULT_CLEARANCE_LADDER: ClearanceLadder = [
  [30,    0.15],
  [60,    0.25],
  [90,    0.35],
  [10_000, 0.50],
]

/**
 * Parse an owner-edited ladder (pipeline_settings `pricing_clearance_ladder`,
 * JSON `[[days, pct], ...]`). Returns null on anything malformed so the caller
 * falls back to the default instead of pricing off garbage. Steps are sorted
 * by days; a final catch-all step is appended when the last one is finite.
 */
export function parseClearanceLadder(raw: string | null | undefined): ClearanceLadder | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const steps: Array<[number, number]> = []
    for (const step of parsed) {
      if (!Array.isArray(step) || step.length !== 2) return null
      const days = Number(step[0]); const pct = Number(step[1])
      if (!Number.isFinite(days) || days < 0 || !Number.isFinite(pct) || pct < 0 || pct >= 1) return null
      steps.push([Math.floor(days), pct])
    }
    steps.sort((a, b) => a[0] - b[0])
    const last = steps[steps.length - 1]!
    if (last[0] < 10_000) steps.push([10_000, last[1]])
    return steps
  } catch {
    return null
  }
}

/**
 * Compute sell price for a discontinued item using age-based markdown.
 *
 * Cost-based (owner direction 2026-08-30): the clearance markdown is applied to
 * the cost-based target price, never to MSRP. Previously the anchor was
 * `msrp * (1 - discountPct)`, which priced discontinued stock toward MSRP and
 * produced large, MSRP-driven increases in the approval queue. MSRP now only
 * caps the result (never advertise above it) and supplies the compare-at
 * strike-through; it never sets the markup basis.
 *
 * MAP does not apply to discontinued items. Returns null when cost is missing
 * (cannot price without cost); MSRP is no longer required.
 */
export function computeDiscontinuedPrice(params: {
  cost:             number | null
  msrp:             number | null
  daysDiscontinued: number
  cfg:              Pick<PricingConfig, 'target_margin_pct' | 'margin_floor_pct'>
  /** See computePrice. When false, MSRP is compare-at only, never a cap. */
  msrpCeiling?:     boolean
  /** Owner-edited markdown steps; defaults to DEFAULT_CLEARANCE_LADDER. */
  ladder?:          ClearanceLadder
}): PriceResult | null {
  const { cost, daysDiscontinued, cfg } = params
  const msrp = params.msrpCeiling === false ? null : params.msrp
  const ladder = params.ladder ?? DEFAULT_CLEARANCE_LADDER

  if (cost == null) return null

  const entry = ladder.find(([maxDays]) => daysDiscontinued <= maxDays)
  const discountPct = entry ? entry[1] : ladder[ladder.length - 1]?.[1] ?? 0.50

  // Cost-based anchor: the cost-plus-target price, marked down by the age-based
  // clearance percentage, never below the cost-based margin floor.
  const target = cost / (1 - cfg.target_margin_pct)
  const floor  = cost / (1 - cfg.margin_floor_pct)
  let sell = target * (1 - discountPct)
  sell = Math.max(sell, floor)

  // MSRP is a ceiling only (never advertise above it), and the compare-at
  // reference — it never drives the sell price.
  if (msrp != null) sell = Math.min(sell, msrp)

  // roundPsychological only rounds down, which can push the price below the
  // cost-based floor (and, for very cheap items, below cost — cost $1.35 /
  // floor $1.59 would round to $0.99). When that happens, round the floor UP
  // to the next .99 instead so the price stays on a clean point and at or above
  // the floor ($18.82 -> $18.99), rather than landing on the raw floor value.
  let rounded = roundPsychological(sell)
  if (rounded < floor) rounded = roundUpPsychological(floor)

  const compareMsrp = params.msrp
  const compare_at = compareMsrp != null && rounded < compareMsrp ? compareMsrp : null
  return { sell: rounded, compare_at }
}
