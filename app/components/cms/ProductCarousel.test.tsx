/**
 * Ticket #19583 (the #19550 anti-pattern repeated here): the MAP gate was
 * called with `compareAtPrice` (Shopify's native, manually-set compare-at) as
 * the regular-price argument instead of `originalPrice` (xdipx.original_price,
 * the real MSRP). A MAP == MSRP product with a compare-at sitting above its
 * own MAP/MSRP still passed the gate and rendered a struck price + badge it
 * may not legally advertise.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

// Ticket #19941 (design-critic, run 1837). The brand eyebrow rendered here as
// `<p className="text-ink-3 text-xs">` — body sans, no uppercase, no
// tracking — while doctrine section 6 ("Borrowed credibility on cards")
// specifies a mono ink-4 eyebrow, which StorefrontProductCard.tsx already
// renders correctly. Guard spans both files (run 1298's pattern for a
// treatment that must match across every component the surface spans), so a
// future edit to either card can't silently reintroduce the mismatch.
const BRAND_EYEBROW_TREATMENT = 'text-[13px] uppercase tracking-[0.12em] text-ink-4'

describe('product card brand eyebrow — doctrine §6 mono treatment (#19941)', () => {
  it('ProductCarousel renders the brand eyebrow with the mono/uppercase/tracking/ink-4 treatment', () => {
    const html = renderCarousel(BASE)
    expect(html).toContain(BRAND_EYEBROW_TREATMENT)
  })

  it('ProductCarousel.tsx and StorefrontProductCard.tsx source both carry the same brand-eyebrow treatment string', () => {
    const carouselSource = readFileSync(fileURLToPath(new URL('./ProductCarousel.tsx', import.meta.url)), 'utf8')
    const cardSource = readFileSync(
      fileURLToPath(new URL('../store/StorefrontProductCard.tsx', import.meta.url)),
      'utf8',
    )
    expect(carouselSource).toContain(BRAND_EYEBROW_TREATMENT)
    expect(cardSource).toContain(BRAND_EYEBROW_TREATMENT)
  })
})
