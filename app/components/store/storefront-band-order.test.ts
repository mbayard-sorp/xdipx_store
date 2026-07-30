import { describe, it, expect } from 'vitest'
import { BAND_NAMES, DEFAULT_BAND_ORDER, resolveBandOrder, emphasisParts } from './StorefrontHome'

/**
 * The storefront's band order used to be implicit in the JSX. Now it is data,
 * which is what lets Sanity supply an order later. These tests pin the shipped
 * arrangement so that change cannot happen silently: the homepage's section
 * order is a locked shell (docs/homepage-team/redesign-v2-spec.md), and the
 * render-truth gate asserts against what this produces.
 */
describe('storefront band order', () => {
  it('renders the locked shell order', () => {
    expect(DEFAULT_BAND_ORDER).toEqual([
      'hero',
      'anchorGrid',
      'teamRails',
      'meetEmma',
      'wayfinder',
      'emmasEdit',
      'sensationMap',
      'couples',
      'stillDeciding',
      'notebook',
      'faq',
      'emailCapture',
    ])
  })

  it('leads with the hero', () => {
    // The hero carries the H1 and the LCP image. Anything else first moves the
    // largest paint element and breaks the zero-CLS contract the page is gated on.
    expect(DEFAULT_BAND_ORDER[0]).toBe('hero')
  })

  it('closes with the email capture', () => {
    // Locked in the original redesign brief: email is always last.
    expect(DEFAULT_BAND_ORDER.at(-1)).toBe('emailCapture')
  })

  it('renders every known band exactly once', () => {
    expect([...DEFAULT_BAND_ORDER].sort()).toEqual([...BAND_NAMES].sort())
    expect(new Set(DEFAULT_BAND_ORDER).size).toBe(DEFAULT_BAND_ORDER.length)
  })
})

describe('resolveBandOrder — Sanity layout to render order', () => {
  const band = (b: string, enabled?: boolean) => ({
    _type: 'homeBand',
    band: b,
    ...(enabled === undefined ? {} : { enabled }),
  })

  it('falls back to the shipped order when there is no layout', () => {
    expect(resolveBandOrder(null)).toEqual(DEFAULT_BAND_ORDER)
    expect(resolveBandOrder(undefined)).toEqual(DEFAULT_BAND_ORDER)
    expect(resolveBandOrder({ sections: [] })).toEqual(DEFAULT_BAND_ORDER)
  })

  it('a layout mirroring the default renders exactly the default', () => {
    // The two-step launch depends on this: publishing a layout that matches
    // today's arrangement must be a visible no-op before anything is reordered.
    const mirrored = { sections: DEFAULT_BAND_ORDER.map(b => band(b)) }
    expect(resolveBandOrder(mirrored)).toEqual(DEFAULT_BAND_ORDER)
  })

  it('honours a reordering', () => {
    const layout = { sections: [band('hero'), band('faq'), band('couples')] }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'faq', 'couples'])
  })

  it('drops bands switched off', () => {
    const layout = { sections: [band('hero'), band('faq', false), band('couples')] }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'couples'])
  })

  it('keeps the hero first even when the layout moves or omits it', () => {
    // The hero owns the H1 and the LCP image. A content edit must not be able
    // to move the largest paint element.
    expect(resolveBandOrder({ sections: [band('faq'), band('hero')] })).toEqual(['hero', 'faq'])
    expect(resolveBandOrder({ sections: [band('faq'), band('couples')] })).toEqual([
      'hero',
      'faq',
      'couples',
    ])
    expect(resolveBandOrder({ sections: [band('hero', false), band('faq')] })).toEqual([
      'hero',
      'faq',
    ])
  })

  it('ignores unknown bands and unknown section types', () => {
    // A layout published against a newer schema degrades to the bands this
    // deploy understands rather than rendering nothing.
    const layout = {
      sections: [
        band('hero'),
        band('somethingFromTheFuture'),
        { _type: 'homeMoodPills', enabled: true },
        band('faq'),
      ],
    }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'faq'])
  })

  it('places the deck where the layout puts its marker', () => {
    const layout = {
      sections: [
        band('hero'),
        { _type: 'panelDeckSection', enabled: true },
        band('anchorGrid'),
      ],
    }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'panelDeck', 'anchorGrid'])
  })

  it('drops a disabled deck marker', () => {
    const layout = {
      sections: [band('hero'), { _type: 'panelDeckSection', enabled: false }, band('faq')],
    }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'faq'])
  })

  it('never lets the deck sit above the hero', () => {
    // Nothing outranks the largest paint element, the deck included.
    const layout = {
      sections: [{ _type: 'panelDeckSection', enabled: true }, band('hero'), band('faq')],
    }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'panelDeck', 'faq'])
  })

  it('renders the deck at most once', () => {
    const layout = {
      sections: [
        band('hero'),
        { _type: 'panelDeckSection', enabled: true },
        { _type: 'panelDeckSection', enabled: true },
        band('faq'),
      ],
    }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'panelDeck', 'faq'])
  })

  it('renders a band at most once', () => {
    const layout = { sections: [band('hero'), band('faq'), band('faq')] }
    expect(resolveBandOrder(layout)).toEqual(['hero', 'faq'])
  })

  it('falls back when a layout contains no usable band', () => {
    // A deck marker alone is not a homepage.
    const layout = { sections: [{ _type: 'panelDeckSection', enabled: true }] }
    expect(resolveBandOrder(layout)).toEqual(DEFAULT_BAND_ORDER)
  })
})

describe('emphasisParts — heading/emphasis split for <EmphasizedHeading>', () => {
  // Ticket #461: a published emphasis word absent from its heading used to
  // render as a stray, unspaced <em> appended to the end of the sentence
  // ("...favorites?safe"). null tells the caller to render the heading plain.
  it('returns null when the emphasis word is absent from the heading', () => {
    expect(emphasisParts('Not sure which glide belongs with your favorites?', 'safe')).toBeNull()
  })

  it('splits around the emphasis word when present', () => {
    expect(emphasisParts('Find your way in.', 'way')).toEqual({
      before: 'Find your ',
      match: 'way',
      after: ' in.',
    })
  })

  // A heading containing the emphasis word twice must not be truncated: the
  // old String.split() produced 3+ parts and everything past index 1 was
  // silently dropped.
  it('does not truncate a heading containing the emphasis word twice', () => {
    const parts = emphasisParts('Stay safe, stay safe with us.', 'safe')
    expect(parts).not.toBeNull()
    expect(parts!.before + parts!.match + parts!.after).toBe('Stay safe, stay safe with us.')
    expect(parts!.after).toContain('safe')
  })
})
