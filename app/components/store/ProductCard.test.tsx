/**
 * Ticket #19583 (the #19550 anti-pattern repeated here): the MAP gate was
 * called with `compareAt` (Shopify's native, manually-set compare-at) as the
 * regular-price argument instead of `originalPrice` (xdipx.original_price,
 * the real MSRP). A MAP == MSRP product with a compare-at sitting above its
 * own MAP/MSRP still passed the gate and rendered a struck price + badge it
 * may not legally advertise.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'
import { ProductCard } from './ProductCard'

type Props = Parameters<typeof ProductCard>[0]

function renderCard(props: Props): string {
  const Stub = createRoutesStub([{ path: '/', Component: () => <ProductCard {...props} /> }])
  return renderToStaticMarkup(<Stub />)
}

const BASE: Props = {
  id: 'gid://shopify/Product/1',
  handle: 'test-product',
  title: 'Test Product',
  price: 69.99,
  compareAt: 89.99,
  originalPrice: 69.99,
  mapPrice: 69.99,
}

describe('store/ProductCard — the MAP gate (ticket #19583)', () => {
  it('suppresses the struck price when mapPrice equals originalPrice, even with a larger compareAt', () => {
    const html = renderCard(BASE)
    expect(html).not.toContain('line-through')
  })

  it('shows the struck price when mapPrice sits below originalPrice', () => {
    const html = renderCard({ ...BASE, mapPrice: 49.99 })
    expect(html).toContain('line-through')
  })

  it('never falls back to compareAt when originalPrice is absent', () => {
    const { originalPrice: _omit, ...rest } = BASE
    const html = renderCard({ ...rest, mapPrice: 49.99 })
    expect(html).not.toContain('line-through')
  })
})
