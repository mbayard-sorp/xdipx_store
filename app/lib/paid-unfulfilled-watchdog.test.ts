// Ticket #13155: nothing watches for a paid order that never ships.
// Fulfillment is otherwise fully automatic, so the only thing that should
// ever flag an order here is one that is genuinely stuck — not a fresh
// order mid-fulfillment, not a cancelled or test order, and not one Shopify
// has already marked fulfilled.
import { describe, expect, it } from 'vitest'
import {
  findStuckPaidOrders,
  isStuckPaidOrder,
  stuckThresholdHours,
  STUCK_THRESHOLD_HOURS,
  STUCK_THRESHOLD_HOURS_WEEKEND,
  type OrderCandidate,
} from './paid-unfulfilled-watchdog'

// A Wednesday, so a window entirely inside one business week never spans a weekend.
const WEDNESDAY_NOON = new Date('2026-10-07T12:00:00Z')

function order(overrides: Partial<OrderCandidate> = {}): OrderCandidate {
  return {
    name: '#1000',
    id: 'gid://shopify/Order/1',
    createdAt: '2026-10-05T00:00:00Z',
    cancelledAt: null,
    test: false,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    ...overrides,
  }
}

describe('stuckThresholdHours', () => {
  it('is the 36h floor when the window stays inside one weekday', () => {
    const createdAt = new Date('2026-10-07T00:00:00Z') // Wednesday
    const now = new Date('2026-10-07T20:00:00Z')
    expect(stuckThresholdHours(createdAt, now)).toBe(STUCK_THRESHOLD_HOURS)
  })

  it('widens to 48h when the window includes a Saturday', () => {
    const createdAt = new Date('2026-10-09T18:00:00Z') // Friday evening
    const now = new Date('2026-10-12T06:00:00Z') // Monday morning
    expect(stuckThresholdHours(createdAt, now)).toBe(STUCK_THRESHOLD_HOURS_WEEKEND)
  })

  it('widens to 48h when the window includes a Sunday but not a Saturday', () => {
    const createdAt = new Date('2026-10-11T23:00:00Z') // Sunday night
    const now = new Date('2026-10-12T05:00:00Z') // Monday
    expect(stuckThresholdHours(createdAt, now)).toBe(STUCK_THRESHOLD_HOURS_WEEKEND)
  })
})

describe('isStuckPaidOrder — age threshold', () => {
  it('is not stuck just under the 36h floor on a weekday order', () => {
    const createdAt = new Date('2026-10-07T00:00:00Z') // Wednesday
    const now = new Date(createdAt.getTime() + 35 * 60 * 60 * 1000)
    expect(isStuckPaidOrder(order({ createdAt: createdAt.toISOString() }), now)).toBe(false)
  })

  it('is stuck right at and past the 36h floor on a weekday order', () => {
    const createdAt = new Date('2026-10-07T00:00:00Z') // Wednesday
    const atFloor = new Date(createdAt.getTime() + 36 * 60 * 60 * 1000)
    const pastFloor = new Date(createdAt.getTime() + 40 * 60 * 60 * 1000)
    expect(isStuckPaidOrder(order({ createdAt: createdAt.toISOString() }), atFloor)).toBe(true)
    expect(isStuckPaidOrder(order({ createdAt: createdAt.toISOString() }), pastFloor)).toBe(true)
  })

  it('is not stuck at 40h when the wait spanned a weekend (needs 48h)', () => {
    const createdAt = new Date('2026-10-09T12:00:00Z') // Friday noon
    const now = new Date(createdAt.getTime() + 40 * 60 * 60 * 1000) // Sunday
    expect(isStuckPaidOrder(order({ createdAt: createdAt.toISOString() }), now)).toBe(false)
  })

  it('is stuck at 48h+ when the wait spanned a weekend', () => {
    const createdAt = new Date('2026-10-09T12:00:00Z') // Friday noon
    const now = new Date(createdAt.getTime() + 49 * 60 * 60 * 1000)
    expect(isStuckPaidOrder(order({ createdAt: createdAt.toISOString() }), now)).toBe(true)
  })
})

describe('isStuckPaidOrder — exclusions', () => {
  const longAgo = new Date(WEDNESDAY_NOON.getTime() + 100 * 60 * 60 * 1000)

  it('excludes a cancelled order regardless of age', () => {
    expect(isStuckPaidOrder(order({ cancelledAt: '2026-10-06T00:00:00Z' }), longAgo)).toBe(false)
  })

  it('excludes a test order regardless of age', () => {
    expect(isStuckPaidOrder(order({ test: true }), longAgo)).toBe(false)
  })

  it('excludes an order that is not actually paid', () => {
    expect(isStuckPaidOrder(order({ displayFinancialStatus: 'PENDING' }), longAgo)).toBe(false)
  })

  it('excludes an order that already fulfilled', () => {
    expect(isStuckPaidOrder(order({ displayFulfillmentStatus: 'FULFILLED' }), longAgo)).toBe(false)
  })

  it('excludes a partially-fulfilled order (not the same failure as never-shipped)', () => {
    expect(isStuckPaidOrder(order({ displayFulfillmentStatus: 'PARTIALLY_FULFILLED' }), longAgo)).toBe(false)
  })
})

describe('findStuckPaidOrders', () => {
  it('filters a mixed page down to only the genuinely stuck orders', () => {
    const longAgo = new Date(WEDNESDAY_NOON.getTime() + 100 * 60 * 60 * 1000)
    const orders: OrderCandidate[] = [
      order({ name: '#1', createdAt: '2026-10-07T00:00:00Z' }), // stuck
      order({ name: '#2', createdAt: '2026-10-07T00:00:00Z', cancelledAt: '2026-10-07T01:00:00Z' }), // cancelled
      order({ name: '#3', createdAt: '2026-10-07T00:00:00Z', test: true }), // test
      order({ name: '#4', createdAt: WEDNESDAY_NOON.toISOString() }), // too fresh relative to longAgo? still old enough
      order({ name: '#5', createdAt: '2026-10-07T00:00:00Z', displayFulfillmentStatus: 'FULFILLED' }), // already shipped
    ]
    const stuck = findStuckPaidOrders(orders, longAgo).map(o => o.name)
    expect(stuck).toEqual(['#1', '#4'])
  })

  it('returns nothing from an empty page', () => {
    expect(findStuckPaidOrders([], new Date())).toEqual([])
  })
})
