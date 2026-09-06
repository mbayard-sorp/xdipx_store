/**
 * TrustBar SSR-duplication guard.
 *
 * The trust strip used to render two lists — a desktop static row plus a mobile
 * marquee whose track was `[...visible, ...visible]` — so the server HTML of
 * every page carried the same trust copy THREE times. On a PDP with roughly 230
 * unique words that block was ~29% of the indexable text, and it made unrelated
 * PDPs look like near-duplicates of one another: GSC "Duplicate, Google chose
 * different canonical than user" went from 376 URLs on 2026-08-13 to 1,080 on
 * 2026-09-06, including pages demoted out of "Submitted and indexed".
 *
 * The fix is only meaningful if it holds, and it is easy to undo by innocently
 * re-adding a second list for a layout tweak. So this test asserts the invariant
 * on the SERVER markup, which is what a crawler parses: each headline and each
 * subheadline appears exactly once. The marquee's loop duplicate is appended
 * client-side after mount, so it must never show up here.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrustBar } from './TrustBar'
import type { TrustItem } from '~/types/cms'

const ITEMS = [
  { headline: 'Your statement reads XDIPX', subheadline: 'Nothing on the bill names a product.' },
  { headline: 'Ships in plain packaging', subheadline: 'Plain box, plain label.' },
  { headline: 'Free US shipping over $99', subheadline: 'Ships from Michigan and Arizona.' },
  { headline: '30-day returns' },
] as unknown as TrustItem[]

/** Count non-overlapping occurrences of a literal needle in the markup. */
function count(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length) }
  return n
}

describe('TrustBar server markup', () => {
  for (const frameless of [false, true]) {
    it(`emits every headline and subheadline exactly once (frameless=${frameless})`, () => {
      const html = renderToStaticMarkup(<TrustBar items={ITEMS} frameless={frameless} />)
      for (const item of ITEMS as unknown as Array<{ headline: string; subheadline?: string }>) {
        expect(count(html, item.headline), `headline: ${item.headline}`).toBe(1)
        if (item.subheadline) {
          expect(count(html, item.subheadline), `subheadline: ${item.subheadline}`).toBe(1)
        }
      }
    })
  }

  it('renders a single list element rather than one per breakpoint', () => {
    const html = renderToStaticMarkup(<TrustBar items={ITEMS} />)
    expect(count(html, '<ul')).toBe(1)
  })

  it('ships no marquee animation before hydration, since the loop copy is absent', () => {
    const html = renderToStaticMarkup(<TrustBar items={ITEMS} />)
    expect(html).not.toContain('animate-marquee')
  })

  it('renders one <li> per item, with no loop duplicates', () => {
    const html = renderToStaticMarkup(<TrustBar items={ITEMS} />)
    expect(count(html, '<li')).toBe(ITEMS.length)
  })

  it('drops null and inactive items, and renders nothing when none survive', () => {
    const mixed = [ITEMS[0], null, { headline: 'Hidden', active: false }] as unknown as TrustItem[]
    const html = renderToStaticMarkup(<TrustBar items={mixed} />)
    expect(count(html, 'Your statement reads XDIPX')).toBe(1)
    expect(html).not.toContain('Hidden')

    expect(renderToStaticMarkup(<TrustBar items={[] as unknown as TrustItem[]} />)).toBe('')
  })
})
