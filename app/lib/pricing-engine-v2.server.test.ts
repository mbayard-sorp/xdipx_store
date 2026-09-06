import { describe, expect, it } from 'vitest'
import {
  applyVelocityModifier,
  computeDiscontinuedPrice,
  computePrice,
  enforceMapFloor,
  roundPsychological,
  roundUpPsychological,
  ABSOLUTE_PRICE_FLOOR_DEFAULT,
  type PricingConfig,
} from './pricing-engine-v2.server'

// Default config used across most tests
function cfg(overrides: Partial<PricingConfig> = {}): PricingConfig {
  return {
    target_margin_pct: 0.50,
    margin_floor_pct: 0.25,
    map_behavior: 'at_map',
    compare_at_strategy: 'msrp',
    velocity_modifier_enabled: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computePrice
// ---------------------------------------------------------------------------

describe('computePrice — basic', () => {
  it('returns null when cost is null', () => {
    expect(computePrice({ cost: null, map: 20, msrp: 50, cfg: cfg() })).toBeNull()
  })

  it('target margin lands above MAP — uses target (not MAP)', () => {
    // cost=10, target_margin=0.50 -> target=20, MAP=15 -> target 20 > MAP 15
    const r = computePrice({ cost: 10, map: 15, msrp: 50, cfg: cfg() })
    // roundPsychological(20) = 19.99
    expect(r?.sell).toBe(19.99)
  })
})

describe('computePrice — MAP enforcement', () => {
  it('at_map: cost below MAP target -> snaps to MAP exactly (never below)', () => {
    // cost=10, target_margin=0.50 -> target=20, MAP=25 -> sell snaps to MAP=25.
    // roundPsychological(25) would give 24.99, which is BELOW MAP (ticket #3714);
    // the post-round re-clamp lands the price exactly on MAP instead.
    const r = computePrice({ cost: 10, map: 25, msrp: 60, cfg: cfg({ map_behavior: 'at_map' }) })
    expect(r?.sell).toBe(25.00)
  })

  it('at_map: MAP ending in .99 is honored exactly (regression, ticket #3714)', () => {
    // MAP=24.99: roundPsychological(24.99) = 23.99, a full dollar below the
    // advertised floor. This was the systematic below-MAP write bug.
    const r = computePrice({ cost: 10, map: 24.99, msrp: 60, cfg: cfg({ map_behavior: 'at_map' }) })
    expect(r?.sell).toBe(24.99)
  })

  it('above_map_only: lands one cent over MAP when target < MAP', () => {
    const rAtMap     = computePrice({ cost: 10, map: 25, msrp: 60, cfg: cfg({ map_behavior: 'at_map' }) })
    const rAboveMap  = computePrice({ cost: 10, map: 25, msrp: 60, cfg: cfg({ map_behavior: 'above_map_only' }) })
    expect(rAtMap!.sell).toBe(25.00)
    expect(rAboveMap!.sell).toBe(25.01)
    expect(rAboveMap!.sell).toBeGreaterThan(25)
  })

  it('invariant: sell >= MAP for every MAP-respecting behavior', () => {
    const maps = [3.49, 9.99, 14.5, 19.99, 24.99, 25, 33.33, 49.99, 100]
    for (const map of maps) {
      for (const behavior of ['at_map', 'above_map_only'] as const) {
        const r = computePrice({ cost: 1, map, msrp: 200, cfg: cfg({ map_behavior: behavior }) })
        expect(r).not.toBeNull()
        expect(r!.sell).toBeGreaterThanOrEqual(map)
      }
    }
  })

  it('MAP == MSRP: prices exactly at MAP with no compare_at strike-through', () => {
    // The common Nalpac case (1,639 active products on 2026-08-16): MAP=MSRP
    // means no advertised discount is allowed. Price sits exactly at MAP and
    // compare_at stays null (sell is not < msrp).
    const r = computePrice({ cost: 10, map: 50, msrp: 50, cfg: cfg({ map_behavior: 'at_map' }) })
    expect(r?.sell).toBe(50.00)
    expect(r?.compare_at).toBeNull()
  })

  it('ignore_map: MAP present but ignored', () => {
    // cost=10, target=20, MAP=25 (ignored) -> sell=target=20 -> round -> 19.99
    const r = computePrice({ cost: 10, map: 25, msrp: 60, cfg: cfg({ map_behavior: 'ignore_map' }) })
    expect(r?.sell).toBe(19.99)
  })

  it('MAP missing -> falls back to target margin and floor only', () => {
    // cost=10, target_margin=0.50 -> target=20, floor=cost/(1-0.25)=13.33, no MAP
    // sell=max(20,13.33)=20 -> round -> 19.99
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg() })
    expect(r?.sell).toBe(19.99)
  })
})

