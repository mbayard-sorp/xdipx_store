import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { productShelfCrumb, titleCaseCrumbLabel } from './product-shelf'
import type { BreadcrumbCrumb } from '~/lib/breadcrumbs.server'

/**
 * Guards for the PDP sold-out branch's one onward link (Routine B run 2093,
 * backlog item 9a).
 *
 * THE CAUSAL TRACE, stated as the playbook's run-1703 rule requires, because a
 * guard whose trace cannot be stated is a comment with an assertion attached.
 *
 *  - The pixel this prevents: a sold-out PDP whose buy box offers a waitlist
 *    button and no way forward. Measured live on 2026-11-18 at
 *    /products/tantus-p-spot-vibrating-dildo-onyx, the store's biggest search
 *    surface at 309 GSC impressions: status "Sold out", one control, and zero
 *    onward product paths in the served HTML.
 *  - The class it pins: the link renders if and only if `productShelfCrumb`
 *    returns a usable shelf. So the function returning `undefined` for a
 *    linkable category IS the blank buy box, and the function returning a
 *    Home-or-product crumb IS a link that promises a shelf and delivers the
 *    homepage. Both directions are asserted below.
 *  - The opposite regression it also pins: the link leaking onto the IN-STOCK
 *    branch, which is the cannibalisation ticket #3447 deliberately removed.
 *    That one is a source-shape assertion, since the condition lives in JSX.
 */

const crumb = (label: string, href?: string): BreadcrumbCrumb =>
  ({ label, ...(href ? { href } : {}) }) as BreadcrumbCrumb

/** The real trail this fix was measured against, read off the live PDP's
 *  BreadcrumbList JSON-LD on 2026-11-18. */
const LIVE_TRAIL: BreadcrumbCrumb[] = [
  crumb('Home', '/'),
  crumb('Pleasure', '/collections/pleasure'),
  crumb('VIBRATORS', '/collections/vibrators'),
  crumb('Vibrating Tantus P-Spot Prostate Massager Onyx', '/products/tantus-p-spot-vibrating-dildo-onyx'),
]

describe('productShelfCrumb', () => {
  it('picks the most specific linked shelf, not the product and not Home', () => {
    expect(productShelfCrumb(LIVE_TRAIL)).toEqual({
      label: 'Vibrators',
      href: '/collections/vibrators',
    })
  })

  it('suppresses rather than pointing at the homepage when there is no shelf', () => {
    // Home + product only. Returning the Home crumb here would ship a line
    // reading "more in Home", which is why the loop stops at i >= 1.
    expect(productShelfCrumb([LIVE_TRAIL[0]!, LIVE_TRAIL[3]!])).toBeUndefined()
  })

  it('suppresses when the only shelf crumb carries no link', () => {
    expect(productShelfCrumb([
      crumb('Home', '/'),
      crumb('Pleasure'),
      LIVE_TRAIL[3]!,
    ])).toBeUndefined()
  })

  it('falls back to a less specific shelf when the nearest one has no link', () => {
    expect(productShelfCrumb([
      crumb('Home', '/'),
      crumb('Pleasure', '/collections/pleasure'),
      crumb('VIBRATORS'),
      LIVE_TRAIL[3]!,
    ])).toEqual({ label: 'Pleasure', href: '/collections/pleasure' })
  })

  it('never returns the product itself, whatever the trail length', () => {
    for (const trail of [LIVE_TRAIL, LIVE_TRAIL.slice(1), LIVE_TRAIL.slice(2)]) {
      expect(productShelfCrumb(trail)?.href).not.toBe(LIVE_TRAIL[3]!.href)
    }
  })

  it('suppresses on a whitespace-only label rather than rendering an empty noun', () => {
    expect(productShelfCrumb([
      crumb('Home', '/'),
      crumb('   ', '/collections/vibrators'),
      LIVE_TRAIL[3]!,
    ])).toBeUndefined()
  })

  it('handles degenerate trails without throwing', () => {
    expect(productShelfCrumb([])).toBeUndefined()
    expect(productShelfCrumb([crumb('Home', '/')])).toBeUndefined()
  })
})

