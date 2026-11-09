import { describe, expect, it } from 'vitest'
import {
  CANONICAL_ALIASED_COMPARE_SLUGS,
  COMPARE_CANONICAL_ALIASES,
  resolveCompareCanonicalPath,
} from './compare-canonical-aliases'

describe('COMPARE_CANONICAL_ALIASES (#20824)', () => {
  it('maps every known duplicate /compare/ slug to its Notebook twin', () => {
    expect(COMPARE_CANONICAL_ALIASES).toEqual({
      'water-based-vs-silicone-vs-hybrid-lube': '/notebook/silicone-vs-water-based-lube',
      'air-pulse-toy-vs-vibrator': '/notebook/air-pulse-toy-vs-vibrator-difference',
      'penis-sleeve-vs-extender': '/notebook/penis-sleeve-vs-penis-extender',
      'mini-vs-full-size-vibrator': '/notebook/mini-vs-full-size-vibrator-does-size-matter',
    })
  })

  it('every alias target is a site-relative /notebook/ path, never an absolute URL', () => {
    for (const target of Object.values(COMPARE_CANONICAL_ALIASES)) {
      expect(target).toMatch(/^\/notebook\//)
      expect(target.startsWith('http')).toBe(false)
    }
  })
})

describe('CANONICAL_ALIASED_COMPARE_SLUGS', () => {
  it('contains exactly the keys of COMPARE_CANONICAL_ALIASES', () => {
    expect(CANONICAL_ALIASED_COMPARE_SLUGS).toEqual(new Set(Object.keys(COMPARE_CANONICAL_ALIASES)))
  })
})

describe('resolveCompareCanonicalPath', () => {
  it('resolves an aliased slug to its Notebook twin path', () => {
    expect(resolveCompareCanonicalPath('penis-sleeve-vs-extender')).toBe('/notebook/penis-sleeve-vs-penis-extender')
    expect(resolveCompareCanonicalPath('air-pulse-toy-vs-vibrator')).toBe('/notebook/air-pulse-toy-vs-vibrator-difference')
  })

  it('self-canonicalizes a comparison with no duplicate', () => {
    expect(resolveCompareCanonicalPath('some-future-comparison')).toBe('/compare/some-future-comparison')
  })
})