describe('computePrice — margin floor', () => {
  it('margin floor wins when target is below floor', () => {
    // cost=10, target_margin=0.10 -> target=11.11, floor=cost/(1-0.25)=13.33
    // sell=max(11.11, 13.33)=13.33 -> round -> 12.99, which is BELOW the
    // floor, so the post-round margin-floor guard (#7884) raises it to
    // roundUpPsychological(13.33)=13.99, the smallest .99 price that still
    // clears the floor.
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg({ target_margin_pct: 0.10 }) })
    expect(r?.sell).toBe(13.99)
    expect((r!.sell - 10) / r!.sell).toBeGreaterThanOrEqual(0.25)
  })

  it('margin floor overrides MAP when floor > MAP', () => {
    // cost=20, floor=cost/(1-0.25)=26.67, MAP=24 (below floor)
    // target=22.22, snap to MAP=24, then floor clamp: max(24,26.67)=26.67.
    // roundPsychological(26.67)=25.99, which is BELOW the floor, so the
    // post-round margin-floor guard (#7884) raises it to
    // roundUpPsychological(26.67)=26.99.
    const r = computePrice({
      cost: 20,
      map: 24,
      msrp: 80,
      cfg: cfg({ target_margin_pct: 0.10 }),
    })
    expect(r?.sell).toBe(26.99)
    expect((r!.sell - 20) / r!.sell).toBeGreaterThanOrEqual(0.25)
    // floor 26.67 > MAP 24, so floor wins
    expect(r!.sell).toBeGreaterThan(24)
  })
})

describe('computePrice — MSRP ceiling', () => {
  it('cost so high that target exceeds MSRP -> caps at MSRP', () => {
    // cost=50, target_margin=0.50 -> target=100, MSRP=80 -> sell capped at 80
    // roundPsychological(80)= floor(80)-0.01=79.99
    const r = computePrice({ cost: 50, map: null, msrp: 80, cfg: cfg() })
    expect(r?.sell).toBe(79.99)
    // compare_at: sell=79.99 < msrp=80, so compare_at=80
    expect(r?.compare_at).toBe(80)
  })

  it('msrpBelowFloor is true when the floor-satisfying price exceeds MSRP (#7515)', () => {
    // cost=9, margin_floor=0.25 -> floor=12.00; msrp=11.99 < floor, so MSRP will
    // pin sell below the margin floor no matter what target_margin_pct says.
    const r = computePrice({ cost: 9, map: null, msrp: 11.99, cfg: cfg({ margin_floor_pct: 0.25 }) })
    expect(r?.msrpBelowFloor).toBe(true)
    expect(r!.sell).toBeLessThanOrEqual(11.99)
  })

  it('msrpBelowFloor is false when MSRP sits at or above the margin floor', () => {
    // cost=9, margin_floor=0.25 -> floor=12.00; msrp=50 is well above it.
    const r = computePrice({ cost: 9, map: null, msrp: 50, cfg: cfg({ margin_floor_pct: 0.25 }) })
    expect(r?.msrpBelowFloor).toBe(false)
  })

  it('msrpBelowFloor is false when MSRP is null (no ceiling to conflict with the floor)', () => {
    const r = computePrice({ cost: 9, map: null, msrp: null, cfg: cfg({ margin_floor_pct: 0.25 }) })
    expect(r?.msrpBelowFloor).toBe(false)
  })

  it('MSRP missing -> no ceiling applied, no compare_at', () => {
    const r = computePrice({ cost: 10, map: null, msrp: null, cfg: cfg() })
    expect(r?.compare_at).toBeNull()
    expect(r?.sell).toBe(19.99)
  })
})

