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
import { SearchTile } from './SearchProductGrid'
import type { SearchProductResult } from '~/lib/search.server'

const BASE: SearchProductResult = {
  handle: 'test-product',
  title: 'Test Product',
  vendor: null,
  tags: [],
  category: null,
  previewImageUrl: null,
  price: '69.99',
  compareAtPrice: '89.99',
  originalPrice: '69.99',
  mapPrice: '69.99',
  featuredImage: null,
  shopifyId: 'gid://shopify/Product/1',
  defaultVariantId: null,
  hasMultipleVariants: false,
  availableForSale: true,
  firstVideo: null,
}

function renderTile(product: SearchProductResult): string {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <SearchTile product={product} isLiveDeal={false} /> },
  ])
  return renderToStaticMarkup(<Stub />)
}

describe('SearchTile — the MAP gate (ticket #19583)', () => {
  it('suppresses the struck price when mapPrice equals originalPrice, even with a larger compareAtPrice', () => {
    const html = renderTile(BASE)
    expect(html).not.toContain('line-through')
  })

  it('shows the struck price when mapPrice sits below originalPrice', () => {
    const html = renderTile({ ...BASE, mapPrice: '49.99' })
    expect(html).toContain('line-through')
  })

  it('never falls back to compareAtPrice when originalPrice is absent', () => {
    const html = renderTile({ ...BASE, mapPrice: '49.99', originalPrice: null })
    expect(html).not.toContain('line-through')
  })
})
