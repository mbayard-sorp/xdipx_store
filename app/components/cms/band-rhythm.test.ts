import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Band rhythm on the storefront doctrine surface.
 *
 * design-doctrine.md §1: "Section padding: `py-16 md:py-20` is the standard
 * band rhythm... One rhythm per page. Do not scatter arbitrary paddings."
 *
 * This has now been broken twice by the same mechanism, which is why it gets a
 * guard rather than a third comment. Ticket #8418 found three published
 * `emmaCuratedRail` blocks measuring 48px against the 64/80 scale and moved
 * `ProductCarousel`'s storefront chrome onto the rhythm. Ticket #12340 then
 * added the Emma-aside band ABOVE the rail as its own ground div, and it
 * arrived carrying a flat `pt-10` — 40px, with no responsive variant, so the
 * four published aside-led rails opened 45px below their ground boundary at
 * 375, 768 and 1440 alike while every other band opened at 68/84px. Off the
 * scale and breakpoint-deaf. Measured at all three viewports by the
 * design-critic gate in Routine B run 1571 and traced to the source line.
 *
 * The lesson both tickets share: a band's opening padding is easy to set by
 * eye on a new wrapper, and nothing renders wrong enough to notice. So the
 * scale is pinned here instead.
 */

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** Both files document their retired padding values by name, so every
 *  assertion here reads code only. A guard that fires on its own changelog is
 *  a guard the next person deletes. */
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const WHY = 'design-doctrine.md §1 sets ONE band rhythm for the page: py-16 md:py-20 (64/80px). A hand-picked padding on a storefront band is the #8418 / #12340 defect recurring. If the rhythm itself is changing, change the doctrine first.'

describe('storefront band rhythm (doctrine §1)', () => {
  it('opens the Emma aside band on the doctrine scale, responsively', () => {
    const code = codeOf('./EmmaCuratedRail.tsx')
    expect(code, WHY).toContain('pt-16 md:pt-20')
    // The specific regression: a flat pt-10 with no md: variant.
    expect(code, WHY).not.toMatch(/\bpt-10\b/)
  })

  it('keeps the rail section itself on the rhythm and off the legacy py-12', () => {
    expect(codeOf('./ProductCarousel.tsx'), WHY).toContain("storefront ? 'py-16 md:py-20'")
  })

  it('scatters no off-scale vertical padding on the STOREFRONT band paths', () => {
    // Catches the middle of the range (pt-10, pt-14 and friends), which is
    // where both previous regressions landed: those read as plausible band
    // padding while sitting off the 64/80 scale.
    //
    // ONE deliberate remaining instance, pinned rather than swept: the
    // `py-12 px-4` on ProductCarousel's LEGACY chrome branch. #8418 moved only
    // the storefront path onto the doctrine rhythm and deliberately left
    // ForHim/ForHer and the deferred daily-deal home alone, so py-12 there is
    // a correct value and not drift. Pinning it is the point -- a sweep that
    // flagged it would teach the next reader to widen the regex instead of
    // reading the ticket, and would invite "fixing" a legacy surface this
    // doctrine does not govern.
    const LEGACY_CHROME = "'py-12 px-4'"
    const offScale = /\bp[tby]-(?:9|10|11|12|13|14|15|17|18|19)\b/g
    for (const file of ['./EmmaCuratedRail.tsx', './ProductCarousel.tsx']) {
      const code = codeOf(file).replace(LEGACY_CHROME, "'<legacy chrome>'")
      expect(code.match(offScale) ?? [], `${file}: ${WHY}`).toEqual([])
    }
    // And assert the pinned instance is still THERE, so a later edit that
    // quietly retires legacy chrome makes this test say so out loud.
    expect(codeOf('./ProductCarousel.tsx')).toContain(LEGACY_CHROME)
  })
})
