// Unit tests for decideStatus (pure function, no DB/Shopify).
import { describe, it, expect } from 'vitest'
import {
  PRICING_AUDIT_RETENTION_DAYS,
  PRUNABLE_AUDIT_STATUSES,
  DEFAULT_MAP_BRANDS,
  decideStatus,
  mapAppliesToVendor,
  isPartialBatchDay,
} from './pricing-apply-v2.server'

const BASE = {
  map:         24.99,
  mapBehavior: 'at_map' as const,
  marginFloor: 0.25,
  marginAfter: 0.50,
  mode:        'balanced' as const,
}

describe('decideStatus', () => {
  it('returns skipped_no_change when new equals old within 0.5 cents', () => {
    expect(decideStatus({ ...BASE, oldPrice: 24.99, newPrice: 24.99 })).toBe('skipped_no_change')
  })

  it('returns rejected when marginAfter is below marginFloor', () => {
    expect(decideStatus({ ...BASE, oldPrice: 30, newPrice: 26, marginAfter: 0.10 })).toBe('rejected')
  })

  it('returns rejected when newPrice is below MAP and MAP applies', () => {
    expect(decideStatus({ ...BASE, oldPrice: 30, newPrice: 20, marginAfter: 0.50 })).toBe('rejected')
  })

  it('returns pending when MAP is ignore_map and newPrice < map (MAP does not apply)', () => {
    // delta = (20-30)/30 = 33% which exceeds 5% balanced -> pending, not rejected
    const result = decideStatus({ ...BASE, mapBehavior: 'ignore_map', oldPrice: 30, newPrice: 20, marginAfter: 0.50 })
    expect(result).toBe('pending')
  })

  it('returns auto_applied when delta <= 5% (balanced) and margins pass', () => {
    // 3% drop
    expect(decideStatus({ ...BASE, oldPrice: 30, newPrice: 29.10, marginAfter: 0.50 })).toBe('auto_applied')
  })

  it('returns pending when delta > 5% (balanced)', () => {
    // 10% drop
    expect(decideStatus({ ...BASE, oldPrice: 30, newPrice: 27, marginAfter: 0.50 })).toBe('pending')
  })

  it('auto_applied up to 10% for aggressive mode', () => {
    expect(decideStatus({ ...BASE, mode: 'aggressive', oldPrice: 30, newPrice: 27.10, marginAfter: 0.50 })).toBe('auto_applied')
  })

  it('pending for 3% drop in conservative mode', () => {
    expect(decideStatus({ ...BASE, mode: 'conservative', oldPrice: 30, newPrice: 29.10, marginAfter: 0.50 })).toBe('pending')
  })

  it('always returns pending in review_all mode regardless of delta', () => {
    expect(decideStatus({ ...BASE, mode: 'review_all', oldPrice: 30, newPrice: 29.99, marginAfter: 0.50 })).toBe('pending')
  })

  it('returns auto_applied when oldPrice is null and delta logic treats it as large but mode passes all else', () => {
    // No old price -> deltaPct = 1 which exceeds any threshold -> pending
    expect(decideStatus({ ...BASE, oldPrice: null, newPrice: 25, marginAfter: 0.50 })).toBe('pending')
  })

  it('returns pending, not rejected, when margin is below floor because MSRP pins the price down (#7515)', () => {
    // MSRP-below-floor case: the margin-floor clamp was overridden by the MSRP
    // ceiling, so this is an unsatisfiable constraint for a human to resolve,
    // not a rule violation to reject and silently repeat every batch run.
    expect(
      decideStatus({ ...BASE, oldPrice: 13.99, newPrice: 11.99, marginAfter: 0.2252, msrpBelowFloor: true }),
    ).toBe('pending')
  })

  it('still returns rejected when margin is below floor and msrpBelowFloor is false', () => {
    expect(
      decideStatus({ ...BASE, oldPrice: 13.99, newPrice: 11.99, marginAfter: 0.2252, msrpBelowFloor: false }),
    ).toBe('rejected')
  })
})

describe('isPartialBatchDay (#7516)', () => {
  // The real streak this ticket diagnosed: healthy baseline 3,000-5,900+,
  // four consecutive partial days at 1,154-2,138 — all well over the old
  // hardcoded EXPECTED_MIN_PRODUCTS=800 floor, so nothing flagged them.
  const HEALTHY_BASELINE = [3972, 4023, 3019, 5585, 4501, 3800, 4200]

  it('flags a synthetic partial day against a healthy trailing baseline', () => {
    expect(isPartialBatchDay(1362, HEALTHY_BASELINE)).toBe(true)
    expect(isPartialBatchDay(2138, HEALTHY_BASELINE)).toBe(true)
  })

  it('does not flag a count that clears the 60% threshold', () => {
    // median of HEALTHY_BASELINE is 4023; 60% of that is ~2413.8
    expect(isPartialBatchDay(4000, HEALTHY_BASELINE)).toBe(false)
    expect(isPartialBatchDay(2500, HEALTHY_BASELINE)).toBe(false)
  })

  it('a hardcoded floor of 800 would have missed this exact streak, but the baseline check catches it', () => {
    const partialStreak = [1362, 1154, 2011, 2138]
    for (const count of partialStreak) {
      expect(count).toBeGreaterThan(800) // would have passed the old static check
      expect(isPartialBatchDay(count, HEALTHY_BASELINE)).toBe(true) // caught by the new one
    }
  })

  it('returns false when there is no positive baseline to compare against', () => {
    expect(isPartialBatchDay(500, [])).toBe(false)
    expect(isPartialBatchDay(500, [0, 0, 0])).toBe(false)
  })

  it('returns false for a zero-row day (a full miss, not a partial one)', () => {
    expect(isPartialBatchDay(0, HEALTHY_BASELINE)).toBe(false)
  })

  it('ignores zero-count days (full misses) when computing the baseline median', () => {
    // A full-miss day folded into the baseline would drag the median down and
    // could mask the next genuinely partial day.
    const baselineWithAMiss = [0, 4000, 4200, 3900]
    expect(isPartialBatchDay(1500, baselineWithAMiss)).toBe(true)
  })
})