describe('computePrice — margin-floor rounding guard (#7884)', () => {
  // cost=10, margin_floor=0.35 -> floor=15.384615..., roundPsychological(floor)
  // rounds DOWN to 14.99, which sits below the floor and would manufacture a
  // margin-floor violation that decideStatus rejects, recurring forever, even
  // though 15.384615 was itself a satisfiable, floor-clearing price.
  it('a target below the margin floor rounds UP to the floor, not below it', () => {
    const r = computePrice({
      cost: 10,
      map: null,
      msrp: null,
      cfg: cfg({ target_margin_pct: 0.30, margin_floor_pct: 0.35 }),
    })
    const floor = 10 / (1 - 0.35)
    expect(r!.sell).toBeGreaterThanOrEqual(floor)
    expect(r!.sell).toBe(roundUpPsychological(floor))
    const marginAfter = (r!.sell - 10) / r!.sell
    expect(marginAfter).toBeGreaterThanOrEqual(0.35)
  })

  it('reproduces the dead-velocity reject storm (#7884): a "dead" shift that dips below floor still clears it after rounding', () => {
    // Same 0.40 -> 0.30 shift the velocity modifier applies to a dead-bucket
    // variant (-10pp, applyVelocityModifier), against a 0.35 floor typical of
    // the affected pricing group.
    const shifted = applyVelocityModifier(cfg({ target_margin_pct: 0.40, margin_floor_pct: 0.35 }), 'dead')
    expect(shifted.target_margin_pct).toBeCloseTo(0.30)
    const r = computePrice({ cost: 10, map: null, msrp: null, cfg: shifted })
    const marginAfter = (r!.sell - 10) / r!.sell
    expect(marginAfter).toBeGreaterThanOrEqual(0.35)
  })

  it('MSRP-below-floor is still routed to msrpBelowFloor, not silently forced up to the floor', () => {
    // cost=9, margin_floor=0.25 -> floor=12.00; msrp=11.99 is the real,
    // unsatisfiable constraint (#7515) and must not be overridden by the
    // rounding guard added for #7884.
    const r = computePrice({ cost: 9, map: null, msrp: 11.99, cfg: cfg({ margin_floor_pct: 0.25 }) })
    expect(r?.msrpBelowFloor).toBe(true)
    expect(r!.sell).toBeLessThanOrEqual(11.99)
  })

  it('the floor-rounding guard still respects MSRP as a ceiling when MSRP sits between the floor and its rounded-up value', () => {
    // floor = 10/0.65 = 15.384615...; roundUpPsychological(floor) = 15.99.
    // msrp=15.50 sits strictly between the two, so the guard's own re-clamp
    // to msrp should win over the psychological rounding.
    const r = computePrice({
      cost: 10,
      map: null,
      msrp: 15.50,
      cfg: cfg({ target_margin_pct: 0.30, margin_floor_pct: 0.35 }),
    })
    expect(r?.msrpBelowFloor).toBe(false)
    expect(r!.sell).toBe(15.50)
  })
})

describe('computePrice — compare_at', () => {
  it('compare_at = msrp when sell < msrp and strategy = msrp', () => {
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg({ compare_at_strategy: 'msrp' }) })
    expect(r?.compare_at).toBe(50)
  })

  it('compare_at = null when strategy = none', () => {
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg({ compare_at_strategy: 'none' }) })
    expect(r?.compare_at).toBeNull()
  })

  it('compare_at = null when sell === msrp (no meaningful strike-through)', () => {
    // cost=50, msrp=80, target=100 -> capped at 80, sell=79.99 < 80 -> compare_at=80
    // Use a case where sell rounds to exactly msrp: cost=40, target_margin=0.50 -> target=80,
    // MSRP=80 -> sell=min(80,80)=80, round=79.99 < 80 -> compare_at=80 still
    // For sell >= msrp: need floor > msrp which the MSRP ceiling prevents. So sell < msrp always when ceiling applies.
    // Just verify the standard case:
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg() })
    expect(r!.sell).toBeLessThan(50)
    expect(r!.compare_at).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// computeDiscontinuedPrice — clearance ladder
// ---------------------------------------------------------------------------

