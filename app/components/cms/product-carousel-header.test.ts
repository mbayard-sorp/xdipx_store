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

  it('the heading column can shrink (min-w-0 flex-1)', () => {
    expect(src).toContain('min-w-0 flex-1')
  })

  it('the CTA stays a single unbroken line', () => {
    // whitespace-nowrap keeps the label on one line; shrink-0 stops it being
    // squeezed. Both must be present on the CTA link.
    const ctaLine = src.split('\n').find(l => l.includes('shrink-0 whitespace-nowrap'))
    expect(ctaLine, 'CTA link is missing shrink-0 whitespace-nowrap').toBeTruthy()
  })
})
