import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PHOTO_SCRIM_STYLE } from './StorefrontHome'

/**
 * Guard for ticket #8417 (design-critic, run 778): five measured WCAG AA
 * failures on the homepage, all one root cause. The No05 promo tile and the
 * Nº 08 couples PhotoBand each overlaid text on a CMS photo with a
 * `linear-gradient(to top, rgba(26,20,24,0.72), rgba(26,20,24,0.05) 55%)`
 * scrim that fades to near-transparent past its 55% stop. Variable-length CMS
 * copy (a wrapped heading + body at 375px) routinely grows taller than that
 * stop, so its upper lines land on almost-bare photo — measured live at
 * 1.03:1 for the plum `.em-on-dark` emphasis word, well under every floor.
 *
 * The fix is a single shared PHOTO_SCRIM_STYLE constant whose alpha floor
 * never drops low enough to fail, at either end of the gradient, so the fix
 * cannot regress by a future edit narrowing the dark band back down, and a
 * future band cannot reintroduce a hand-typed, unprotected gradient.
 */

function srgbToLinear(c: number) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: [number, number, number]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrast(rgb1: [number, number, number], rgb2: [number, number, number]) {
  const l1 = luminance(rgb1)
  const l2 = luminance(rgb2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Alpha-composite `fg` over `bg` at `alpha`, per channel. */
function over(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return [
    alpha * fg[0] + (1 - alpha) * bg[0],
    alpha * fg[1] + (1 - alpha) * bg[1],
    alpha * fg[2] + (1 - alpha) * bg[2],
  ]
}

const INK: [number, number, number] = [26, 20, 24]
const WHITE: [number, number, number] = [255, 255, 255]
/** --color-plum-on-dark, app.css line 56. */
const PLUM_ON_DARK: [number, number, number] = [0xb9, 0x8b, 0xde]

/** Every rgba(26,20,24,<alpha>) stop the gradient carries. */
function scrimAlphas(gradient: string): number[] {
  const matches = [...gradient.matchAll(/rgba\(\s*26\s*,\s*20\s*,\s*24\s*,\s*([\d.]+)\s*\)/g)]
  return matches.map((m) => Number(m[1]))
}

describe('PHOTO_SCRIM_STYLE — contrast floor over worst-case (pure white) photo', () => {
  const alphas = scrimAlphas(PHOTO_SCRIM_STYLE)

  it('has at least two stops and is anchored on the ink token', () => {
    expect(alphas.length).toBeGreaterThanOrEqual(2)
  })

  it('never dips low enough, at either stop, to fail the worst-case floor', () => {
    // Solved against a pure-white photo pixel: alpha 0.78 is the first value
    // that clears every floor below (with margin). Anything at or above that
    // for EVERY stop keeps the whole gradient — not just its darkest point —
    // safe, which is what makes the fix alignment-agnostic.
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0.78)
    }
  })

  it('clears the doctrine body-text floor (4.5:1) for white/85 copy at the weakest stop', () => {
    const weakestAlpha = Math.min(...alphas)
    const scrimmedBg = over(INK, weakestAlpha, WHITE)
    const bodyText = over(WHITE, 0.85, scrimmedBg) // text-white/85, as PhotoBand's body copy renders
    expect(contrast(bodyText, scrimmedBg)).toBeGreaterThanOrEqual(4.5)
  })

  it('clears the doctrine large-display floor (3:1) for a full-white heading at the weakest stop', () => {
    const weakestAlpha = Math.min(...alphas)
    const scrimmedBg = over(INK, weakestAlpha, WHITE)
    expect(contrast(WHITE, scrimmedBg)).toBeGreaterThanOrEqual(3.0)
  })

  it('clears the doctrine large-display floor (3:1) for the plum .em-on-dark emphasis word at the weakest stop', () => {
    // This is the exact failure design-critic measured at 1.03:1 on the live
    // page: the emphasis word sat on the near-transparent end of the old
    // fade. Kept here as its own assertion, not folded into the white-text
    // check above, because plum-on-dark clears the floor with far less
    // margin than white text does at the same alpha.
    const weakestAlpha = Math.min(...alphas)
    const scrimmedBg = over(INK, weakestAlpha, WHITE)
    expect(contrast(PLUM_ON_DARK, scrimmedBg)).toBeGreaterThanOrEqual(3.0)
  })
})