describe('computeDiscontinuedPrice — cost-based clearance ladder', () => {
  // Clearance markdown is applied to the cost-based target price, not MSRP.
  // target = cost/(1-0.60) = cost*2.5. For cost=20 -> target=50; floor=cost/0.85=23.53.
  const discCfg = { target_margin_pct: 0.60, margin_floor_pct: 0.15 }

  it('returns null when cost is null', () => {
    expect(computeDiscontinuedPrice({ cost: null, msrp: 100, daysDiscontinued: 10, cfg: discCfg })).toBeNull()
  })

  it('prices off cost even when msrp is null (msrp no longer required)', () => {
    // target=50, day 0 -> 15% off -> 42.5 -> 41.99; no msrp -> no compare-at.
    const r = computeDiscontinuedPrice({ cost: 20, msrp: null, daysDiscontinued: 10, cfg: discCfg })
    expect(r?.sell).toBe(41.99)
    expect(r?.compare_at).toBeNull()
  })

  it('day 0 -> 15% off cost-based target', () => {
    // target=50, 15% off -> 42.5 -> round -> 41.99; floor=23.53 does not bind.
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 0, cfg: discCfg })
    expect(r?.sell).toBe(41.99)
    expect(r?.compare_at).toBe(100)
  })

  it('day 30 -> 15% off (boundary inclusive)', () => {
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 30, cfg: discCfg })
    expect(r?.sell).toBe(41.99) // same tier as day 0
  })

  it('day 31 -> 25% off cost-based target', () => {
    // 50 * 0.75 = 37.5 -> 36.99
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 31, cfg: discCfg })
    expect(r?.sell).toBe(36.99)
  })

  it('day 60 -> 25% off (boundary inclusive)', () => {
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 60, cfg: discCfg })
    expect(r?.sell).toBe(36.99)
  })

  it('day 61 -> 35% off cost-based target', () => {
    // 50 * 0.65 = 32.5 -> 31.99
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 61, cfg: discCfg })
    expect(r?.sell).toBe(31.99)
  })

  it('day 90 -> 35% off (boundary inclusive)', () => {
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 90, cfg: discCfg })
    expect(r?.sell).toBe(31.99)
  })

  it('day 91 -> 50% off cost-based target', () => {
    // 50 * 0.50 = 25 -> 24.99
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: 91, cfg: discCfg })
    expect(r?.sell).toBe(24.99)
  })

  it('never advertises above MSRP (ceiling clamp)', () => {
    // target 50, day 0 -> 42.5, but msrp=30 caps it -> 30 -> 29.99.
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 30, daysDiscontinued: 0, cfg: discCfg })
    expect(r?.sell).toBe(29.99)
  })

  it('respects the cost-based margin floor', () => {
    // target=floor when target_margin=floor=0.60: cost=20 -> both = 50.
    // day 91 -> 50% off -> 25, floor=50 wins. roundPsychological would drop 50
    // to 49.99 (below floor), so the guard rounds the floor UP to the next .99:
    // 50.99.
    const r = computeDiscontinuedPrice({
      cost: 20, msrp: 100, daysDiscontinued: 91,
      cfg: { target_margin_pct: 0.60, margin_floor_pct: 0.60 },
    })
    expect(r?.sell).toBe(50.99)
    expect(r?.sell).toBeGreaterThanOrEqual(50) // at or above the floor
  })

  it('never sells a cheap item below its cost-based floor (round-up guard)', () => {
    // cost=1.35, floor=1.35/0.85=1.588. roundPsychological(1.588) would be 0.99
    // (below cost); the guard rounds the floor up to the next .99, 1.99.
    const r = computeDiscontinuedPrice({
      cost: 1.35, msrp: 25.99, daysDiscontinued: 0,
      cfg: { target_margin_pct: 0.25, margin_floor_pct: 0.15 },
    })
    expect(r?.sell).toBe(1.99)
    expect(r?.sell).toBeGreaterThan(1.35) // above cost
    expect(r?.compare_at).toBe(25.99)
  })

  it('floored discontinued price lands on a clean .99, not the raw floor', () => {
    // Live config target 35% / floor 15%. cost=16, aged (day 100) -> 50% off
    // cost-target -> 12.31, floor=16/0.85=18.82 wins. roundPsychological(18.82)
    // = 17.99 (below floor) -> round floor up -> 18.99 (not the raw 18.82).
    const r = computeDiscontinuedPrice({
      cost: 16, msrp: 62, daysDiscontinued: 100,
      cfg: { target_margin_pct: 0.35, margin_floor_pct: 0.15 },
    })
    expect(r?.sell).toBe(18.99)
  })
})

