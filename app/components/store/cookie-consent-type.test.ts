import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Guard for doctrine §2's type assignment on the cookie-consent banner's CTAs.
 *
 * §2's table is explicit: Newsreader (`font-display`) is "Headlines,
 * pull-quotes, editorial display, italic emphasis"; DM Sans (`font-body`) is
 * "Body copy, nav, labels, CTA text". The banner's "Accept all" button set its
 * label in the display serif via an inline `fontFamily: 'var(--font-display)'`
 * while its own "Essential only" sibling, and every other button on the page,
 * rendered in body — found by the design-critic gate in Routine B run 1571
 * (ticket #16878) and fixed in run 1703.
 *
 * Why this file is the right place for the invariant: the banner contains no
 * headline, no pull-quote and no editorial display element. It is two lines of
 * body copy, a policy link and two buttons. So "no display serif anywhere in
 * this component" is a clean rule with no legitimate exception, which is a
 * stronger guard than one that has to reason about which element is a CTA.
 *
 * SURFACE AUDIT (run 1703, the run-1298 "a guard spans every file the surface
 * spans" lesson). Every display-serif reference on the v3 storefront homepage
 * surface was classified before this guard was written, rather than only the
 * file that changed: StorefrontHome.tsx (2x h1, 2x h2), StorefrontProductCard
 * (h3 product title, 1 pull-quote p), ProductCarousel (as="h2" rail heading, 1
 * product-title p, and its See-all which already takes font-body on storefront
 * chrome per run 1162), CuriosityShelf (h2 + p), PanelDeck / PanelLarge (h2 and
 * the panel LABEL span, which is heading-scale display type, not CTA text — the
 * panels' actual CTA is the separate `arrowText`). TrustStrip and EmailSubscribe
 * put none on a button. So after this fix the surface carries ZERO CTA-text
 * elements in the display serif, and the remaining uses are all legitimate
 * §2 roles. Those counts are recorded here rather than asserted: pinning eight
 * files' totals would fire on any ordinary heading edit, which buys a brittle
 * test instead of a real invariant.
 *
 * WHAT THIS GUARD CANNOT SEE, stated rather than implied: it reads source text
 * in one file. A display-serif CTA added to a DIFFERENT component, or applied
 * from a stylesheet rule rather than a class or inline style, stays green here.
 */
describe('CookieConsent.tsx — doctrine §2 assigns CTA text to DM Sans', () => {
  const source = readFileSync(fileURLToPath(new URL('./CookieConsent.tsx', import.meta.url)), 'utf8')

  // Strip comments first: the fix's own comment legitimately names the token it
  // removed, and counting that would make the guard fire on its documentation.
  // Same approach as storefront-discover-cap.test.ts.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  const WHY =
    'doctrine §2 assigns CTA text to DM Sans (font-body); Newsreader is headlines, pull-quotes and italic emphasis. This banner has no headline, so it has no legitimate display-serif element. If you are deliberately changing that, change the doctrine first.'

  it('sets no label in the display serif, in any of the shapes that would do it', () => {
    // Deliberately several spellings rather than the one that shipped. Per
    // ticket #16885, a guard proven only against the exact form of the defect
    // it just fixed is proven against the form least likely to recur. The
    // shapes that would reintroduce the same defect here:
    //   style={{ fontFamily: 'var(--font-display)' }}   <- what actually shipped
    //   className="font-display"                        <- the Tailwind utility
    //   style={DISPLAY}                                 <- the shared const the
    //                                                      panels and the shelf
    //                                                      use, the most likely
    //                                                      next spelling since
    //                                                      it reads as idiomatic
    //   font-serif / 'Newsreader'                       <- bypassing the token
    expect(code, WHY).not.toContain('--font-display')
    expect(code, WHY).not.toMatch(/\bfont-display\b/)
    expect(code, WHY).not.toMatch(/style=\{DISPLAY\}/)
    expect(code, WHY).not.toMatch(/\bfont-serif\b/)
    expect(code, WHY).not.toMatch(/Newsreader/i)
  })

  it('still renders both consent choices as buttons', () => {
    // The guard above is satisfiable by deleting the buttons, which would be a
    // far worse outcome than the defect. Pin what must still be there so the
    // cheap way to green is not also the broken way. Both labels, both
    // handlers, and the two consent types the API and root.tsx read back.
    expect(code).toContain('Accept all')
    expect(code).toContain('Essential only')
    expect(code).toContain("accept('all')")
    expect(code).toContain("accept('essential_only')")
    expect(code.match(/<button/g) ?? []).toHaveLength(2)
  })

  it('keeps the banner a dialog with focus moved into it', () => {
    // WCAG 4.1.2, already load-bearing in this component and easy to lose in a
    // restyle of the very buttons this guard is about: firstButtonRef is on the
    // button, so a button rewrite is exactly when it goes missing.
    expect(code).toContain('role="dialog"')
    expect(code).toContain('aria-modal="true"')
    expect(code).toContain('ref={firstButtonRef}')
  })
})
