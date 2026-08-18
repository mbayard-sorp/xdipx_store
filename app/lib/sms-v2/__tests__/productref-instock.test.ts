/**
 * productref-instock.test.ts — ticket #3542.
 *
 * Stock honesty across the sms-v2 pipeline: a product that is out of stock must
 * never be presented as available. Both the web adapter and the research stage
 * used to hardcode `inStock: true`, asserting stock they never checked. The fix
 * threads a real `ProductRef.inStock` sourced from Shopify variant availability
 * at hydration time.
 *
 * These two seams cover the DONE WHEN:
 *   - `fetchProductContext` is the hydration source both the web presentation
 *     path and the research stage read (research synthesizes its candidate card
 *     from `pitchedCtx.inStock`). An out-of-stock product must hydrate to
 *     `inStock: false`.
 *   - `productRefToCard` is the web adapter's ProductRef → ChatProductCard
 *     conversion. An out-of-stock ref must map to a card that is not available.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/lib/shopify.server', () => ({
  getProductByHandle: vi.fn(),
}))

import { fetchProductContext } from '../stages/_product-context.server'
import { productRefToCard } from '../adapters/web.server'
import { getProductByHandle } from '~/lib/shopify.server'
import type { ProductRef } from '../types.server'

/** Minimal Shopify product for fetchProductContext, variant availability tunable. */
function product(availability: boolean[]) {
  return {
    handle: 'aurora-wand',
    title: 'Aurora Wand',
    seoTitle: 'Aurora Wand',
    images: [],
    variants: availability.map((availableForSale, i) => ({
      id: `gid://variant/${i}`,
      title: 'Default',
      price: '89.99',
      availableForSale,
    })),
    rating: null,
  } as unknown as Awaited<ReturnType<typeof getProductByHandle>>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchProductContext — hydration is the source of truth for stock (#3542)', () => {
  it('hydrates an all-out-of-stock product to inStock: false', async () => {
    vi.mocked(getProductByHandle).mockResolvedValue(product([false, false]))
    const ctx = await fetchProductContext('aurora-wand')
    expect(ctx).not.toBeNull()
    expect(ctx!.inStock).toBe(false)
  })

  it('hydrates a product with any available variant to inStock: true', async () => {
    vi.mocked(getProductByHandle).mockResolvedValue(product([false, true]))
    const ctx = await fetchProductContext('aurora-wand')
    expect(ctx!.inStock).toBe(true)
  })

  it('treats a product with no variants as not available', async () => {
    vi.mocked(getProductByHandle).mockResolvedValue(product([]))
    const ctx = await fetchProductContext('aurora-wand')
    expect(ctx!.inStock).toBe(false)
  })
})

describe('productRefToCard — the web path never over-claims stock (#3542)', () => {
  const base: ProductRef = {
    handle: 'aurora-wand',
    title: 'Aurora Wand',
    price: '$89.99',
    pdpUrl: 'https://xdipx.com/products/aurora-wand',
    inStock: true,
  }

  it('presents an out-of-stock ref as a card that is not available', () => {
    const card = productRefToCard({ ...base, inStock: false })
    expect(card.inStock).toBe(false)
  })

  it('presents an in-stock ref as available', () => {
    const card = productRefToCard({ ...base, inStock: true })
    expect(card.inStock).toBe(true)
  })
})
