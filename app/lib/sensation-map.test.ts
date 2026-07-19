import { describe, expect, it } from 'vitest'
import type { DiscoveryProduct } from '~/types/discovery'
import {
  deriveTypeNotches,
  deriveFeelNotches,
  defaultSensationState,
  matchSensationMap,
} from './sensation-map'

/** Minimal DiscoveryProduct factory — only the fields matching reads matter. */
function mk(p: Partial<DiscoveryProduct> & { id: string; handle: string }): DiscoveryProduct {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title ?? p.handle,
    defaultVariantId: null,
    price: p.price ?? 50,
    priceMax: null,
    compareAtPrice: p.compareAtPrice ?? null,
    colorValues: [],
    sizeValues: [],
    imageUrl: p.imageUrl === undefined ? 'https://img/x.jpg' : p.imageUrl,
    imageAlt: null,
    category: p.category ?? 'Pleasure',
    subcategory: p.subcategory ?? '',
    mood: p.mood ?? [],
    audience: [],
    matters: [],
    totalInventory: null,
    productType: null,
    productTypeDial: p.productTypeDial ?? null,
  }
}

// 5 vibrators, 2 lubes, 1 (sparse) couples.
const INDEX: DiscoveryProduct[] = [
  mk({ id: 'v1', handle: 'v1', productTypeDial: 'vibrator', mood: ['Sensual'], price: 60 }),
  mk({ id: 'v2', handle: 'v2', productTypeDial: 'vibrator', mood: ['Sensual', 'Playful'], price: 40 }),
  mk({ id: 'v3', handle: 'v3', productTypeDial: 'vibrator', mood: ['Playful'], price: 80 }),
  mk({ id: 'v4', handle: 'v4', productTypeDial: 'vibrator', mood: ['Gentle'], price: 30 }),
  mk({ id: 'v5', handle: 'v5', productTypeDial: 'vibrator', mood: ['Playful'], price: 20, imageUrl: null }),
  mk({ id: 'l1', handle: 'l1', productTypeDial: 'lube', mood: ['Playful'], price: 15 }),
  mk({ id: 'l2', handle: 'l2', productTypeDial: 'lube', mood: ['Sensual'], price: 18 }),
  mk({ id: 'c1', handle: 'c1', productTypeDial: 'couples', mood: ['Sensual'], price: 120 }),
]

describe('deriveTypeNotches', () => {
  it('ranks by product count and caps at max', () => {
    const notches = deriveTypeNotches(INDEX, 2)
    expect(notches.map(n => n.value)).toEqual(['vibrator', 'lube'])
    expect(notches[0]!.count).toBe(5)
    expect(notches[1]!.count).toBe(2)
  })

  it('applies friendly labels (including remaps)', () => {
    const notches = deriveTypeNotches(INDEX, 5)
    const byValue = Object.fromEntries(notches.map(n => [n.value, n.label]))
    expect(byValue['vibrator']).toBe('Vibrator')
    expect(byValue['couples']).toBe('For two')
  })

  it('ignores products with no productTypeDial', () => {
    const withUntyped = [...INDEX, mk({ id: 'x', handle: 'x', productTypeDial: null })]
    const total = deriveTypeNotches(withUntyped, 99).reduce((s, n) => s + n.count, 0)
    expect(total).toBe(INDEX.length) // the untyped product is excluded
  })
})

describe('deriveFeelNotches', () => {
  it('slices the (already frequency-sorted) mood vocab to max', () => {
    expect(deriveFeelNotches(['Sensual', 'Playful', 'Gentle', 'Bold', 'Slow'], 4))
      .toEqual(['Sensual', 'Playful', 'Gentle', 'Bold'])
  })
})

describe('defaultSensationState', () => {
  it('is the top Type notch + the top Feel', () => {
    const types = deriveTypeNotches(INDEX)
    const feels = deriveFeelNotches(['Sensual', 'Playful'])
    expect(defaultSensationState(types, feels)).toEqual({ type: 'vibrator', feel: 'Sensual' })
  })

  it('is null when there are no types (cold index)', () => {
    expect(defaultSensationState([], ['Sensual'])).toBeNull()
  })

  it('has a null feel when the vocab is empty', () => {
    const types = deriveTypeNotches(INDEX)
    expect(defaultSensationState(types, [])).toEqual({ type: 'vibrator', feel: null })
  })
})

describe('matchSensationMap', () => {
  it('tier 1 — exact Type + Feel, scored by overlap, not relaxed', () => {
    const m = matchSensationMap(INDEX, { type: 'vibrator', feel: 'Sensual' })
    expect(m.relaxed).toBe(false)
    expect(m.resolved).toEqual({ type: 'vibrator', feel: 'Sensual' })
    // Only v1 and v2 carry Sensual among vibrators.
    expect(m.items.map(p => p.id).sort()).toEqual(['v1', 'v2'])
  })

  it('tier 2 — relaxes Feel when the exact brief is too thin', () => {
    // Only v4 is Gentle (1 < MIN_RESULTS) → relax to best-of vibrator.
    const m = matchSensationMap(INDEX, { type: 'vibrator', feel: 'Gentle' })
    expect(m.relaxed).toBe(true)
    expect(m.relaxedReason).toBe('Closest fit')
    expect(m.resolved).toEqual({ type: 'vibrator', feel: null })
    expect(m.items).toHaveLength(3)
    // v5 has no image → sorted last by qualityCompare → excluded from top 3.
    expect(m.items.map(p => p.id)).not.toContain('v5')
  })

  it('feel = null is "any feel", not a relaxation', () => {
    const m = matchSensationMap(INDEX, { type: 'vibrator', feel: null })
    expect(m.relaxed).toBe(false)
    expect(m.relaxedReason).toBeNull()
    expect(m.resolved).toEqual({ type: 'vibrator', feel: null })
    expect(m.items).toHaveLength(3)
    expect(m.items.every(p => p.productTypeDial === 'vibrator')).toBe(true)
  })

  it('tier 3 — relaxes Type when the type is too sparse', () => {
    // couples has a single product → drop to the most-populated type (vibrator).
    const m = matchSensationMap(INDEX, { type: 'couples', feel: 'Sensual' })
    expect(m.relaxed).toBe(true)
    expect(m.resolved.type).toBe('vibrator')
    expect(m.items.length).toBeGreaterThanOrEqual(2)
  })

  it('never returns an empty result for any derived Type notch', () => {
    for (const notch of deriveTypeNotches(INDEX)) {
      const m = matchSensationMap(INDEX, { type: notch.value, feel: 'Sensual' })
      expect(m.items.length).toBeGreaterThan(0)
    }
  })

  it('image-bearing products sort ahead of image-less ones in relaxed tiers', () => {
    const m = matchSensationMap(INDEX, { type: 'vibrator', feel: null })
    const lastWithImage = m.items.findIndex(p => p.imageUrl === null)
    expect(lastWithImage).toBe(-1) // no image-less product cracks the top 3
  })
})
