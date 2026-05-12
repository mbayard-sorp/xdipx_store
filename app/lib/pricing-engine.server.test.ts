import { describe, expect, it } from 'vitest'
import {
  computeTargetPrice,
  FLOOR_MULTIPLIER,
  type PricingSnapshot,
} from './pricing-engine.server'

function base(overrides: Partial<PricingSnapshot> = {}): PricingSnapshot {
  return {
    sku: 'TEST-001',
    vendor: null,
    msrp: 100,
    wholesale: 40,
    mapPrice: null,
    currentPrice: 100,
    currentCompareAt: null,
    inSaleFeed: false,
    nalpacDiscountPct: null,
    ...overrides,
  }
}

describe('refuse-missing-data', () => {
  it('refuses when wholesale is 0', () => {
    const r = computeTargetPrice(base({ wholesale: 0 }))
    expect(r.tier).toBe('refuse-missing-data')
    expect(r.flags).toContain('no-wholesale')
    expect(r.newPrice).toBe(100)
    expect(r.delta).toBe(0)
  })

  it('refuses when msrp is 0', () => {
    const r = computeTargetPrice(base({ msrp: 0 }))
    expect(r.tier).toBe('refuse-missing-data')
    expect(r.flags).toContain('no-msrp')
    expect(r.newPrice).toBe(100)
  })

  it('refuses when both are 0, flags both', () => {
    const r = computeTargetPrice(base({ msrp: 0, wholesale: 0 }))
    expect(r.flags).toContain('no-msrp')
    expect(r.flags).toContain('no-wholesale')
  })
})

describe('MAP-locked vendors', () => {
  it('Lovense at MAP $99, wholesale $50 -> newPrice $99, mapRespected true', () => {
    const r = computeTargetPrice(base({ vendor: 'Lovense', mapPrice: 99, wholesale: 50, currentPrice: 120 }))
    expect(r.tier).toBe('map-locked')
    expect(r.newPrice).toBe(99)
    expect(r.mapRespected).toBe(true)
  })

  it('Lovense with no MAP price -> refuse, flag no-map-on-restricted, no change', () => {
    const r = computeTargetPrice(base({ vendor: 'Lovense', mapPrice: null, currentPrice: 89 }))
    expect(r.tier).toBe('refuse-missing-data')
    expect(r.flags).toContain('no-map-on-restricted')
    expect(r.newPrice).toBe(89)
    expect(r.delta).toBe(0)
  })

  it('Playground with MAP below floor (MAP $50, wholesale $50) -> newPrice = floor $62.50, mapRespected false', () => {
    const r = computeTargetPrice(base({ vendor: 'Playground', mapPrice: 50, wholesale: 50, currentPrice: 80 }))
    expect(r.tier).toBe('map-locked')
    expect(r.newPrice).toBe(50 * FLOOR_MULTIPLIER) // 62.50
    expect(r.mapRespected).toBe(false)
  })

  it('case-insensitive: lovense detected', () => {
    const r = computeTargetPrice(base({ vendor: 'lovense', mapPrice: 99, wholesale: 50, currentPrice: 120 }))
    expect(r.tier).toBe('map-locked')
  })

  it('case-insensitive: LOVENSE detected', () => {
    const r = computeTargetPrice(base({ vendor: 'LOVENSE', mapPrice: 99, wholesale: 50, currentPrice: 120 }))
    expect(r.tier).toBe('map-locked')
  })

  it('case-insensitive: " Lovense " (with spaces) detected', () => {
    const r = computeTargetPrice(base({ vendor: ' Lovense ', mapPrice: 99, wholesale: 50, currentPrice: 120 }))
    expect(r.tier).toBe('map-locked')
  })
})

describe('sale-flow-through', () => {
  it('msrp $100, wholesale $30, 30% off in feed -> target $65, newPrice $65', () => {
    // target = 100 * (1 - 0.30 - 0.05) = 100 * 0.65 = $65
    // floor = 30 * 1.25 = $37.50
    // $65 > $37.50, so newPrice = $65
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 30, inSaleFeed: true, nalpacDiscountPct: 0.30, currentPrice: 100 }))
    expect(r.tier).toBe('sale-flow-through')
    expect(r.newPrice).toBe(65)
    expect(r.flags).not.toContain('below-floor')
  })

  it('sale feed floors when target is below wholesale * 1.25', () => {
    // wholesale $60, floor = $75, msrp $100, 30% off -> target = $65, below floor
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 60, inSaleFeed: true, nalpacDiscountPct: 0.30, currentPrice: 100 }))
    expect(r.tier).toBe('sale-flow-through')
    expect(r.newPrice).toBe(75)
    expect(r.flags).toContain('below-floor')
  })
})