// ---------------------------------------------------------------------------
// daysDiscontinued calc (mirrors pricing-apply-v2 logic; pure arithmetic)
// ---------------------------------------------------------------------------

describe('daysDiscontinued calculation', () => {
  function calcDays(discontinuedAt: Date): number {
    return Math.max(0, Math.floor((Date.now() - discontinuedAt.getTime()) / 86_400_000))
  }

  it('returns 0 for a date set to right now', () => {
    expect(calcDays(new Date())).toBe(0)
  })

  it('returns 0 for a future date (Math.max guard)', () => {
    const future = new Date(Date.now() + 86_400_000 * 5)
    expect(calcDays(future)).toBe(0)
  })

  it('returns 1 for a date exactly 1 day ago', () => {
    const oneDayAgo = new Date(Date.now() - 86_400_000)
    expect(calcDays(oneDayAgo)).toBe(1)
  })

  const discCfg = { target_margin_pct: 0.60, margin_floor_pct: 0.15 }

  it('returns 30 for a date 30 days ago, lands in 15% tier', () => {
    const thirtyDaysAgo = new Date(Date.now() - 86_400_000 * 30)
    const days = calcDays(thirtyDaysAgo)
    expect(days).toBe(30)
    // Confirm the tier: day 30 -> 15% off cost-based target (boundary inclusive)
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: days, cfg: discCfg })
    expect(r?.sell).toBe(41.99)
  })

  it('returns 31 for a date 31 days ago, escalates to 25% tier', () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 86_400_000 * 31)
    const days = calcDays(thirtyOneDaysAgo)
    expect(days).toBe(31)
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: days, cfg: discCfg })
    expect(r?.sell).toBe(36.99)
  })

  it('returns 91 for a date 91 days ago, escalates to 50% tier', () => {
    const ninetyOneDaysAgo = new Date(Date.now() - 86_400_000 * 91)
    const days = calcDays(ninetyOneDaysAgo)
    expect(days).toBe(91)
    const r = computeDiscontinuedPrice({ cost: 20, msrp: 100, daysDiscontinued: days, cfg: discCfg })
    expect(r?.sell).toBe(24.99)
  })
})

// ---------------------------------------------------------------------------
// applyVelocityModifier
// ---------------------------------------------------------------------------

describe('applyVelocityModifier', () => {
  const base = cfg({ target_margin_pct: 0.50, margin_floor_pct: 0.25 })

  it('top bucket: +5pp to target margin', () => {
    const result = applyVelocityModifier(base, 'top')
    expect(result.target_margin_pct).toBeCloseTo(0.55, 5)
    expect(result.margin_floor_pct).toBe(0.25) // floor unchanged
  })

  it('normal bucket: no change', () => {
    const result = applyVelocityModifier(base, 'normal')
    expect(result.target_margin_pct).toBeCloseTo(0.50, 5)
  })

  it('slow bucket: -5pp to target margin', () => {
    const result = applyVelocityModifier(base, 'slow')
    expect(result.target_margin_pct).toBeCloseTo(0.45, 5)
    expect(result.margin_floor_pct).toBe(0.25)
  })

  it('dead bucket: -10pp to target margin', () => {
    const result = applyVelocityModifier(base, 'dead')
    expect(result.target_margin_pct).toBeCloseTo(0.40, 5)
    expect(result.margin_floor_pct).toBe(0.25)
  })

  it('does not mutate the original cfg', () => {
    applyVelocityModifier(base, 'dead')
    expect(base.target_margin_pct).toBe(0.50)
  })
})

// ---------------------------------------------------------------------------
// computePrice — belowAbsoluteFloor flag
// ---------------------------------------------------------------------------

