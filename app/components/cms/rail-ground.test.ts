import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { railGroundClass } from './ProductCarousel'
import { editRailGround, TEAM_RAIL_GROUND } from '~/components/store/StorefrontHome'

/**
 * Rail band grounds (ticket #12340). On 2026-09-29 the live homepage rendered
 * four consecutive #FFFFFF bands (wayfinder, under-$30 rail, wearables rail,
 * glass rail), against design-doctrine.md §1 ground alternation. The cause was
 * not a bad content pick: the Sanity `bgStyle` enum predates the v3 palette, so
 * `white` and `cream` BOTH resolve to #FFFFFF now that `cream` is a legacy
 * alias of paper, and no value in the enum can select a v3 ground at all. The
 * schema is additive-only, so the composing page assigns the ground instead.
 */

describe('railGroundClass — assigned ground vs published bgStyle', () => {
  it('uses the assigned v3 ground over a light legacy bgStyle', () => {
    expect(railGroundClass('storefront', 'white', 'paper-3')).toBe('bg-paper-3')
    expect(railGroundClass('storefront', 'cream', 'paper-2')).toBe('bg-paper-2')
    expect(railGroundClass('storefront', 'mist', 'plum-soft')).toBe('bg-plum-soft')
  })

  it('never re-tints a deliberate dark rail', () => {
    // charcoal/purple are an explicit editorial choice and carry their own
    // light-on-dark text treatment; silently painting them paper would strand
    // white type on a white band.
    expect(railGroundClass('storefront', 'charcoal', 'paper')).toBe('bg-ink')
    expect(railGroundClass('storefront', 'purple', 'coral-soft')).toBe('bg-sage')
  })

  it('leaves legacy chrome alone entirely', () => {
    // The deferred daily-deal home's ForHim/ForHer rails and plain
    // `productCarousel` blocks are not part of the v3 storefront surface.
    expect(railGroundClass('legacy', 'white', 'paper-3')).toBe('bg-white')
    expect(railGroundClass('legacy', 'cream', 'plum-soft')).toBe('bg-cream')
  })

  it('falls back to the published bgStyle when no ground is assigned', () => {
    expect(railGroundClass('storefront', 'white')).toBe('bg-white')
    expect(railGroundClass('storefront', 'mist')).toBe('bg-cream-2')
  })

  it('falls back to white for an unknown bgStyle', () => {
    expect(railGroundClass('storefront', 'chartreuse')).toBe('bg-white')
  })
})

describe('editRailGround — the Nº 06 rail run alternates at every count', () => {
  it('leads on a real tint, not another pale band', () => {
    // Doctrine §1: never ship six pale sections in a row. design-critic
    // measured six consecutive pale bands spanning 56% of the page height on
    // 2026-09-30, and the rails are the only bands in that run whose ground
    // this team may set. Rotating paper/paper-2/paper-3 would alternate and
    // still be six pale bands, so the run has to lead on a tint.
    expect(editRailGround(0)).toBe('coral-soft')
    expect(TEAM_RAIL_GROUND).toBe('plum-soft')
  })

  it('never repeats a ground on adjacent rails', () => {
    // The defect was a RUN of identical bands, so the property that matters is
    // pairwise inequality across the whole run, at any rail count.
    const run = Array.from({ length: 12 }, (_, i) => editRailGround(i))
    for (let i = 1; i < run.length; i++) {
      expect(run[i], `rail ${i} repeats rail ${i - 1}`).not.toBe(run[i - 1])
    }
  })

  it('only ever emits grounds from the doctrine ground lock', () => {
    const lock = new Set(['paper', 'paper-2', 'paper-3', 'coral-soft', 'plum-soft'])
    for (let i = 0; i < 12; i++) expect(lock.has(editRailGround(i))).toBe(true)
    expect(lock.has(TEAM_RAIL_GROUND)).toBe(true)
  })

  it('spends at most one coral ground on the run', () => {
    // Coral is the accent, not a wash (doctrine §3 / the coral budget). One
    // coral-soft band per rotation is the committed tinted band; two would be
    // a coral wall.
    const run = Array.from({ length: 12 }, (_, i) => editRailGround(i))
    const perRotation = run.slice(0, 3).filter(g => g === 'coral-soft')
    expect(perRotation).toHaveLength(1)
  })
})

/**
 * Type discipline on the storefront rails (ticket #12340, defects 3). These are
 * source-level pins in the same spirit as product-carousel-header.test.ts: the
 * rendered result has no screenshot gate available inside a scheduled run, so
 * the mechanism is pinned where it lives.
 */
const src = readFileSync(
  fileURLToPath(new URL('./ProductCarousel.tsx', import.meta.url)),
  'utf-8',
)

describe('storefront rail header takes the v3 type motifs', () => {
  it('sets the See-all CTA in font-body, matching the Nº 03 grid See-all', () => {
    // Doctrine §2 assigns CTA text to font-body. This was the only CTA on the
    // storefront rendered in the Newsreader display serif.
    expect(src).toContain("storefront ? { fontFamily: 'var(--font-body)' }")
  })

  it('renders the eyebrow through the mono .kicker class', () => {
    // It rendered in DM Sans semibold, making the published rails the only
    // bands on the storefront whose section label was not mono.
    expect(src).toMatch(/storefront\s*\n?\s*\?\s*`kicker/)
  })

  it('renders the heading through EmphasizedHeading, not a bare string', () => {
    // Doctrine §2: exactly one plum-italic emphasis word per headline. Every
    // other storefront h2 already goes through this component.
    expect(src).toContain('<EmphasizedHeading text={heading} onDark={dark} />')
  })

  it('leaves the legacy chrome branch on the old treatment', () => {
    expect(src).toContain("text-xs font-semibold uppercase tracking-[0.18em] mb-1")
  })
})
