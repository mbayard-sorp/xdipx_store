import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrustStrip, TRUST_STRIP_FALLBACK, orphanSpanClass } from './TrustStrip'
import type { TrustBarBlock } from '~/types/cms'

/**
 * Trust-strip orphan guard, spanning BOTH variants.
 *
 * THE CAUSAL TRACE (playbook run-1703 rule): below `md` both variants render
 * `grid-cols-2`. With an odd item count the final item occupies column 1 of the
 * last row and column 2 is empty. `col-span-2` is the class that makes that
 * item fill the row, so its ABSENCE is literally the empty cell. That is the
 * pixel, and it was measured twice: design-critic run 1967 on the homepage
 * `band` variant, and run 2093 on `/collections/pleasure`, where the `card`
 * variant's void measured 141 x 37 px at (200, 4997) ENCLOSED by that variant's
 * border, so it reads as a missing fifth item.
 *
 * WHY THIS TEST SPANS BOTH VARIANTS (playbook run-1298 rule: a guard spans
 * every surface the fix spans). The 1967 fix was written against a homepage
 * screenshot and applied to `band` only, while `card` twelve lines above kept
 * the defect for a week. A per-variant guard would have passed throughout. The
 * `card` case is the worse one, because collection pages pass no `trustBar` and
 * therefore ALWAYS get the odd-length fallback.
 */

const fourItems = {
  trustItems: [
    { headline: 'Ships in plain packaging', active: true },
    { headline: 'Your statement reads XDIPX', active: true },
    { headline: 'Hand-checked, not auto-listed', active: true },
    { headline: '30-day returns', active: true },
  ],
} as unknown as TrustBarBlock

const VARIANTS = ['band', 'card'] as const

describe('orphanSpanClass', () => {
  it('spans only the trailing item of an odd-length set', () => {
    expect(orphanSpanClass(4, 5)).toBe('col-span-2 md:col-span-1')
    for (const i of [0, 1, 2, 3]) expect(orphanSpanClass(i, 5)).toBe('')
  })

  it('spans nothing in an even-length set', () => {
    for (const i of [0, 1, 2, 3]) expect(orphanSpanClass(i, 4)).toBe('')
  })

  it('always restores the single-cell span at md, so the 5-col row is intact', () => {
    // Without `md:col-span-1` the spanned item would eat two of the five
    // desktop columns, which is a different defect at a different width.
    expect(orphanSpanClass(4, 5)).toContain('md:col-span-1')
  })

  it('handles the degenerate counts without spanning something that is alone anyway', () => {
    expect(orphanSpanClass(0, 1)).toBe('col-span-2 md:col-span-1')
    expect(orphanSpanClass(0, 0)).toBe('')
  })
})

describe('the fallback both unpublished surfaces fall through to', () => {
  it('is odd-length, which is what makes the orphan deterministic', () => {
    // If this ever becomes even, the `card` variant stops exercising the
    // orphan path and the guard below silently stops proving anything.
    expect(TRUST_STRIP_FALLBACK.length % 2).toBe(1)
  })
})

describe.each(VARIANTS)('TrustStrip variant=%s', variant => {
  it('spans the orphaned trailing item when the set is odd', () => {
    const html = renderToStaticMarkup(<TrustStrip variant={variant} />)
    const last = TRUST_STRIP_FALLBACK[TRUST_STRIP_FALLBACK.length - 1]!.headline
    // The spanning class must sit on the element that carries the last item.
    const cell = html.split('<div class="flex items-start').find(c => c.includes(last))
    expect(cell, `no cell rendered ${last}`).toBeDefined()
    expect(cell).toContain('col-span-2')
    expect(cell).toContain('md:col-span-1')
  })

  it('spans nothing when the published set is even', () => {
    const html = renderToStaticMarkup(<TrustStrip variant={variant} trustBar={fourItems} />)
    expect(html).not.toContain('col-span-2')
  })

  it('still renders every item exactly once', () => {
    const html = renderToStaticMarkup(<TrustStrip variant={variant} />)
    for (const item of TRUST_STRIP_FALLBACK) {
      expect(html.split(item.headline).length - 1, item.headline).toBe(1)
    }
  })
})

describe('neither variant hand-rolls the rule', () => {
  it('routes both grids through the one helper', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./TrustStrip.tsx', import.meta.url), 'utf8'),
    )
    // #16885, other shapes: a re-inlined `isOrphan` local, or a literal
    // `col-span-2` typed into either branch, both reintroduce the drift this
    // helper exists to prevent.
    expect(source).not.toMatch(/const isOrphan/)
    const literals = source.match(/'col-span-2 md:col-span-1'/g) ?? []
    expect(literals).toHaveLength(1)
    const calls = source.match(/orphanSpanClass\(i, items\.length\)/g) ?? []
    expect(calls).toHaveLength(VARIANTS.length)
  })
})
