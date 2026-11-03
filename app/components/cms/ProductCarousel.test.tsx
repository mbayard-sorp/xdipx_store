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
import { ProductCarousel } from './ProductCarousel'
import type { LeanCardProduct } from '~/types'

const BASE: LeanCardProduct = {
  id: 'gid://shopify/Product/1',
  handle: 'test-product',
  title: 'Test Product',
  price: 69.99,
  compareAtPrice: 89.99,
  originalPrice: 69.99,
  mapPrice: 69.99,
  images: [],
}

function renderCarousel(product: LeanCardProduct): string {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <ProductCarousel products={[product]} /> },
  ])
  return renderToStaticMarkup(<Stub />)
}

describe('ProductCarousel card — the MAP gate (ticket #19583)', () => {
  it('suppresses the struck price when mapPrice equals originalPrice, even with a larger compareAtPrice', () => {
    const html = renderCarousel(BASE)
    expect(html).not.toContain('line-through')
  })

  it('shows the struck price when mapPrice sits below originalPrice', () => {
    const html = renderCarousel({ ...BASE, mapPrice: 49.99 })
    expect(html).toContain('line-through')
  })

  it('never falls back to compareAtPrice when originalPrice is absent', () => {
    const { originalPrice: _omit, ...rest } = BASE
    const html = renderCarousel({ ...rest, mapPrice: 49.99 })
    expect(html).not.toContain('line-through')
  })
})
