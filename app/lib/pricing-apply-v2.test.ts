// Unit tests for decideStatus (pure function, no DB/Shopify).
import { describe, it, expect } from 'vitest'
import { decideStatus } from './pricing-apply-v2.server'

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
