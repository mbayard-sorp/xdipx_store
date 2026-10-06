/**
 * `toCartUpsell` (ticket #13340, split off #13147's homepage payload diet)
 * projects a fetched `Product` down to the lean shape `CartDrawer.tsx`'s
 * upsell rail actually reads, so `/api/cart` stops shipping the full
 * `PRODUCT_CORE_FRAGMENT` shape (every variant, description, metafields,
 * sellingPlanGroups, media) over the wire for a drawer that only ever reads
 * title, handle, price, the first image, and the first variant's id and
 * availability.
 */
import { describe, expect, it } from 'vitest'
import { toCartUpsell } from '~/lib/shopify.server'
import type { Product } from '~/types'

function fixtureVariant(overrides: Partial<Product['variants'][number]> = {}): Product['variants'][number] {
  return {
    id: 'gid://shopify/ProductVariant/1',
    title: 'Default',
    selectedOptions: [],
    price: '29.99',
    compareAtPrice: null,
    availableForSale: true,
    quantityAvailable: 10,
    ...overrides,
  }
}

function fixtureProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'test-product',
    title: 'Test Product',
    images: [{ url: 'https://cdn.shopify.com/test.jpg', altText: 'A test product' }],
    videos: [],
    variants: [fixtureVariant()],
    price: 29.99,
    tags: ['lube'],
    ...overrides,
  } as Product
}

describe('toCartUpsell', () => {
  it('projects exactly the fields the cart drawer reads, nothing else', () => {
    const out = toCartUpsell(fixtureProduct())
    expect(out).toEqual({
      handle: 'test-product',
      title: 'Test Product',
      price: 29.99,
      image: { url: 'https://cdn.shopify.com/test.jpg', altText: 'A test product' },
      variantId: 'gid://shopify/ProductVariant/1',
      variantAvailableForSale: true,
      hasMultipleVariants: false,
    })
    expect(Object.keys(out).sort()).toEqual(
      ['handle', 'hasMultipleVariants', 'image', 'price', 'title', 'variantAvailableForSale', 'variantId'].sort(),
    )
  })

  it('reports hasMultipleVariants once a second variant exists', () => {
    const product = fixtureProduct({
      variants: [
        fixtureVariant({ id: 'v1', title: 'Small', price: '19.99' }),
        fixtureVariant({ id: 'v2', title: 'Large', price: '24.99' }),
      ],
    })
    expect(toCartUpsell(product).hasMultipleVariants).toBe(true)
  })

  it('reads availableForSale off the first variant only, never the pool', () => {
    const product = fixtureProduct({
      variants: [fixtureVariant({ id: 'v1', availableForSale: false, quantityAvailable: 0 })],
    })
    const out = toCartUpsell(product)
    expect(out.variantAvailableForSale).toBe(false)
    expect(out.variantId).toBe('v1')
  })

  it('returns a null image and an empty variantId rather than throwing when either is absent', () => {
    const product = fixtureProduct({ images: [], variants: [] })
    const out = toCartUpsell(product)
    expect(out.image).toBeNull()
    expect(out.variantId).toBe('')
    expect(out.variantAvailableForSale).toBe(false)
    expect(out.hasMultipleVariants).toBe(false)
  })
})
