import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Guard for the mission brief §1 `/discover` link cap on the homepage.
 *
 * §1: "/discover appears at most twice on the page: once as the closer for
 * people who genuinely do not know where to start ... and at most one preset
 * pill deep-link. Nothing else points there." Later in the same section: "Only
 * the mosaic promo slot may keep /discover."
 *
 * So the two permitted doors are the Nº 05 mosaic promo and the Nº 09 closer.
 * The MOOD_PILLS comment in StorefrontHome.tsx has named exactly those two as
 * the cap since the redesign-v2 spec, and the file still shipped a third: the
 * Nº 04 Meet Emma band carried a hardcoded `to="/discover"`. The live page
 * served three `href="/discover"` links, measured from 2026-10-14 (recorded in
 * the teardown delta as "breached at three") through 2026-10-21, when
 * `homepage-ia` ruled the Meet Emma link the over-cap one and Routine B run
 * 1571 removed it. The file documented its own invariant and violated it, and
 * nothing failed, which is why this guard exists.
 *
 * WHAT THIS GUARD CANNOT SEE, stated rather than implied: it reads source text,
 * so it only covers the links the COMPONENT hardcodes. A Sanity-published rail,
 * tile or band `ctaLink` pointing at /discover would breach the same cap and
 * this test would stay green. Catching that needs a render assertion over a
 * published payload, which is banked rather than built here.
 */
describe('StorefrontHome.tsx — the /discover link cap (mission brief §1)', () => {
  const source = readFileSync(fileURLToPath(new URL('./StorefrontHome.tsx', import.meta.url)), 'utf8')

  // Strip comments first. The cap is about links the component emits, and the
  // prose around it legitimately says "/discover" many times to explain the
  // rule; counting those would make the guard fire on its own documentation.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('hardcodes exactly one route literal, the Nº 09 closer', () => {
    const hardcoded = code.match(/to="\/discover"/g) ?? []
    expect(hardcoded).toHaveLength(1)
  })

  it('keeps the mosaic promo as the only other door, via its content fallback', () => {
    // The promo renders `to={promoCtaLink}`, so its /discover is a fallback
    // string rather than a literal href. Pinned here because it is the one
    // deliberate remaining instance: the cap is two, and this is the second.
    expect(code).toContain("const promoCtaLink = promo?.ctaLink || '/discover'")
    const literals = code.match(/'\/discover'|"\/discover"/g) ?? []
    expect(literals).toHaveLength(2)
  })

  it('does not reintroduce a CTA in the Nº 04 Meet Emma band', () => {
    // §8: her introduction is a trust beat, not a sell beat. The band is
    // delimited by its own section id and the start of the next section.
    const start = code.indexOf('id="meet-emma"')
    expect(start).toBeGreaterThan(-1)
    const band = code.slice(start, code.indexOf('function FindYourWayIn', start))
    expect(band).not.toContain('<Link')
    expect(band).not.toContain('trackCtaClick')
  })
})
