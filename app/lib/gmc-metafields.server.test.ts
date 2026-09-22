import { describe, expect, it } from 'vitest'
import { mapAllowsAdvertisedDiscount, gmcGender } from './gmc-metafields.server'

// Ticket #10731 (ADR-015 follow-up): gmcGender used to read a for-him/for-her
// axis out of audience_tags, but the live enrichment vocabulary for that
// field is solo/couples/gift and never writes for-him/for-her — verified
// live 2026-09-22 against the full active catalog (5,282 products): 0 male,
// 0 female, 5,282 unisex. It now derives from xdipx.cast_target instead.
describe('gmcGender', () => {
  it('maps cast_target=male to male', () => {
    expect(gmcGender('male')).toBe('male')
  })

  it('maps cast_target=female to female', () => {
    expect(gmcGender('female')).toBe('female')
  })

  it('maps cast_target=universal to unisex', () => {
    expect(gmcGender('universal')).toBe('unisex')
  })

  it('falls back to unisex when cast_target is null, undefined, or an unrecognized value', () => {
    expect(gmcGender(null)).toBe('unisex')
    expect(gmcGender(undefined)).toBe('unisex')
    expect(gmcGender('not-a-real-value')).toBe('unisex')
  })
})

describe('mapAllowsAdvertisedDiscount', () => {
  it('allows a discount when there is no MAP (0 or absent)', () => {
    expect(mapAllowsAdvertisedDiscount(0, false, 49.99)).toBe(true)
    expect(mapAllowsAdvertisedDiscount(null, false, 49.99)).toBe(true)
    expect(mapAllowsAdvertisedDiscount(undefined, false, 49.99)).toBe(true)
  })

  it('allows a discount when MAP sits below the regular price', () => {
    expect(mapAllowsAdvertisedDiscount(29.99, false, 49.99)).toBe(true)
  })

  it('blocks a discount when MAP equals the regular price (MAP = MSRP)', () => {
    expect(mapAllowsAdvertisedDiscount(49.99, false, 49.99)).toBe(false)
  })

  it('blocks a discount when MAP exceeds the regular price', () => {
    expect(mapAllowsAdvertisedDiscount(59.99, false, 49.99)).toBe(false)
  })

  it('treats sub-cent float drift as equal (no discount)', () => {
    expect(mapAllowsAdvertisedDiscount(49.989999, false, 49.99)).toBe(false)
  })

  it('blocks a discount whenever map_restricted is set, regardless of MAP', () => {
    expect(mapAllowsAdvertisedDiscount(0, true, 49.99)).toBe(false)
    expect(mapAllowsAdvertisedDiscount(29.99, true, 49.99)).toBe(false)
  })
})

