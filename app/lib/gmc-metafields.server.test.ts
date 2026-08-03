import { describe, expect, it } from 'vitest'
import { mapAllowsAdvertisedDiscount } from './gmc-metafields.server'

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