describe('StorefrontHome.tsx — every photo scrim goes through the shared constant', () => {
  const source = readFileSync(fileURLToPath(new URL('./StorefrontHome.tsx', import.meta.url)), 'utf8')

  it('defines PHOTO_SCRIM_STYLE exactly once', () => {
    const defs = source.match(/PHOTO_SCRIM_STYLE\s*=\s*['"]linear-gradient/g) ?? []
    expect(defs).toHaveLength(1)
  })

  it('has no hand-typed rgba(26,20,24,…) gradient outside that one definition', () => {
    // Every scrim div is `style={{ background: PHOTO_SCRIM_STYLE }}`. A future
    // band that pastes a literal gradient back in (the exact regression this
    // ticket fixes) reintroduces a second, unguarded rgba(26,20,24,…) literal.
    const literalGradients = source.match(/background:\s*['"]linear-gradient\([^)]*rgba\(26,\s*20,\s*24/g) ?? []
    expect(literalGradients).toHaveLength(0)
  })

  it('both the No05 promo tile and the Nº 08 PhotoBand reference the shared constant', () => {
    const usages = source.match(/background:\s*PHOTO_SCRIM_STYLE/g) ?? []
    expect(usages).toHaveLength(2)
  })

  // ── Placement, added by run 2093 ──────────────────────────────────────────
  //
  // The assertions above pin the scrim's ALPHA FLOOR and its USAGE COUNT. They
  // do not pin WHERE it is painted, and that gap was not theoretical: ticket
  // #21294 is precisely a scrim painted in the wrong place, and run 2093
  // confirmed the hole by restoring the defect (moving the promo's scrim back
  // onto an `absolute inset-0` div) and watching all eight assertions in this
  // file stay green.
  //
  // The causal trace: `absolute inset-0` + this gradient covers the WHOLE
  // photo, so the top of the frame is darkened to roughly 18% of white, where
  // doctrine §3 wants the top 40-45% untouched. design-critic measured exactly
  // that on the live promo band (mean luminance 57.8 at 1440, 65.9 at 375, top
  // of frame 47.0) against the already-fixed couples band at 109.1 on the same
  // page. Painting the gradient on the TEXT COLUMN instead covers only what the
  // copy occupies, which is why the alpha floor above can stay exactly as it is:
  // the fix shrinks the covered AREA, never the floor, so the #8417 regression
  // (wrapped CMS copy past a `transparent 55%` stop, plum emphasis at 1.03:1)
  // cannot come back through this door.
  it('never paints the scrim across a whole image via an inset-0 overlay', () => {
    // Both orderings, since the style prop can precede or follow the className.
    expect(source).not.toMatch(/absolute inset-0[^>]*?PHOTO_SCRIM_STYLE/s)
    expect(source).not.toMatch(/PHOTO_SCRIM_STYLE[^>]*?absolute inset-0/s)
  })

  it('paints both scrims on a text column that bleeds its own box', () => {
    // The negative-margin/padding pair is what extends coverage past the
    // glyphs without resizing the column in its flex row. A usage without it
    // is a scrim clamped to the text's tight bounding box, which clips.
    const bleeds = source.match(/-my-5 rounded-\[var\(--radius-lg\)\] py-5 md:-my-7 md:py-7/g) ?? []
    expect(bleeds).toHaveLength(2)
    // Each scrim is applied conditionally on that band actually having a photo,
    // so a photo-less band keeps its paper ground rather than a dark plate.
    const conditional = source.match(/style=\{has(?:Promo)?Image \? \{ background: PHOTO_SCRIM_STYLE \} : undefined\}/g) ?? []
    expect(conditional).toHaveLength(2)
  })
})