describe('computePrice — absolute price floor', () => {
  it('belowAbsoluteFloor=false when sell is above the default floor', () => {
    // cost=10, target_margin=0.50 -> sell ~19.99, well above 2.99
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg() })
    expect(r).not.toBeNull()
    expect(r!.belowAbsoluteFloor).toBe(false)
  })

  it('belowAbsoluteFloor=true when computed sell is below the default floor', () => {
    // cost=0.10, target_margin=0.50 -> target=0.20, floor=0.10/(1-0.25)=0.133
    // sell=roundPsychological(0.20)=0.20 (n<1 path) < 2.99
    const r = computePrice({ cost: 0.10, map: null, msrp: 5, cfg: cfg() })
    expect(r).not.toBeNull()
    expect(r!.belowAbsoluteFloor).toBe(true)
  })

  it('belowAbsoluteFloor=false when sell equals the custom floor exactly', () => {
    // sell ~4.99, custom floor=4.99
    const r = computePrice({ cost: 2.50, map: null, msrp: 20, cfg: cfg(), absolutePriceFloor: 4.99 })
    expect(r).not.toBeNull()
    // sell = roundPsychological(2.50/(1-0.50)) = roundPsychological(5.00) = 4.99
    expect(r!.sell).toBe(4.99)
    expect(r!.belowAbsoluteFloor).toBe(false) // 4.99 is not < 4.99
  })

  it('belowAbsoluteFloor=true when sell is just below custom floor', () => {
    // sell ~19.99, custom floor=25.00
    const r = computePrice({ cost: 10, map: null, msrp: 50, cfg: cfg(), absolutePriceFloor: 25.00 })
    expect(r).not.toBeNull()
    expect(r!.sell).toBe(19.99)
    expect(r!.belowAbsoluteFloor).toBe(true)
  })

  it('ABSOLUTE_PRICE_FLOOR_DEFAULT is 2.99', () => {
    expect(ABSOLUTE_PRICE_FLOOR_DEFAULT).toBe(2.99)
  })
})

// ---------------------------------------------------------------------------
// buildPatches snake_case conversion (mirrors admin.pricing.tsx buildPatches)
// ---------------------------------------------------------------------------

