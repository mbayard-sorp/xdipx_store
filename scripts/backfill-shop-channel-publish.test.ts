import { describe, it, expect } from 'vitest'
import { classifyForShopBackfill } from './backfill-shop-channel-publish'

describe('classifyForShopBackfill (#22350)', () => {
  it('publishes an ordinary active product with no exclusion flags', () => {
    expect(classifyForShopBackfill({ productType: 'Lubricant', discontinuedAt: null, refusedAt: null })).toBe('publish')
  })

  it('skips productType "Discontinued", case-insensitively', () => {
    expect(classifyForShopBackfill({ productType: 'Discontinued', discontinuedAt: null, refusedAt: null }))
      .toBe('skip-discontinued-type')
    expect(classifyForShopBackfill({ productType: 'discontinued', discontinuedAt: null, refusedAt: null }))
      .toBe('skip-discontinued-type')
  })

  it('skips a product carrying xdipx.discontinued_at even when productType is something else', () => {
    expect(classifyForShopBackfill({ productType: 'Cock Ring', discontinuedAt: '2026-09-01', refusedAt: null }))
      .toBe('skip-discontinued-at')
  })

  it('skips a product Shopify already refused on a prior run, without retrying it', () => {
    expect(classifyForShopBackfill({ productType: 'Pasties', discontinuedAt: null, refusedAt: '2026-11-10' }))
      .toBe('skip-already-refused')
  })

  it('treats an empty-string metafield value the same as absent (never set)', () => {
    expect(classifyForShopBackfill({ productType: 'Lubricant', discontinuedAt: '', refusedAt: '' })).toBe('publish')
  })

  it('checks discontinued-type before discontinued_at before already-refused', () => {
    // A row could in principle carry more than one flag; the exact reason
    // reported does not change the outcome (never published either way),
    // but the precedence should be stable and not depend on object key order.
    expect(classifyForShopBackfill({ productType: 'Discontinued', discontinuedAt: '2026-09-01', refusedAt: '2026-11-10' }))
      .toBe('skip-discontinued-type')
    expect(classifyForShopBackfill({ productType: 'Lubricant', discontinuedAt: '2026-09-01', refusedAt: '2026-11-10' }))
      .toBe('skip-discontinued-at')
  })
})
