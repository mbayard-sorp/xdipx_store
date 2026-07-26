// Regression cover for the P0 that blanked every team-published homepage
// section in production. `singleton.homepage` rails hold `productHandles` in
// two shapes (productRef objects and bare strings); the GROQ object projection
// turned every bare string into `null`, and the consumer's
// `.map(p => p.handle)` threw on it. Because all team sections are built in one
// Promise.all, ONE legacy-shaped rail rejected the whole payload and the
// storefront fell back to its hardcoded shell everywhere.
import { describe, it, expect } from 'vitest'
import { normalizeProductHandles } from './product-handles'

describe('normalizeProductHandles', () => {
  it('reads the productRef object shape', () => {
    expect(normalizeProductHandles([
      { handle: 'jo-h2o-cooling-water-based-lubricant' },
      { handle: 'jo-refresh-foaming-toy-cleaner-7-oz' },
    ])).toEqual([
      'jo-h2o-cooling-water-based-lubricant',
      'jo-refresh-foaming-toy-cleaner-7-oz',
    ])
  })

  it('reads the bare-string shape (the shape that used to crash the homepage)', () => {
    expect(normalizeProductHandles([
      'tantus-duchess-o2-dual-density-vibrating-dildo-quartz',
      'naturals-h2o-intimate-lubricant-8-5-oz',
    ])).toEqual([
      'tantus-duchess-o2-dual-density-vibrating-dildo-quartz',
      'naturals-h2o-intimate-lubricant-8-5-oz',
    ])
  })

  it('reads a rail that mixes both shapes', () => {
    expect(normalizeProductHandles([
      'bare-string-handle',
      { handle: 'object-handle' },
    ])).toEqual(['bare-string-handle', 'object-handle'])
  })

  it('drops nulls instead of throwing — the exact production failure', () => {
    // What `productHandles[]{ handle }` returned for a string-shaped doc.
    expect(() => normalizeProductHandles([null, null, null])).not.toThrow()
    expect(normalizeProductHandles([null, null, null])).toEqual([])
  })

  it('drops blank, whitespace-only, and handle-less entries', () => {
    expect(normalizeProductHandles([
      '', '   ', { handle: '' }, { handle: null }, {}, undefined, 'real-handle',
    ])).toEqual(['real-handle'])
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeProductHandles(['  padded-handle  ', { handle: '\tobj-handle\n' }]))
      .toEqual(['padded-handle', 'obj-handle'])
  })

  it('returns [] for null/undefined/non-array input', () => {
    expect(normalizeProductHandles(null)).toEqual([])
    expect(normalizeProductHandles(undefined)).toEqual([])
    expect(normalizeProductHandles({} as never)).toEqual([])
  })
})