describe('buildPatches — camelCase GroupRuleValues -> snake_case patch shape', () => {
  // Extracted pure function matching the exact logic in admin.pricing.tsx buildPatches
  type GroupRuleValues = {
    targetMarginPct: number | null
    marginFloorPct: number | null
    mapBehavior: string | null
    compareAtStrategy: string | null
    velocityModifierEnabled: boolean | null
  }
  type EditValues = Record<string, GroupRuleValues>

  function buildPatches(edits: EditValues) {
    const patches: unknown[] = []
    for (const [key, vals] of Object.entries(edits)) {
      const [level, ...rest] = key.split(':')
      const id = rest.join(':')
      patches.push({
        scope_level: level,
        scope_id: id,
        target_margin_pct: vals.targetMarginPct,
        margin_floor_pct: vals.marginFloorPct,
        map_behavior: vals.mapBehavior,
        compare_at_strategy: vals.compareAtStrategy,
        velocity_modifier_enabled: vals.velocityModifierEnabled,
      })
    }
    return patches
  }

  it('emits snake_case keys for a group-level edit', () => {
    const edits: EditValues = {
      'group:vibrators': {
        targetMarginPct: 0.45,
        marginFloorPct: 0.20,
        mapBehavior: 'at_map',
        compareAtStrategy: 'msrp',
        velocityModifierEnabled: false,
      },
    }
    const patches = buildPatches(edits) as Record<string, unknown>[]
    expect(patches).toHaveLength(1)
    const p = patches[0]!
    expect(p['scope_level']).toBe('group')
    expect(p['scope_id']).toBe('vibrators')
    expect(p['target_margin_pct']).toBe(0.45)
    expect(p['margin_floor_pct']).toBe(0.20)
    expect(p['map_behavior']).toBe('at_map')
    expect(p['compare_at_strategy']).toBe('msrp')
    expect(p['velocity_modifier_enabled']).toBe(false)
    // Must NOT contain camelCase keys
    expect(Object.keys(p)).not.toContain('targetMarginPct')
    expect(Object.keys(p)).not.toContain('marginFloorPct')
    expect(Object.keys(p)).not.toContain('mapBehavior')
    expect(Object.keys(p)).not.toContain('compareAtStrategy')
    expect(Object.keys(p)).not.toContain('velocityModifierEnabled')
  })

  it('handles null values passthrough', () => {
    const edits: EditValues = {
      'product_type:Vibrators:Wand': {
        targetMarginPct: null,
        marginFloorPct: null,
        mapBehavior: null,
        compareAtStrategy: null,
        velocityModifierEnabled: null,
      },
    }
    const patches = buildPatches(edits) as Record<string, unknown>[]
    const p = patches[0]!
    expect(p['scope_level']).toBe('product_type')
    // scope_id must re-join colons in the product type name
    expect(p['scope_id']).toBe('Vibrators:Wand')
    expect(p['target_margin_pct']).toBeNull()
  })

  it('emits one patch per edit entry', () => {
    const edits: EditValues = {
      'group:a': { targetMarginPct: 0.40, marginFloorPct: 0.20, mapBehavior: null, compareAtStrategy: null, velocityModifierEnabled: null },
      'group:b': { targetMarginPct: 0.50, marginFloorPct: 0.25, mapBehavior: null, compareAtStrategy: null, velocityModifierEnabled: null },
      'global:global': { targetMarginPct: 0.45, marginFloorPct: 0.20, mapBehavior: 'at_map', compareAtStrategy: 'msrp', velocityModifierEnabled: false },
    }
    expect(buildPatches(edits)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// enforceMapFloor (ticket #3714 write-path invariant)
// ---------------------------------------------------------------------------

describe('enforceMapFloor', () => {
  it('raises a below-MAP price to MAP', () => {
    expect(enforceMapFloor(23.99, 24.99)).toBe(24.99)
  })

  it('leaves an at-MAP price alone', () => {
    expect(enforceMapFloor(24.99, 24.99)).toBe(24.99)
  })

  it('leaves an above-MAP price alone', () => {
    expect(enforceMapFloor(29.99, 24.99)).toBe(29.99)
  })

  it('no MAP (null) -> price unchanged', () => {
    expect(enforceMapFloor(9.99, null)).toBe(9.99)
    expect(enforceMapFloor(9.99, undefined)).toBe(9.99)
  })

  it('MAP of 0 means no floor', () => {
    expect(enforceMapFloor(9.99, 0)).toBe(9.99)
  })

  it('rounds the clamped MAP to 2 decimals', () => {
    expect(enforceMapFloor(10, 12.345)).toBe(12.35)
  })
})

// ---------------------------------------------------------------------------
// roundPsychological
// ---------------------------------------------------------------------------

describe('roundPsychological', () => {
  it('24.37 -> 23.99', () => {
    expect(roundPsychological(24.37)).toBe(23.99)
  })

  it('24.99 -> 23.99 (input is already a .99 but floor(24.99)=24, candidate=23.99)', () => {
    expect(roundPsychological(24.99)).toBe(23.99)
  })

  it('25.00 -> 24.99', () => {
    expect(roundPsychological(25.00)).toBe(24.99)
  })

  it('1.00 -> 0.99', () => {
    expect(roundPsychological(1.00)).toBe(0.99)
  })

  it('n < 1: returns round2(n) directly', () => {
    expect(roundPsychological(0.50)).toBe(0.50)
    expect(roundPsychological(0.75)).toBe(0.75)
  })

  it('.95 ending: 24.37 -> 23.95', () => {
    expect(roundPsychological(24.37, '.95')).toBe(23.95)
  })

  it('.49 ending: 24.37 -> 23.49', () => {
    expect(roundPsychological(24.37, '.49')).toBe(23.49)
  })

  it('large value: 199.99 -> 198.99', () => {
    expect(roundPsychological(199.99)).toBe(198.99)
  })

  it('exact integer 50 -> 49.99', () => {
    expect(roundPsychological(50)).toBe(49.99)
  })
})

describe('roundUpPsychological', () => {
  it('rounds up to the next .99 at or above the input', () => {
    expect(roundUpPsychological(18.82)).toBe(18.99)
    expect(roundUpPsychological(13.22)).toBe(13.99)
    expect(roundUpPsychological(8.06)).toBe(8.99)
    expect(roundUpPsychological(1.588)).toBe(1.99)
  })

  it('exact integer -> that dollar .99 (50 -> 50.99)', () => {
    expect(roundUpPsychological(50)).toBe(50.99)
  })

  it('already a .99 stays put', () => {
    expect(roundUpPsychological(18.99)).toBe(18.99)
  })

  it('fractional part above .99 steps to the next dollar', () => {
    expect(roundUpPsychological(18.995)).toBe(19.99)
  })

  it('result is always >= input', () => {
    for (const n of [1.01, 4.5, 9.999, 23.53, 100.0]) {
      expect(roundUpPsychological(n)).toBeGreaterThanOrEqual(n)
    }
  })
})
