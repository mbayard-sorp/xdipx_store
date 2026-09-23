import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Brand-token drift guard for the reviews surface (Routine B run 1034).
 *
 * Ticket #3789 (2026-08-19) darkened three brand tokens to clear WCAG AA after
 * an axe sweep found them failing as text: coral #FF5A36 -> #C2350F, sage
 * #7C8F78 -> #596756, ink-4 #9A8F97 -> #726673. Ticket #9681 then swept the
 * pre-#3789 values out of three non-CSS places (the wordmark asset,
 * og-card.server.ts, the design-gallery swatch). It missed this sibling class:
 * the reviews components paint brand sage as an INLINE HEX rather than a token,
 * so they kept the old value.
 *
 * The drift survived two sweeps because neither could see it:
 *   - the CSS/token sweep looks at `app/app.css` and at token names, and these
 *     are raw hex literals inside a `style={{ }}` object;
 *   - the axe harness (`tests/visual/axe.visual.ts`) cannot flag the worst of
 *     them, because the reviewer-initials avatar is `aria-hidden="true"`, so
 *     the contrast rule never evaluates it even though sighted users read it.
 *
 * Measured: white on #7C8F78 is 3.47:1, under the 4.5:1 that design-doctrine
 * §3 "Contrast floor" requires for text below 24px (the avatar initials are
 * `text-sm font-bold`). White on the shipped #596756 is 6.00:1.
 *
 * These read the shipped source and pin the RULE — brand sage on this surface
 * comes from the token, never from a hex literal — in the same style as the
 * sibling guard in `app/components/store/coral-budget-pdp.test.ts`.
 *
 * Deliberately NOT covered, so a later sweep does not "fix" them into bugs:
 *   - `CircleOptionSelector.tsx` / `VariantSelector.tsx` / `swatches.server.ts`
 *     map a PRODUCT VARIANT colour label ("sage") to a swatch hex. Those are
 *     physical product colours, not the brand token, and retinting them would
 *     misrepresent the goods.
 *   - `InviteFunnel.tsx` is an admin funnel chart whose four series colours are
 *     a data-viz ramp, not brand tokens; recolouring one of four in isolation
 *     would break the ramp. It is filed separately rather than half-fixed here.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

/** Pre-#3789 brand values. Any of these in customer-facing source is the bug. */
const RETIRED_BRAND_HEXES = ['#7C8F78', '#FF5A36', '#9A8F97']

const REVIEWS_SOURCES = [
  './ReviewCard.tsx',
  './ReviewDrawer.tsx',
  './RatingSummary.tsx',
  './ReviewForm.tsx',
  './ReviewList.tsx',
]

describe('reviews surface — no pre-#3789 brand hexes survive', () => {
  for (const rel of REVIEWS_SOURCES) {
    it(`${rel} carries no retired brand hex`, () => {
      const src = read(rel)
      for (const hex of RETIRED_BRAND_HEXES) {
        const found = src.toUpperCase().includes(hex)
        expect(
          found,
          `${rel} still hardcodes ${hex}, a value ticket #3789 retired for failing WCAG AA. Use var(--color-sage) / var(--color-coral) so app.css stays the source of truth.`,
        ).toBe(false)
      }
    })
  }

  it('the reviewer-initials avatar draws its ground from the sage token', () => {
    // aria-hidden hides this element from the axe sweep, so the test is the
    // only thing that can catch white-on-sage dropping under 4.5:1 again.
    for (const rel of ['./ReviewCard.tsx', './ReviewDrawer.tsx']) {
      const src = read(rel)
      const avatarLine = src.split('\n').find(l => l.includes('fontFamily') && l.includes('background'))
      expect(avatarLine, `${rel}: avatar style line not found — did the markup change?`).toBeTruthy()
      expect(avatarLine!).toContain('var(--color-sage)')
    }
  })

  it('the rating histogram bar draws its fill from the sage token', () => {
    const src = read('./RatingSummary.tsx')
    expect(src).toContain("background: 'var(--color-sage)'")
  })
})
