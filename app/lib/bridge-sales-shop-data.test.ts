import { describe, it, expect } from 'vitest'
import { salesShopData } from '~/routes/bridge.$slug'
import type { Product } from '~/types'

/**
 * Ticket #19550. `salesShopData` (app/routes/bridge.$slug.tsx) fed
 * `showCompareAt` from `mapAllowsDiscountDisplay(product.mapPrice,
 * product.compareAtPrice)` -- the live defect: a Shopify compare-at is set
 * manually per variant and can sit above the real original price, so a MAP
 * == MSRP product (no legal discount room at all) still passed the gate
 * whenever its compare-at happened to be higher than its MAP. Live case:
 * the-male-rose-gawk-gawk-3000, mapPrice 69.99 == originalPrice 69.99,
 * compareAtPrice 89.99 -- the page advertised "22% OFF" against its own MAP.
 *
 * Lives here, not under app/routes/, because the test's own filename would
 * otherwise be swept up by flatRoutes()/typegen as a route candidate
 * (confirmed live: `.react-router/types/app/routes/+types/bridge.$slug.test.ts`
 * generated and then failed as an empty "route" with no test suite).
 */

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'the-male-rose-gawk-gawk-3000',
    title: 'The Male Rose',
    images: [],
    videos: [],
    variants: [],
    price: 69.99,
    tags: [],
    ...overrides,
  }
}

describe('salesShopData — the MAP gate (ticket #19550)', () => {
  it('suppresses showCompareAt when mapPrice equals originalPrice, even with a larger compareAtPrice', () => {
    const p = product({ mapPrice: 69.99, originalPrice: 69.99, compareAtPrice: 89.99 })
    expect(salesShopData(p).showCompareAt).toBe(false)
  })

  it('allows showCompareAt when mapPrice sits below originalPrice', () => {
    const p = product({ mapPrice: 49.99, originalPrice: 69.99, compareAtPrice: 89.99 })
    expect(salesShopData(p).showCompareAt).toBe(true)
  })

  it('never falls back to compareAtPrice when originalPrice is absent', () => {
    // No originalPrice metafield at all: mapAllowsDiscountDisplay's own
    // null-regularPrice guard suppresses the badge rather than guessing from
    // compareAtPrice, which is exactly the field this ticket proved unsafe.
    const p = product({ mapPrice: 49.99, compareAtPrice: 89.99 })
    expect(salesShopData(p).showCompareAt).toBe(false)
  })
})
