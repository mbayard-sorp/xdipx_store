import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * ProductCarousel header collision (ticket #468). At 390px the rail heading used
 * to squeeze the "See all →" CTA until it wrapped mid-phrase and overlapped the
 * heading. The fix is layout-only: the header row wraps, the heading column can
 * shrink, and the CTA stays a single unbroken line. This is a visual bug with no
 * screenshot gate available in scheduled runs, so we pin the CSS mechanism at
 * the source level — the exact classes that make the collision impossible.
 *
 * CORRECTED 2026-10-28, Routine B run 1703 (ticket #16879a), and the correction
 * is the interesting part. The sentence above — "the exact classes that make the
 * collision impossible" — was not true of the classes this file actually pinned.
 * It asserted `min-w-0 flex-1` on the heading column, and `flex-1` is precisely
 * what made the collision INEVITABLE: it let the heading column absorb every
 * pixel of available shrink, so the header row never overflowed and the
 * `flex-wrap` beside it could never fire. The row did not wrap; the heading's
 * TEXT wrapped, and its last line landed on the CTA's baseline.
 *
 * So this guard sat green for the entire life of the defect it was written to
 * prevent, because it pinned the cause as though it were the cure. The
 * design-critic gate measured the collision still live at 375 on 2026-10-21
 * (run 1571): heading last line ending x≈248, See-all beginning x≈269, 21px
 * horizontal clearance, zero vertical. Three years of green.
 *
 * The lesson is one step past the playbook's #16885 rule (check a new guard
 * against the OTHER shapes the same defect could take). A guard can also pin
 * the wrong MECHANISM outright, and then it does not merely miss regressions —
 * it actively certifies the bug, and it resists the fix, which is how this
 * correction was discovered: the real fix turned this test red. If a guard
 * cannot be traced from the class it pins to the pixel it prevents, it is a
 * comment with an assertion attached.
 */

const src = readFileSync(
  fileURLToPath(new URL('./ProductCarousel.tsx', import.meta.url)),
  'utf-8',
)

describe('ProductCarousel header never collides with its CTA', () => {
  it('the header row wraps and gaps instead of overlapping', () => {
    const headerLine = src
      .split('\n')
      .find(l => l.includes('items-end') && l.includes('justify-between'))
    expect(headerLine, 'header flex row not found').toBeTruthy()
    expect(headerLine!).toContain('flex-wrap')
    expect(headerLine!).toContain('gap-4')
  })

  it('the heading column can shrink, and takes the whole row below sm', () => {
    // min-w-0 still matters: without it the column refuses to shrink below its
    // content width at sm and up, and the CTA gets squeezed instead.
    expect(src, 'the heading column must still be allowed to shrink at sm and up').toContain('min-w-0')
    // But shrinking ALONE is what caused the collision, because a column that
    // keeps shrinking never lets the row overflow, and a row that never
    // overflows never wraps. Below sm the column takes the full basis so the
    // CTA is pushed onto its own line, which is the behaviour #468's own
    // comment always described and never actually produced.
    expect(src, 'see this file\'s header: flex-1 was the cause, not the cure').toContain(
      'min-w-0 basis-full sm:basis-auto sm:flex-1',
    )
  })

  it('the CTA stays a single unbroken line', () => {
    // whitespace-nowrap keeps the label on one line; shrink-0 stops it being
    // squeezed. Both must be present on the CTA link.
    const ctaLine = src.split('\n').find(l => l.includes('shrink-0 whitespace-nowrap'))
    expect(ctaLine, 'CTA link is missing shrink-0 whitespace-nowrap').toBeTruthy()
  })
})