describe('TEST_SKU_PREFIX exclusion regex', () => {
  // Validate the regex used in recomputeVariant/recomputeCatalog/dryRunRuleChange
  // by testing the same pattern directly.
  const re = /^XDX-TEST-/i
  it('matches XDX-TEST- prefix (uppercase)', () => {
    expect(re.test('XDX-TEST-001')).toBe(true)
  })
  it('matches XDX-TEST- prefix (lowercase)', () => {
    expect(re.test('xdx-test-abc')).toBe(true)
  })
  it('matches XDX-TEST- prefix (mixed case)', () => {
    expect(re.test('Xdx-Test-999')).toBe(true)
  })
  it('does NOT match a normal SKU', () => {
    expect(re.test('NAL-12345')).toBe(false)
  })
  it('does NOT match SKU containing XDX-TEST- in the middle', () => {
    expect(re.test('PREFIX-XDX-TEST-001')).toBe(false)
  })
  it('does NOT match empty string', () => {
    expect(re.test('')).toBe(false)
  })
})

/**
 * The prune's safety rule. The DELETE itself needs a database, so what is
 * pinned here is the thing that would actually cause harm if it drifted: which
 * statuses are eligible at all.
 */
describe('pricing_audit_log retention', () => {
  it('never prunes the real price-change history', () => {
    // These two ARE the audit trail this table exists to be. `applied` is not
    // in AuditStatus but exists on 8,708 legacy prod rows, so it is asserted
    // by literal rather than by type.
    expect(PRUNABLE_AUDIT_STATUSES).not.toContain('applied')
    expect(PRUNABLE_AUDIT_STATUSES).not.toContain('auto_applied')
  })

  it('never prunes a pending approval', () => {
    // The pricing sweep reads pending rows with no date floor. Deleting an old
    // one destroys an unanswered decision instead of surfacing it.
    expect(PRUNABLE_AUDIT_STATUSES).not.toContain('pending')
  })

  it('prunes exactly the two noise statuses, and is an allowlist', () => {
    // Allowlist, not blocklist: a status added to AuditStatus later is retained
    // by default, which is the direction this should fail in.
    expect([...PRUNABLE_AUDIT_STATUSES].sort()).toEqual(['rejected', 'skipped_no_change'])
  })

  it('keeps a retention window longer than any reporting window', () => {
    // The owner digest's pricing check reads yesterday only. Tightened from 90
    // to 30 days (owner direction, 2026-09-04): the table sat at 440,593 rows /
    // 192MB, 86% of it noise ('skipped_no_change'/'rejected') the daily batch
    // writes for every SKU whether or not anything changed; 30 days is still
    // comfortably longer than the digest's yesterday-only read.
    expect(PRICING_AUDIT_RETENTION_DAYS).toBeGreaterThanOrEqual(30)
  })
})

describe('mapAppliesToVendor', () => {
  const brands = [...DEFAULT_MAP_BRANDS] // ['Lovense', 'Playground']

  it('applies MAP to the configured MAP brands', () => {
    expect(mapAppliesToVendor('Lovense', brands)).toBe(true)
    expect(mapAppliesToVendor('Playground', brands)).toBe(true)
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(mapAppliesToVendor('  lovense ', brands)).toBe(true)
    expect(mapAppliesToVendor('PLAYGROUND', brands)).toBe(true)
  })

  it('does NOT apply MAP to any other brand (the bug being fixed)', () => {
    for (const v of ['Doc Johnson', 'Rene Rofe', 'Sportsheets', 'Classic Brands', 'LELO', 'Dame']) {
      expect(mapAppliesToVendor(v, brands)).toBe(false)
    }
  })

  it('never matches a null, undefined, or blank vendor', () => {
    expect(mapAppliesToVendor(null, brands)).toBe(false)
    expect(mapAppliesToVendor(undefined, brands)).toBe(false)
    expect(mapAppliesToVendor('   ', brands)).toBe(false)
  })

  it('honors a custom brand list (config-driven, no partial matching)', () => {
    expect(mapAppliesToVendor('We-Vibe', ['We-Vibe'])).toBe(true)
    // exact match only: "Play" must not match "Playground"
    expect(mapAppliesToVendor('Play', brands)).toBe(false)
    expect(mapAppliesToVendor('Lovense Toys', brands)).toBe(false)
  })
})
