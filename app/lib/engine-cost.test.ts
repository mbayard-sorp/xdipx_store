// Cost precedence for the v2 pricing engine (pricing audit 2026-10-15).
//
// The examples are the real SKUs from the audit: 95230 and 90001 hold a
// Nalpac sale cost (0.70 of list) that the Nalpac app never raised back when
// the promo ended; 92689 is still tagged "40% Off Sale" in the feed, so its
// 0.60-of-list unit cost is the account's real cost and must be kept.
import { describe, it, expect } from 'vitest'
import {
  resolveEngineCost,
  engineCostNote,
  nalpacSaleTagPct,
  FEED_COST_MAX_AGE_MS,
  type FeedCostSnapshot,
} from './engine-cost'

const NOW = new Date('2026-10-15T07:00:00Z')
const OBSERVED = new Date('2026-10-14T08:00:39Z')

function feed(wholesale: number | null, inSale = false, observedAt = OBSERVED): FeedCostSnapshot {
  return { wholesale, inSale, observedAt }
}

describe('resolveEngineCost', () => {
  it('replaces a lapsed sale unit cost with the feed list wholesale (SKU 95230)', () => {
    const c = resolveEngineCost({ unitCost: 35.04, metafieldCost: 50.05, feed: feed(50.05), now: NOW })
    expect(c).toEqual({ cost: 50.05, source: 'feed', replacedUnitCost: 35.04 })
  })

  it('replaces it for the 0.50 and 0.60 clusters too (SKU 90001 at 0.70)', () => {
    expect(resolveEngineCost({ unitCost: 7.18, metafieldCost: null, feed: feed(10.26), now: NOW }).cost).toBe(10.26)
    expect(resolveEngineCost({ unitCost: 5.13, metafieldCost: null, feed: feed(10.26), now: NOW }).cost).toBe(10.26)
  })

  it('keeps the unit cost while the SKU is in the sale feed (SKU 92689, 40% Off Sale)', () => {
    const c = resolveEngineCost({ unitCost: 16.68, metafieldCost: 27.8, feed: feed(27.8, true), now: NOW })
    expect(c).toEqual({ cost: 16.68, source: 'unit_cost', replacedUnitCost: null })
  })

  it('keeps a unit cost within 2% of the feed (rounding, cent drift)', () => {
    expect(resolveEngineCost({ unitCost: 9.9, metafieldCost: null, feed: feed(10), now: NOW }).source).toBe('unit_cost')
    expect(resolveEngineCost({ unitCost: 9.79, metafieldCost: null, feed: feed(10), now: NOW }).source).toBe('feed')
  })

  it('never lowers a unit cost that sits above the feed', () => {
    const c = resolveEngineCost({ unitCost: 12, metafieldCost: null, feed: feed(10), now: NOW })
    expect(c).toEqual({ cost: 12, source: 'unit_cost', replacedUnitCost: null })
  })

  it('ignores a stale snapshot: an old feed cannot say a promo has ended', () => {
    const old = new Date(NOW.getTime() - FEED_COST_MAX_AGE_MS - 1)
    const c = resolveEngineCost({ unitCost: 35.04, metafieldCost: null, feed: feed(50.05, false, old), now: NOW })
    expect(c.source).toBe('unit_cost')
    expect(c.cost).toBe(35.04)
  })

  it('falls back to unit cost, then metafield, when there is no usable feed row', () => {
    expect(resolveEngineCost({ unitCost: 7, metafieldCost: 9, feed: null, now: NOW })).toMatchObject({ cost: 7, source: 'unit_cost' })
    expect(resolveEngineCost({ unitCost: null, metafieldCost: 9, feed: null, now: NOW })).toMatchObject({ cost: 9, source: 'metafield' })
    expect(resolveEngineCost({ unitCost: null, metafieldCost: null, feed: null, now: NOW })).toMatchObject({ cost: null, source: 'none' })
    expect(resolveEngineCost({ unitCost: 7, metafieldCost: null, feed: feed(null), now: NOW }).cost).toBe(7)
    expect(resolveEngineCost({ unitCost: 7, metafieldCost: null, feed: feed(0), now: NOW }).cost).toBe(7)
  })

  it('applies the same rule to a lapsed metafield-only cost', () => {
    const c = resolveEngineCost({ unitCost: null, metafieldCost: 6, feed: feed(10), now: NOW })
    expect(c).toEqual({ cost: 10, source: 'feed', replacedUnitCost: null })
  })

  it('uses the feed when there is no Shopify cost at all', () => {
    expect(resolveEngineCost({ unitCost: null, metafieldCost: null, feed: feed(10), now: NOW }).cost).toBe(10)
  })
})

describe('engineCostNote', () => {
  it('names both costs when the feed replaced the unit cost', () => {
    const note = engineCostNote({ cost: 50.05, source: 'feed', replacedUnitCost: 35.04 })
    expect(note).toContain('$50.05')
    expect(note).toContain('$35.04')
  })

  it('is empty when the unit cost stood', () => {
    expect(engineCostNote({ cost: 16.68, source: 'unit_cost', replacedUnitCost: null })).toBe('')
  })
})

describe('nalpacSaleTagPct', () => {
  it('reads the tag from Sub-Category or Main Category', () => {
    expect(nalpacSaleTagPct({ 'Sub-Category': '40% Off Sale,Collars and Leashes' })).toBe(0.4)
    expect(nalpacSaleTagPct({ 'Main Category': '75% Off Sale', 'Sub-Category': 'Wands' })).toBe(0.75)
  })

  it('is null for an untagged or missing row', () => {
    expect(nalpacSaleTagPct({ 'Sub-Category': 'Douches and Enemas,Hygiene' })).toBeNull()
    expect(nalpacSaleTagPct(undefined)).toBeNull()
  })
})