describe('high-margin', () => {
  it('msrp $100, wholesale $40 (2.5x) -> 35% off = $65', () => {
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 40, currentPrice: 100 }))
    expect(r.tier).toBe('high-margin')
    expect(r.newPrice).toBe(65)
  })

  it('floor clamp: msrp $100, wholesale $70 (ratio 1.43x) -> below high-margin threshold', () => {
    // 100 >= 2*70 is false, 100 >= 1.5*70=105 is false -> thin margin
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 70, currentPrice: 100 }))
    expect(r.tier).toBe('thin-margin')
    expect(r.newPrice).toBe(70 * FLOOR_MULTIPLIER) // 87.50
  })

  it('high-margin where 35% off undershoots floor: msrp $100, wholesale $70 is thin not high - use $60 wholesale (ratio 1.67x, medium)', () => {
    // msrp $100, wholesale $60 -> ratio 1.67x, medium margin
    // target = 100 * 0.80 = $80, floor = $75
    // $80 > $75, newPrice = $80
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 60, currentPrice: 100 }))
    expect(r.tier).toBe('medium-margin')
    expect(r.newPrice).toBe(80)
    expect(r.flags).not.toContain('below-floor')
  })
})

describe('medium-margin', () => {
  it('msrp $100, wholesale $60 (1.67x) -> 20% off = $80', () => {
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 60, currentPrice: 100 }))
    expect(r.tier).toBe('medium-margin')
    expect(r.newPrice).toBe(80)
  })
})

describe('thin-margin', () => {
  it('msrp $100, wholesale $80 (1.25x) -> newPrice = floor $100, flag thin-margin', () => {
    // floor = 80 * 1.25 = 100
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 80, currentPrice: 120 }))
    expect(r.tier).toBe('thin-margin')
    expect(r.newPrice).toBe(100)
    expect(r.flags).toContain('thin-margin')
  })
})

describe('no-change-needed', () => {
  it('target equals current within $0.01 -> no-change-needed', () => {
    // high-margin: msrp $100, wholesale $40, target $65, currentPrice $65
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 40, currentPrice: 65 }))
    expect(r.tier).toBe('no-change-needed')
    expect(r.reason).toBe('Already at target.')
    expect(r.delta).toBe(0)
  })

  it('within $0.005 is still no-change-needed', () => {
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 40, currentPrice: 65.005 }))
    expect(r.tier).toBe('no-change-needed')
  })
})

describe('increase-absorbed', () => {
  it('target is higher than current AND current margin >= 20% -> absorb, no change, flag increase-absorbed', () => {
    // medium-margin: msrp $100, wholesale $50, ratio 2x -> high-margin actually
    // Use: msrp $100, wholesale $60 -> medium, target $80
    // currentPrice $75, current margin = (75-60)/75 = 20% = exactly at floor
    // should NOT absorb since >= floor
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 60, currentPrice: 75 }))
    expect(r.tier).toBe('no-change-needed')
    expect(r.flags).toContain('increase-absorbed')
    expect(r.newPrice).toBe(75)
    expect(r.delta).toBe(0)
  })

  it('target raise but current margin < 20% -> price goes up (no absorb)', () => {
    // msrp $100, wholesale $60, target $80, currentPrice $70
    // current margin = (70-60)/70 = 14.3% < 20% -> do NOT absorb
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 60, currentPrice: 70 }))
    expect(r.tier).toBe('medium-margin')
    expect(r.newPrice).toBe(80)
    expect(r.flags).not.toContain('increase-absorbed')
  })
})

describe('marginPct and delta', () => {
  it('computes margin correctly', () => {
    // high-margin: newPrice $65, wholesale $40 -> (65-40)/65 = 38.46%
    const r = computeTargetPrice(base({ msrp: 100, wholesale: 40, currentPrice: 100 }))
    expect(r.marginPct).toBeCloseTo((65 - 40) / 65, 4)
    expect(r.delta).toBe(-35)
    expect(r.deltaPct).toBeCloseTo(-0.35, 4)
  })

  it('newCompareAt is always MSRP', () => {
    const r = computeTargetPrice(base({ msrp: 149.99, wholesale: 40, currentPrice: 100 }))
    expect(r.newCompareAt).toBe(149.99)
  })
})

describe('mapRespected flag on Playground floor override', () => {
  it('mapRespected is false when floor overrides MAP', () => {
    // MAP $50, wholesale $50, floor $62.50 -> floor > MAP, mapRespected false
    const r = computeTargetPrice(base({ vendor: 'Playground', mapPrice: 50, wholesale: 50, currentPrice: 80 }))
    expect(r.mapRespected).toBe(false)
    expect(r.newPrice).toBe(62.50)
  })

  it('mapRespected is true when MAP >= floor', () => {
    const r = computeTargetPrice(base({ vendor: 'Playground', mapPrice: 80, wholesale: 50, currentPrice: 90 }))
    expect(r.mapRespected).toBe(true)
    expect(r.newPrice).toBe(80)
  })
})
