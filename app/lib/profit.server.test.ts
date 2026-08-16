// Unit tests for the profit summary's pure layer.
//
// The database here is PRODUCTION and the Shopify client is live, so this file
// touches neither: the db module is stubbed and only the pure date-window,
// COGS-precedence, and aggregation functions are exercised. Those three are
// where every bug in the old implementation lived.
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  accumulateOrders,
  costLineItem,
  costsFromOrderMetafields,
  nextUtcDate,
  ordersSearchQuery,
  yesterdayUtc,
} from '~/lib/profit.server'

describe('reporting window', () => {
  it('defaults to the day that just ended, not the one that just started', () => {
    // The old code called this "today" while running at 00:05 UTC, so the
    // window it summarized was five minutes long.
    expect(yesterdayUtc(Date.parse('2026-07-30T00:05:00Z'))).toBe('2026-07-29')
    expect(yesterdayUtc(Date.parse('2026-07-30T23:59:00Z'))).toBe('2026-07-29')
  })

  it('rolls month and year boundaries', () => {
    expect(yesterdayUtc(Date.parse('2026-08-01T00:05:00Z'))).toBe('2026-07-31')
    expect(yesterdayUtc(Date.parse('2027-01-01T00:05:00Z'))).toBe('2026-12-31')
    expect(nextUtcDate('2026-02-28')).toBe('2026-03-01')
    expect(nextUtcDate('2026-12-31')).toBe('2027-01-01')
  })

  it('builds a half-open one-day query that filters paid on the right field', () => {
    const q = ordersSearchQuery('2026-07-23')
    // financial_status carries "paid"; the old query put it on `status`, which
    // only accepts open/closed/any, so Shopify silently dropped paid orders.
    expect(q).toContain('financial_status:paid')
    expect(q).toContain('status:any')
    expect(q).toContain(`created_at:>='2026-07-23T00:00:00Z'`)
    expect(q).toContain(`created_at:<'2026-07-24T00:00:00Z'`)
    // The original bug, precisely: `paid` sitting on the bare `status` field.
    expect(q).not.toMatch(/(^|\s)status:paid/)
  })
})

describe('costsFromOrderMetafields', () => {
  it('reads the per-SKU wholesale cost the order webhook recorded at sale time', () => {
    const costs = costsFromOrderMetafields([
      { key: 'profit_ABC-1', value: JSON.stringify({ sku: 'ABC-1', wholesale_cost: 4.25 }) },
      { key: 'profit_XYZ-9', value: JSON.stringify({ sku: 'XYZ-9', wholesale_cost: 11 }) },
      { key: 'unrelated', value: 'ignored' },
    ])
    expect(costs.get('ABC-1')).toBe(4.25)
    expect(costs.get('XYZ-9')).toBe(11)
    expect(costs.has('unrelated')).toBe(false)
  })

  it('treats malformed, zero, negative, and unknown (null) costs as absent rather than free', () => {
    const costs = costsFromOrderMetafields([
      { key: 'profit_BAD', value: 'not json' },
      { key: 'profit_ZERO', value: JSON.stringify({ wholesale_cost: 0 }) },
      { key: 'profit_NEG', value: JSON.stringify({ wholesale_cost: -3 }) },
      { key: 'profit_STR', value: JSON.stringify({ wholesale_cost: 'free' }) },
      // The order webhook now records an unresolved cost as null (UNKNOWN)
      // instead of a fabricated 0. It must be excluded, same as a zero.
      { key: 'profit_UNKNOWN', value: JSON.stringify({ wholesale_cost: null }) },
    ])
    expect(costs.size).toBe(0)
  })
})

