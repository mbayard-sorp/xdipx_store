import { describe, it, expect } from 'vitest'
import {
  railsSlateFingerprint,
  evaluateRailsFreshness,
  RENDERED_RAILS,
  railsSlotFingerprint,
  deckSlotFingerprint,
  heroSlotFingerprint,
  couplesSlotFingerprint,
  evaluateMerchFreshness,
  parseMustChangeSlots,
} from './rails-freshness'

describe('railsSlateFingerprint', () => {
  it('joins trimmed headings with a pipe, in order', () => {
    expect(railsSlateFingerprint(['  Warm up slow  ', 'For the two of you'])).toBe(
      'Warm up slow|For the two of you',
    )
  })

  it('is order-sensitive (a reorder is a different slate)', () => {
    expect(railsSlateFingerprint(['A', 'B'])).not.toBe(railsSlateFingerprint(['B', 'A']))
  })

  it('drops empty/whitespace headings AFTER taking the first `max`, matching the healthcheck', () => {
    // Five rails; the 4th (within the rendered window) is blank, the 5th is
    // beyond the window. Result: headings 1,2,3 only.
    expect(railsSlateFingerprint(['A', 'B', 'C', '   ', 'E'], 4)).toBe('A|B|C')
  })

  it('never looks past the rendered window', () => {
    expect(railsSlateFingerprint(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A|B|C|D')
    expect(RENDERED_RAILS).toBe(4)
  })

  it('is empty for an empty slate', () => {
    expect(railsSlateFingerprint([])).toBe('')
    expect(railsSlateFingerprint(['', '  '])).toBe('')
  })
})

describe('evaluateRailsFreshness', () => {
  it('is fresh when the slate changed', () => {
    const v = evaluateRailsFreshness('A|B', 'A|C')
    expect(v.fresh).toBe(true)
    expect(v.reason).toMatch(/changed/)
  })

  it('is NOT fresh when byte-identical to the baseline', () => {
    const v = evaluateRailsFreshness('A|B', 'A|B')
    expect(v.fresh).toBe(false)
    expect(v.reason).toMatch(/byte-identical/)
  })

  it('treats a null baseline as fresh (first run is never falsely blocked)', () => {
    expect(evaluateRailsFreshness(null, 'A|B').fresh).toBe(true)
  })

  it('is NOT fresh when the current slate is empty, even against a null baseline', () => {
    const v = evaluateRailsFreshness(null, '')
    expect(v.fresh).toBe(false)
    expect(v.reason).toMatch(/empty/)
  })

  it('carries both fingerprints for the run log', () => {
    const v = evaluateRailsFreshness('A|B', 'A|C')
    expect(v.previous).toBe('A|B')
    expect(v.current).toBe('A|C')
  })
})

describe('railsSlotFingerprint (ticket #3531)', () => {
  const rail = (key: string, heading: string, handles: string[]) => ({ key, heading, handles })

  it('moves when a product swaps inside a rail even with the heading unchanged', () => {
    const before = railsSlotFingerprint([rail('k1', 'Warm up slow', ['a', 'b'])])
    const after = railsSlotFingerprint([rail('k1', 'Warm up slow', ['a', 'c'])])
    expect(before).not.toBe(after)
  })

  it('encodes key, heading, and handles per rail', () => {
    expect(railsSlotFingerprint([rail('k1', ' H ', ['a', 'b'])])).toBe('k1#H#a,b')
  })

  it('drops fully-empty rails and respects the rendered window', () => {
    const rails = [rail('k1', 'A', []), rail('k2', '', []), rail('k3', 'C', ['x']), rail('k4', 'D', []), rail('k5', 'E', [])]
    expect(railsSlotFingerprint(rails, 4)).toBe('k1#A#|k3#C#x|k4#D#')
  })
})

describe('deckSlotFingerprint', () => {
  it('is empty when no deck is published', () => {
    expect(deckSlotFingerprint(null, [])).toBe('')
  })

  it('moves on a tile label or destination change, and on a republish stamp', () => {
    const a = deckSlotFingerprint('2026-08-16T00:00:00Z', [{ label: 'Doors', destination: '/collections/x' }])
    const b = deckSlotFingerprint('2026-08-16T00:00:00Z', [{ label: 'Doors', destination: '/collections/y' }])
    const c = deckSlotFingerprint('2026-08-17T00:00:00Z', [{ label: 'Doors', destination: '/collections/x' }])
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('heroSlotFingerprint', () => {
  it('is empty when nothing is pinned and no headline is set', () => {
    expect(heroSlotFingerprint(null, null)).toBe('')
  })

  it('moves on a pin change and on a headline change', () => {
    const a = heroSlotFingerprint('handle-a', 'Hello')
    expect(a).not.toBe(heroSlotFingerprint('handle-b', 'Hello'))
    expect(a).not.toBe(heroSlotFingerprint('handle-a', 'Other'))
  })
})

describe('couplesSlotFingerprint', () => {
  it('is empty when no active couples band is published', () => {
    expect(couplesSlotFingerprint(null)).toBe('')
  })

  it('moves on an image swap, a copy change, and a handle change', () => {
    const base = { imageRef: 'image-1', heading: 'Play together', body: 'B', handles: ['a', 'b'] }
    const a = couplesSlotFingerprint(base)
    expect(a).not.toBe(couplesSlotFingerprint({ ...base, imageRef: 'image-2' }))
    expect(a).not.toBe(couplesSlotFingerprint({ ...base, body: 'C' }))
    expect(a).not.toBe(couplesSlotFingerprint({ ...base, handles: ['a', 'c'] }))
  })
})

describe('evaluateMerchFreshness', () => {
  const base = { rails: 'r1', deck: 'd1', hero: 'h1', couples: 'c1' }

  it('fails listing exactly the byte-identical must-change slots', () => {
    const v = evaluateMerchFreshness(base, { rails: 'r1', deck: 'd1', hero: 'h2', couples: 'c1' }, ['rails', 'hero', 'couples'])
    expect(v.ok).toBe(false)
    expect(v.stale).toEqual(['rails', 'couples'])
  })

  it('passes when every must-change slot moved, even if advisory slots did not', () => {
    const v = evaluateMerchFreshness(base, { rails: 'r2', deck: 'd1', hero: 'h1', couples: 'c1' }, ['rails'])
    expect(v.ok).toBe(true)
    expect(v.perSlot.deck.fresh).toBe(false)
    expect(v.perSlot.couples.fresh).toBe(false)
  })

  it('treats a missing baseline slot as fresh (first-run rule per slot)', () => {
    const v = evaluateMerchFreshness(
      { rails: 'r1' },
      { rails: 'r2', deck: 'd1', hero: 'h1', couples: 'c1' },
      ['rails', 'deck', 'hero', 'couples'],
    )
    expect(v.ok).toBe(true)
  })

  it('an empty current must-change slot is stale (a run that unpublished the slot did not refresh it)', () => {
    const v = evaluateMerchFreshness(base, { rails: '', deck: 'd2', hero: 'h2', couples: 'c2' }, ['rails'])
    expect(v.ok).toBe(false)
    expect(v.stale).toEqual(['rails'])
  })
})

describe('parseMustChangeSlots', () => {
  it('defaults to rails', () => {
    expect(parseMustChangeSlots(undefined)).toEqual(['rails'])
    expect(parseMustChangeSlots('')).toEqual(['rails'])
  })

  it('parses a comma list', () => {
    expect(parseMustChangeSlots('rails, hero')).toEqual(['rails', 'hero'])
    expect(parseMustChangeSlots('rails,couples')).toEqual(['rails', 'couples'])
  })

  it('throws on an unknown slot', () => {
    expect(() => parseMustChangeSlots('rails,nav')).toThrow(/unknown slot/)
  })
})
