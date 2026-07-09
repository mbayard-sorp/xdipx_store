import { describe, expect, it } from 'vitest'
import { mapAllowsAdvertisedDiscount, salePriceEffectiveDate } from './gmc-metafields.server'

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

describe('salePriceEffectiveDate', () => {
  const duringWindow = new Date('2026-05-16T12:00:00-07:00')

  it('formats the two-day PT window when now falls inside it', () => {
    expect(salePriceEffectiveDate('2026-05-16', duringWindow)).toBe(
      '2026-05-16T00:00-07:00/2026-05-17T23:59-07:00',
    )
    // Second day of the window still counts
    expect(salePriceEffectiveDate('2026-05-16', new Date('2026-05-17T23:00:00-07:00'))).toBe(
      '2026-05-16T00:00-07:00/2026-05-17T23:59-07:00',
    )
  })

  it('accepts full ISO strings by slicing the date part', () => {
    expect(salePriceEffectiveDate('2026-05-16T00:00:00Z', duringWindow)).toBe(
      '2026-05-16T00:00-07:00/2026-05-17T23:59-07:00',
    )
  })

  it('returns null for a future scheduling slot (the 2027-02-02 feed bug)', () => {
    expect(salePriceEffectiveDate('2027-02-02', new Date('2026-07-09T12:00:00-07:00'))).toBeNull()
  })

  it('returns null once the window has passed', () => {
    expect(salePriceEffectiveDate('2026-05-16', new Date('2026-05-18T00:30:00-07:00'))).toBeNull()
  })

  it('rolls the window end across month boundaries', () => {
    expect(salePriceEffectiveDate('2026-01-31', new Date('2026-02-01T12:00:00-07:00'))).toBe(
      '2026-01-31T00:00-07:00/2026-02-01T23:59-07:00',
    )
  })

  it('returns null for empty or malformed input', () => {
    expect(salePriceEffectiveDate('', duringWindow)).toBeNull()
    expect(salePriceEffectiveDate('not-a-date', duringWindow)).toBeNull()
    expect(salePriceEffectiveDate('05/16/2026', duringWindow)).toBeNull()
  })
})
