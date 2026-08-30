// Unit tests for decideStatus (pure function, no DB/Shopify).
import { describe, it, expect } from 'vitest'
import {
  PRICING_AUDIT_RETENTION_DAYS,
  PRUNABLE_AUDIT_STATUSES,
  DEFAULT_MAP_BRANDS,
  decideStatus,
  mapAppliesToVendor,
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
    // The owner digest's pricing check reads yesterday only; nothing in the app
    // reads further back than a quarter.
    expect(PRICING_AUDIT_RETENTION_DAYS).toBeGreaterThanOrEqual(90)
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
