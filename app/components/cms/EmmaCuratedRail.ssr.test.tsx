import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EmmaCuratedRail } from './EmmaCuratedRail'
import { ContentBlockRenderer } from './ContentBlockRenderer'
import type { EmmaCuratedRailBlock } from '~/types/cms'
import type { LeanCardProduct } from '~/types'

/**
 * End-to-end proof of the three #12340 render fixes on the surface they were
 * filed against: a published `emmaCuratedRail` on the v3 storefront. The unit
 * tests pin the resolvers; this pins the HTML those resolvers actually produce,
 * because a cloud routine cannot reach the SSO-gated Vercel preview to look at
 * the branch (ticket #11087).
 */

const PRODUCTS: LeanCardProduct[] = [
  {
    id: 'gid://shopify/Product/1',
    handle: 'a-real-product',
    title: 'A Real Product',
    brand: 'Brandname',
    price: 49.99,
    compareAtPrice: null,
    mapPrice: null,
    images: [{ url: 'https://cdn.example/a.jpg', altText: 'A Real Product' }],
  } as unknown as LeanCardProduct,
]

function block(over: Partial<EmmaCuratedRailBlock> = {}): EmmaCuratedRailBlock {
  return {
    _type: 'emmaCuratedRail',
    _key: 'rail-test',
    active: true,
    order: 0,
    heading: 'Under thirty, and every one of them packs a real buzz.',
    eyebrow: 'Under $30',
    ctaLink: '/collections/under-30',
    ctaLabel: 'See all',
    ...over,
  } as EmmaCuratedRailBlock
}

function render(b: EmmaCuratedRailBlock, ground?: 'paper' | 'paper-2' | 'paper-3' | 'coral-soft' | 'plum-soft') {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => <EmmaCuratedRail block={b} products={PRODUCTS} {...(ground ? { ground } : {})} />,
    },
  ])
  return renderToStaticMarkup(<Stub />)
}

describe('emmaCuratedRail SSR output carries the v3 doctrine treatment', () => {
  it('renders the eyebrow through the mono .kicker class, not DM Sans semibold', () => {
    const html = render(block())
    expect(html).toContain('class="kicker mb-1 block"')
    expect(html).not.toContain('text-xs font-semibold uppercase tracking-[0.18em] mb-1')
  })

  it('renders exactly one plum-italic emphasis word in the heading', () => {
    const html = render(block())
    // Last-word fallback: the block has no emphasis field and the schema is
    // additive-only, so the component supplies it the same way the hero does.
    expect(html).toContain('<em class="em">buzz</em>.')
    expect(html.match(/<em /g)).toHaveLength(1)
  })

  it('paints the assigned v3 ground on the band, overriding the legacy bgStyle', () => {
    // `white` and `cream` both resolve to #FFFFFF, which is how four bands in a
    // row ended up identical on the live page.
    expect(render(block({ bgStyle: 'white' }), 'coral-soft')).toContain('bg-coral-soft')
    expect(render(block({ bgStyle: 'cream' }), 'plum-soft')).toContain('bg-plum-soft')
  })

  it('paints the Emma aside band on the SAME ground as the rail, with no seam', () => {
    const html = render(block({ emmaAside: 'Picked for pacing, not power.' }), 'coral-soft')
    // Both the aside wrapper and the rail section carry the ground class.
    expect(html.match(/bg-coral-soft/g)!.length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('bg-white')
  })

  it('aligns the Emma aside to the doctrine band container, not the legacy one', () => {
    const html = render(block({ emmaAside: 'Picked for pacing, not power.' }))
    expect(html).toContain('mx-auto max-w-[1320px] px-6 md:px-16')
    expect(html).not.toContain('max-w-6xl')
  })

  it('sets the See-all CTA in DM Sans at the Nº 03 grid size', () => {
    const html = render(block())
    expect(html).toMatch(/text-\[15px\] font-medium[^"]*text-ink link-coral/)
    expect(html).toContain('font-family:var(--font-body)')
  })

  it('never re-tints a deliberately dark rail', () => {
    const html = render(block({ bgStyle: 'charcoal' }), 'coral-soft')
    expect(html).toContain('bg-ink')
    expect(html).not.toContain('bg-coral-soft')
    // and the emphasis word takes the lifted plum on that ground
    expect(html).toContain('em em-on-dark')
  })

  it('does NOT put .kicker on a dark rail, because it would win on specificity', () => {
    // `.kicker` is defined unlayered in app.css, so its own
    // `color: var(--color-ink-3)` beats a Tailwind `text-white/60` out of
    // `@layer utilities` and the eyebrow renders ink-3 on ink at ~2.7:1
    // (qa-reviewer, run 1162, measured in the built CSS). Dark rails take the
    // explicit mono treatment every other dark band on the storefront uses.
    const html = render(block({ bgStyle: 'charcoal' }))
    expect(html).not.toContain('kicker')
    expect(html).toContain('font-mono')
    expect(html).toContain('text-white/60')
  })

  it('still renders cleanly with no eyebrow, no ctaLink and no aside', () => {
    const full = block()
    const { eyebrow: _e, ctaLink: _c, ctaLabel: _l, emmaAside: _a, ...bare } = full
    const html = render(bare as EmmaCuratedRailBlock, 'paper-3')
    expect(html).toContain('bg-paper-3')
    expect(html).toContain('<em class="em">buzz</em>.')
    expect(html).not.toContain('kicker')
    expect(html).not.toContain('link-coral')
  })
})

/**
 * The forwarding hop. qa-reviewer (run 1162) reverted each piece of the fix in
 * turn and found this one unpinned: deleting the `ground` passthrough in
 * ContentBlockRenderer restored four identical white bands with the whole suite
 * still green, because every other test either exercises the pure resolvers or
 * hands EmmaCuratedRail the prop directly.
 */
describe('ContentBlockRenderer forwards ground to an emmaCuratedRail', () => {
  function renderThroughDispatcher(ground?: 'coral-soft' | 'plum-soft') {
    const b = block()
    const Stub = createRoutesStub([
      {
        path: '/',
        Component: () => (
          <ContentBlockRenderer
            block={b}
            carouselProductMap={{ [b._key]: PRODUCTS }}
            {...(ground ? { ground } : {})}
          />
        ),
      },
    ])
    return renderToStaticMarkup(<Stub />)
  }

  it('paints the assigned ground when one is passed', () => {
    expect(renderThroughDispatcher('coral-soft')).toContain('bg-coral-soft')
    expect(renderThroughDispatcher('plum-soft')).toContain('bg-plum-soft')
  })

  it('falls back to the published bgStyle when none is passed', () => {
    const html = renderThroughDispatcher()
    expect(html).toContain('bg-white')
    expect(html).not.toContain('bg-coral-soft')
  })
})

/**
 * The last unpinned link: StorefrontHome actually PASSING a ground to each rail
 * slot. This is a source-level pin and it is weaker than the SSR tests above —
 * SSR-rendering StorefrontHome needs the whole storefront payload — but the
 * alternative qa-reviewer measured is no coverage at all: deleting both
 * `ground=` props silently restores the defect.
 */
describe('StorefrontHome assigns a ground to every rail slot', () => {
  const home = readFileSync(
    fileURLToPath(new URL('../store/StorefrontHome.tsx', import.meta.url)),
    'utf-8',
  )

  it('passes TEAM_RAIL_GROUND to the first team rail', () => {
    expect(home).toContain('ground={TEAM_RAIL_GROUND}')
  })

  it('passes a per-index ground to each Nº 06 edit rail', () => {
    expect(home).toContain('ground={editRailGround(i)}')
  })
})
