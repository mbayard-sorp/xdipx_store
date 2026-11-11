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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VaultCard } from './VaultCard'
import { CardMediaCarousel } from './CardMediaCarousel'
import { CategoryMasthead } from '~/components/category/CategoryMasthead'
import { DropMasthead } from '~/components/category/DropMasthead'
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

/**
 * The collection route has TWO things that can own the LCP above its grid: the
 * plain `<picture>` hero on a non-merchandised page, and the categoryMasthead /
 * dropMasthead block on a merchandised one. Both mastheads render their image
 * with `priority` themselves, so a route condition that only asked
 * `!merchandised` would hand the grid's first card a second priority image on
 * exactly the pages that run a merchandised frame, /collections/pleasure and
 * /collections/play among them.
 *
 * These two blocks pin the premise the route's condition rests on. The first
 * checks the mastheads really do claim priority (if someone removes it, the
 * route's condition starts giving those pages ZERO priority images, and this
 * is where they find out). The second checks the route still reads the
 * combined condition rather than the naive one.
 */
const MASTHEAD_BLOCK = {
  _type: 'categoryMasthead' as const,
  anchorId: 'top',
  kicker: 'PLEASURE',
  headline: 'Everything that is about you',
  italicWord: 'you',
  standfirst: 'A standfirst.',
  imageUrl: 'https://cdn.sanity.io/images/x/y/masthead.jpg',
  imageAlt: 'masthead',
}

describe('merchandised masthead owns the LCP above the grid', () => {
  it('CategoryMasthead renders its image at high priority', () => {
    const html = renderGrid(<CategoryMasthead block={MASTHEAD_BLOCK as never} />)
    expect(countHighPriorityImages(html)).toBe(1)
  })

  it('DropMasthead renders its image at high priority', () => {
    const html = renderGrid(
      <DropMasthead block={{ ...MASTHEAD_BLOCK, _type: 'dropMasthead', period: 'November' } as never} />,
    )
    expect(countHighPriorityImages(html)).toBe(1)
  })

  it('the collection route gates its first card on both masthead shapes, not on !merchandised alone', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../../routes/_layout.collections.$handle.tsx', import.meta.url)),
      'utf8',
    )
    // The card reads the combined condition.
    expect(route).toMatch(/priority=\{i === 0 && !aboveGridOwnsLcp\}/)
    // Which is built from both the plain hero and the merchandised masthead.
    expect(route).toMatch(/const aboveGridOwnsLcp =\s*plainHeroRendered \|\| merchandisedMastheadImage/)
    // And the merchandised half looks at both masthead block types.
    expect(route).toContain("b._type === 'categoryMasthead' || b._type === 'dropMasthead'")
  })
})
