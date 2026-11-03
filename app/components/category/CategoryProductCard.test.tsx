/**
 * Ticket #19583 (the #19550 anti-pattern repeated here): the MAP gate was
 * called with `compareAtPrice` (Shopify's native, manually-set compare-at) as
 * the regular-price argument instead of `originalPrice` (xdipx.original_price,
 * the real MSRP). A MAP == MSRP product with a compare-at sitting above its
 * own MAP/MSRP still passed the gate and rendered a struck price + badge it
 * may not legally advertise.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'
import { CategoryProductCard } from './CategoryProductCard'
import type { CategoryCardProduct } from '~/types/cms'

const BASE: CategoryCardProduct = {
  id: 'gid://shopify/Product/1',
  handle: 'test-product',
  title: 'Test Product',
  price: 69.99,
  compareAtPrice: 89.99,
  originalPrice: 69.99,
  mapPrice: 69.99,
  brand: null,
  imageUrl: null,
  imageAlt: null,
  dial: [],
}

function renderCard(product: CategoryCardProduct): string {
  const Stub = createRoutesStub([{ path: '/', Component: () => <CategoryProductCard product={product} /> }])
  return renderToStaticMarkup(<Stub />)
}

describe('CategoryProductCard — the MAP gate (ticket #19583)', () => {
  it('suppresses the struck price when mapPrice equals originalPrice, even with a larger compareAtPrice', () => {
    const html = renderCard(BASE)
    expect(html).not.toContain('line-through')
  })

  it('shows the struck price when mapPrice sits below originalPrice', () => {
    const html = renderCard({ ...BASE, mapPrice: 49.99 })
    expect(html).toContain('line-through')
  })

  it('never falls back to compareAtPrice when originalPrice is absent', () => {
    const html = renderCard({ ...BASE, mapPrice: 49.99, originalPrice: null })
    expect(html).not.toContain('line-through')
  })
})