describe('costLineItem precedence', () => {
  const withUnitCost = (amount: string) => ({ inventoryItem: { unitCost: { amount } } })

  it('prefers the order metafield over the current inventory cost', () => {
    // Point-in-time truth wins: a later cost change must not rewrite history.
    const line = { sku: 'ABC-1', quantity: 2, variant: withUnitCost('9.99') }
    expect(costLineItem(line, new Map([['ABC-1', 4]]))).toEqual({
      cost: 8,
      source: 'order-metafield',
    })
  })

  it('falls back to the inventory-item unit cost the pricing engine maintains', () => {
    const line = { sku: 'ABC-1', quantity: 3, variant: withUnitCost('5.00') }
    expect(costLineItem(line, new Map())).toEqual({ cost: 15, source: 'inventory-item' })
  })

  it('reports an unresolvable cost as unknown instead of zero', () => {
    // This is the whole point: a zero would silently inflate margin, which is
    // the same class of quiet lie that let the table report $0 on real orders.
    expect(costLineItem({ sku: 'ABC-1', quantity: 4, variant: null }, new Map()))
      .toEqual({ cost: null, source: 'none' })
    expect(costLineItem({ sku: null, quantity: 1, variant: withUnitCost('0') }, new Map()))
      .toEqual({ cost: null, source: 'none' })
    expect(costLineItem({ sku: 'X', quantity: 1, variant: { inventoryItem: null } }, new Map()))
      .toEqual({ cost: null, source: 'none' })
  })
})

describe('accumulateOrders', () => {
  const EMPTY = {
    totalOrders: 0, totalRevenue: 0, totalCogs: 0,
    totalProfit: 0, avgOrderValue: 0, cogsMissingUnits: 0,
  }

  function order(over: Record<string, unknown> = {}) {
    return {
      id: 'gid://shopify/Order/1', name: '#1002', createdAt: '2026-07-23T21:10:00Z',
      totalPriceSet: { shopMoney: { amount: '29.18' } },
      metafields: { nodes: [{ key: 'profit_SKU-1', value: JSON.stringify({ wholesale_cost: 10 }) }] },
      lineItems: { nodes: [{ sku: 'SKU-1', quantity: 1, variant: null }] },
      ...over,
    }
  }

  it('totals a real order the way the store actually sold it', () => {
    // The shape of order #1002, which the old code recorded as zero.
    const t = accumulateOrders([order()], EMPTY)
    expect(t.totalOrders).toBe(1)
    expect(t.totalRevenue).toBeCloseTo(29.18)
    expect(t.totalCogs).toBeCloseTo(10)
    expect(t.totalProfit).toBeCloseTo(19.18)
    expect(t.avgOrderValue).toBeCloseTo(29.18)
    expect(t.cogsMissingUnits).toBe(0)
  })

  it('counts unpriceable units separately and leaves them out of COGS', () => {
    const t = accumulateOrders([order({
      metafields: { nodes: [] },
      lineItems: { nodes: [
        { sku: 'SKU-1', quantity: 2, variant: { inventoryItem: { unitCost: { amount: '3' } } } },
        { sku: 'SKU-2', quantity: 5, variant: null },
      ] },
    })], EMPTY)
    expect(t.totalCogs).toBeCloseTo(6)
    expect(t.cogsMissingUnits).toBe(5)
    // Profit is revenue minus only what we could actually cost.
    expect(t.totalProfit).toBeCloseTo(29.18 - 6)
  })

  it('accumulates across pages rather than overwriting', () => {
    const first = accumulateOrders([order()], EMPTY)
    const second = accumulateOrders([order({ id: 'gid://shopify/Order/2' })], first)
    expect(second.totalOrders).toBe(2)
    expect(second.totalRevenue).toBeCloseTo(58.36)
    expect(second.avgOrderValue).toBeCloseTo(29.18)
  })

  it('survives an order with missing price and line-item structures', () => {
    const t = accumulateOrders([
      { id: 'x', name: '#x', createdAt: '', totalPriceSet: null,
        metafields: { nodes: [] }, lineItems: { nodes: [] } },
    ] as unknown as Parameters<typeof accumulateOrders>[0], EMPTY)
    expect(t.totalOrders).toBe(1)
    expect(t.totalRevenue).toBe(0)
    expect(t.totalProfit).toBe(0)
  })

  it('reports zero orders as zero, not as an absent row', () => {
    // A genuinely zero day and a broken query used to be indistinguishable.
    const t = accumulateOrders([], EMPTY)
    expect(t).toEqual(EMPTY)
  })
})
