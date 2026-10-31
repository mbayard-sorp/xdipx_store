import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Guards for the two rail-header defects the design-critic gate measured on the
 * live homepage in Routine B run 1571 and run 1703 fixed (ticket #16879a).
 *
 * 1. THE FLEX-WRAP THAT COULD NOT WRAP. The header row has carried
 *    `flex flex-wrap ... gap-4` since ticket #468, with a comment promising the
 *    CTA "drops onto its own row instead of colliding with the heading at
 *    narrow widths". It never could: the heading column was `min-w-0 flex-1`,
 *    so it absorbed every pixel of available shrink and the row never
 *    overflowed, which is the only thing that makes a wrap happen. The
 *    heading's own TEXT wrapped instead, putting its last line on the same
 *    baseline as the See-all. Measured at 375 on the Under-$30 rail: heading
 *    last line ended at x≈248, See-all began at x≈269 — 21px horizontal, zero
 *    vertical. `basis-full sm:basis-auto sm:flex-1` is what produces the drop.
 *
 * 2. THE ARROW STRIPPED WHERE NOTHING DOUBLED IT. Run 905 correctly stripped a
 *    trailing → from a carousel rail's CTA label, because the carousel renders
 *    its own circular → scroll button right beside it and the two read as a
 *    doubled arrow. But those buttons are `hidden sm:flex`. Below `sm` there is
 *    no button to double against, so the strip removed the arrow for nothing —
 *    the one carousel rail on the live page lost its arrow at 375 while all
 *    nine grid-layout See-alls kept theirs, and a whitelist CTA rendered in a
 *    form the whitelist does not carry ("Take a peek →" includes the arrow).
 *
 * Both fixes switch at `sm`, which is not a coincidence worth losing: `sm` is
 * where the scroll buttons appear, so the two-row stack and the arrow strip
 * turn on and off together. A future edit that moves one breakpoint without the
 * other reintroduces one of the two defects, which is why the third test below
 * asserts they agree rather than only asserting each in isolation.
 *
 * WHAT THESE GUARDS CANNOT SEE, stated rather than implied: they read source
 * text, so they assert the class and label CONTRACT, not rendered geometry. The
 * collision itself was measured from pixels by the gate and cannot be re-measured
 * here — the Vercel preview is SSO-gated and unreachable from a cloud routine
 * (ticket #11087), so a branch capture is not available to prove the fix
 * visually. A regression that reproduces the overlap by some other route (a
 * longer heading at a width between breakpoints, a Sanity ctaLabel long enough
 * to overflow on its own row) stays green here.
 */
describe('ProductCarousel.tsx — the rail header row at the 375 floor', () => {
  const source = readFileSync(fileURLToPath(new URL('./ProductCarousel.tsx', import.meta.url)), 'utf8')
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  const WHY_WRAP =
    'ticket #16879a: with flex-1 on the heading column the header row can never overflow, so flex-wrap never fires and the heading text collides with the See-all on a shared baseline at 375. basis-full below sm is what makes the CTA drop to its own row.'
  const WHY_ARROW =
    'ticket #16879a: the carousel scroll buttons are hidden below sm, so stripping the CTA label arrow there removes it for nothing and renders a whitelist CTA without the arrow the whitelist carries.'

  it('gives the heading column a full basis below sm so the CTA drops to its own row', () => {
    // Assert the mechanism, not just the presence of flex-wrap. flex-wrap was
    // already there for the entire life of the defect, so asserting it would
    // have passed green against the bug.
    expect(code, WHY_WRAP).toContain('basis-full sm:basis-auto sm:flex-1')
    // And the shape that caused it must not come back. Per ticket #16885, the
    // plausible regressions are not just the literal string that shipped:
    // an unprefixed `flex-1`, `grow`, or `w-auto` on this column all restore
    // the shrink-absorbing behaviour. Checked against the header column's own
    // class attribute rather than the file, since `flex-1` is legitimate
    // elsewhere in the component.
    const headerCol = code.match(/<div className="min-w-0[^"]*"/)
    expect(headerCol, 'the header heading column was not found — this guard would silently assert nothing').not.toBeNull()
    const cls = headerCol![0]
    expect(cls, WHY_WRAP).not.toMatch(/(^|\s)flex-1(\s|")/)
    expect(cls, WHY_WRAP).not.toMatch(/(^|\s)grow(\s|")/)
  })

  it('restores the stripped arrow below sm, where no scroll button doubles it', () => {
    expect(code, WHY_ARROW).toContain('arrowStrippedForCarousel')
    // The restore must be mobile-only. Without the breakpoint it reintroduces
    // run 905's doubled arrow at desktop, so the class is load-bearing and is
    // asserted on the same element as the glyph rather than anywhere in file.
    expect(code, WHY_ARROW).toMatch(/aria-hidden="true" className="sm:hidden">\{' →'\}<\/span>/)
    // The strip itself must survive: the cheap way to green on the assertion
    // above is to stop stripping at all, which is the defect run 905 fixed.
    expect(code, 'run 905: a carousel ctaLabel carrying its own arrow abuts the → scroll button and reads as a doubled arrow').toContain(
      "layout === 'carousel' ? ctaLabel.replace(",
    )
  })

  it('switches both at sm, the breakpoint where the scroll buttons appear', () => {
    // The two fixes are only correct relative to each other. If the scroll
    // buttons ever move to `md:flex`, then at 640-767px there is no button and
    // the arrow is still stripped (defect 2 returns, narrower), AND the header
    // is back on one row (defect 1 returns, narrower). Pin the agreement so
    // that edit fails here instead of shipping two silent regressions.
    expect(code, 'the scroll buttons must appear at sm for the two sm-keyed fixes above to line up').toContain(
      'hidden sm:flex items-center justify-center w-9 h-9',
    )
  })
})