describe('titleCaseCrumbLabel', () => {
  it('title-cases a shouting menu label', () => {
    expect(titleCaseCrumbLabel('VIBRATORS')).toBe('Vibrators')
  })

  it('title-cases every word of a multi-word shouting label', () => {
    expect(titleCaseCrumbLabel('FOR HIM')).toBe('For Him')
    expect(titleCaseCrumbLabel('BONDAGE & KINK')).toBe('Bondage & Kink')
    expect(titleCaseCrumbLabel('TOYS/ACCESSORIES')).toBe('Toys/Accessories')
    expect(titleCaseCrumbLabel('PLUS-SIZE')).toBe('Plus-Size')
  })

  it('trusts a mixed-case editorial label exactly as typed', () => {
    // "Just landed" must not become "Just Landed": mixed case is a human
    // choice and this helper only fixes shouting.
    for (const label of ['Just landed', 'Emma picks', 'iPhone cases']) {
      expect(titleCaseCrumbLabel(label)).toBe(label)
    }
  })
})

describe('the sold-out onward link stays on the sold-out branch (ticket #3447)', () => {
  const source = readFileSync(
    new URL('../routes/_layout.products.$slug.tsx', import.meta.url),
    'utf8',
  )

  it('renders the visible whitelist CTA exactly once in the route', () => {
    // The arrow is what distinguishes the VISIBLE CTA from the accessible
    // name, which reuses the verb without it. More than one occurrence of the
    // visible form means it was duplicated into another branch, and the
    // in-stock buy box is the branch #3447 cleared on purpose.
    const hits = source.match(/Take a peek →/g) ?? []
    expect(hits).toHaveLength(1)
  })

  it('gates that CTA on the shelf lookup, in any of the shapes the guard could miss', () => {
    // #16885: check the pattern against the other spellings the same defect
    // could take, not only the one that shipped.
    expect(source).toMatch(/\{shelf && \(/)
    // No second consumer of `shelf` that could render it unconditionally.
    const shelfRenders = source.match(/\{shelf\s*&&/g) ?? []
    expect(shelfRenders).toHaveLength(1)
    // The link must not appear via a bare anchor or a programmatic navigate.
    expect(source).not.toMatch(/<a[^>]+href=[^>]*collections[^>]*>\s*Take a peek/)
    expect(source).not.toMatch(/navigate\(\s*[`'"]\/collections/)
  })

  it('keeps the CTA string byte-exact to the charter whitelist', () => {
    // emma-empathy-reviewer run 2093 ruled the whitelist is an exact-string
    // list, so a parameterised CTA ("Take a peek at {category} →") fails it.
    // The category belongs in the accessible name only.
    expect(source).toContain('Take a peek →')
    // The VISIBLE label must carry no interpolation. The accessible name may,
    // and does. So the parameterised form is allowed to exist exactly as many
    // times as it appears inside an aria-label and never anywhere else: if a
    // later edit moves the category into the button text, the two counts
    // diverge and this fails.
    const parameterised = source.match(/Take a peek at /g) ?? []
    const asAccessibleName = source.match(/aria-label=\{`Take a peek at /g) ?? []
    expect(parameterised).toHaveLength(asAccessibleName.length)
    expect(asAccessibleName).toHaveLength(1)
    expect(source).toMatch(/aria-label=\{`Take a peek at \$\{shelf\.label\}`\}/)
  })

  it('states the fact without forecasting a restock', () => {
    expect(source).toContain('Sold out right now.')
    // Both of these implied a return this store cannot promise and were
    // rejected by the voice gate.
    expect(source).not.toContain('Out of stock for now')
    expect(source).not.toContain('between restocks')
  })
})
