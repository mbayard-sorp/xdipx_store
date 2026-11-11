/**
 * Guard: a listing grid ships at most ONE high-priority card image.
 *
 * How this class produces the pixel it prevents, in one sentence: `VaultCard`
 * hands `priority` to `CardMediaCarousel`, which hands it to `OptimizedImage`,
 * which renders `fetchPriority="high"` on the `<img>`; React DOM emits one
 * `<link rel="preload" as="image" fetchPriority="high">` into `<head>` for each
 * such image during SSR, so N priority cards put N high-priority image preloads
 * at the front of the request queue and the real LCP image loses the connection
 * race it should have won.
 *
 * The shape that shipped: `CardMediaCarousel` decided priority itself with
 * `priority={i === 0}`, where `i` is the slide index inside ONE card's
 * carousel, not the card's position in the grid. Every card therefore claimed
 * the LCP. Measured on live production 2026-11-11, before the fix:
 * /collections/pleasure 29 image preloads, /collections/play 29,
 * /collections/couples-vibrators 25 (1 masthead + 24 cards), /new 25,
 * /collections/wands 24. The homepage grid had already been through the
 * identical defect and fix (ticket #603, written up in `StorefrontHome.tsx`),
 * which is why the rule is "exactly one image per page is fetchPriority=high"
 * rather than "the hero is eager".
 *
 * These assert on the `<img>` attribute rather than on the emitted `<link>`,
 * because the `<img>` is the half this repo controls and the preload is React
 * DOM's deterministic consequence of it. `renderToStaticMarkup` does not run
 * React's resource hoisting, so the `<link>` is not observable here at all.
 *
 * Other shapes of the same defect these cover, beyond the one that happened:
 * a `priority` default flipped to `true` in either component's destructure, a
 * hardcoded `priority` / `priority={true}` inside a grid's `.map`, and a call
 * site that forwards the slide index instead of the card index.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'
import { VaultCard } from './VaultCard'
import { CardMediaCarousel } from './CardMediaCarousel'
import type { VaultDeal } from '~/types'

const IMAGES = [
  { url: 'https://cdn.shopify.com/s/files/1/0001/one.jpg', altText: 'one' },
  { url: 'https://cdn.shopify.com/s/files/1/0001/two.jpg', altText: 'two' },
]

function deal(n: number): VaultDeal {
  return {
    id: `gid://shopify/Product/${n}`,
    handle: `product-${n}`,
    seoTitle: `Product ${n}`,
    dealPrice: 49,
    msrp: 59,
    images: IMAGES,
    brand: 'Test',
    category: [],
    qty: 3,
    inStock: true,
    defaultVariantId: `gid://shopify/ProductVariant/${n}`,
    hasMultipleVariants: false,
  }
}

/** Count `<img>` elements carrying fetchPriority="high", however cased. */
function countHighPriorityImages(html: string): number {
  return (html.match(/<img[^>]*fetchpriority="high"/gi) ?? []).length
}

function renderGrid(node: React.ReactNode): string {
  const Stub = createRoutesStub([{ path: '/', Component: () => <>{node}</> }])
  return renderToStaticMarkup(<Stub />)
}

const PAGE_SIZE = 24

describe('listing-grid LCP priority', () => {
  it('renders zero high-priority images when no card is granted priority', () => {
    const html = renderGrid(
      Array.from({ length: PAGE_SIZE }, (_, i) => <VaultCard key={i} deal={deal(i)} />),
    )
    // Sanity-check the fixture actually produced images, so a zero count can
    // never be "the grid rendered nothing" wearing a pass.
    expect((html.match(/<img/g) ?? []).length).toBeGreaterThanOrEqual(PAGE_SIZE)
    expect(countHighPriorityImages(html)).toBe(0)
  })

  it('renders exactly one high-priority image when the first card is granted it', () => {
    const html = renderGrid(
      Array.from({ length: PAGE_SIZE }, (_, i) => (
        <VaultCard key={i} deal={deal(i)} priority={i === 0} />
      )),
    )
    expect(countHighPriorityImages(html)).toBe(1)
  })

  it('grants priority to the first slide only, never to a later slide of the same card', () => {
    const html = renderGrid(<VaultCard deal={deal(1)} priority />)
    expect(countHighPriorityImages(html)).toBe(1)
    // The fixture carries two images, so "one" here is a real selection among
    // slides rather than a card that only had one slide to choose from.
    expect((html.match(/<img/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('CardMediaCarousel defaults to no priority when the prop is omitted', () => {
    const html = renderGrid(
      <CardMediaCarousel cardId="c1" title="Product" images={IMAGES} />,
    )
    expect(countHighPriorityImages(html)).toBe(0)
  })
})
