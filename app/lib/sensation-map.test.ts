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
    brand: p.brand ?? null,
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

  describe('seeded rotation', () => {
    const types = deriveTypeNotches(INDEX, 5) // ['vibrator', 'lube', 'couples']
    const feels = deriveFeelNotches(['Sensual', 'Playful'])

    it('omitted seed preserves today\'s (top-notch) behavior', () => {
      expect(defaultSensationState(types, feels)).toEqual({ type: 'vibrator', feel: 'Sensual' })
    })

    it('seed = 0 is equivalent to omitting the seed', () => {
      expect(defaultSensationState(types, feels, 0)).toEqual(defaultSensationState(types, feels))
    })

    it('the same seed always yields the same default', () => {
      const a = defaultSensationState(types, feels, 42)
      const b = defaultSensationState(types, feels, 42)
      expect(a).toEqual(b)
    })

    it('different seeds rotate the default Type notch', () => {
      expect(defaultSensationState(types, feels, 0)!.type).toBe('vibrator')
      expect(defaultSensationState(types, feels, 1)!.type).toBe('lube')
      expect(defaultSensationState(types, feels, 2)!.type).toBe('couples')
      // Wraps back around.
      expect(defaultSensationState(types, feels, 3)!.type).toBe('vibrator')
    })

    it('handles seeds larger than the notch count', () => {
      expect(defaultSensationState(types, feels, 100)).toEqual(
        defaultSensationState(types, feels, 100 % types.length),
      )
    })

    it('is still null on a cold index regardless of seed', () => {
      expect(defaultSensationState([], feels, 7)).toBeNull()
    })
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

  describe('variant collapse + entry-price floor (#3527)', () => {
    // Three size variants of one $418 product (same brand + title stem), plus a
    // cheaper distinct product and an entry-price item.
    const WEAR: DiscoveryProduct[] = [
      mk({ id: 'j-s', handle: 'prowler-red-jeans-s', title: 'Prowler RED Jeans - Small', brand: 'Prowler RED', productTypeDial: 'wear', mood: ['Sensual'], price: 418 }),
      mk({ id: 'j-m', handle: 'prowler-red-jeans-m', title: 'Prowler RED Jeans - Medium', brand: 'Prowler RED', productTypeDial: 'wear', mood: ['Sensual'], price: 418 }),
      mk({ id: 'j-l', handle: 'prowler-red-jeans-l', title: 'Prowler RED Jeans - Large', brand: 'Prowler RED', productTypeDial: 'wear', mood: ['Sensual'], price: 418 }),
      mk({ id: 'harn', handle: 'leather-harness', title: 'Leather Harness', brand: 'Other', productTypeDial: 'wear', mood: ['Sensual'], price: 120 }),
      mk({ id: 'brief', handle: 'mesh-brief', title: 'Mesh Brief', brand: 'Other', productTypeDial: 'wear', mood: ['Sensual'], price: 22 }),
    ]

    it('collapses size variants of one product to a single card', () => {
      const m = matchSensationMap(WEAR, { type: 'wear', feel: 'Sensual' })
      const jeans = m.items.filter(p => p.id.startsWith('j-'))
      expect(jeans).toHaveLength(1) // not three sizes of the same jeans
    })

    it('guarantees an entry-price (< $30) item in the set when one exists', () => {
      const m = matchSensationMap(WEAR, { type: 'wear', feel: 'Sensual' })
      expect(m.items.some(p => p.price < 30)).toBe(true) // the $22 brief is pulled in
      expect(m.items.map(p => p.id)).toContain('brief')
    })

    it('swaps the weakest slot for an entry-price item when the top set is all pricier', () => {
      // Three big-savings items outrank a cheap one, so without the floor the
      // set would be all > $30. The $19 item (with an image) must be pulled in.
      const PROMO: DiscoveryProduct[] = [
        mk({ id: 'a', handle: 'a', productTypeDial: 'vibrator', price: 90, compareAtPrice: 200 }),
        mk({ id: 'b', handle: 'b', productTypeDial: 'vibrator', price: 80, compareAtPrice: 180 }),
        mk({ id: 'c', handle: 'c', productTypeDial: 'vibrator', price: 70, compareAtPrice: 160 }),
        mk({ id: 'cheap', handle: 'cheap', productTypeDial: 'vibrator', price: 19 }),
      ]
      const m = matchSensationMap(PROMO, { type: 'vibrator', feel: null })
      expect(m.items).toHaveLength(3)
      expect(m.items.map(p => p.id)).toContain('cheap')
      expect(m.items.map(p => p.id)).not.toContain('c') // weakest slot yielded
    })

    it('does not promote an image-less bargain (a poor card) over the imagery rule', () => {
      const NOIMG: DiscoveryProduct[] = [
        mk({ id: 'a', handle: 'a', productTypeDial: 'vibrator', price: 90, compareAtPrice: 200 }),
        mk({ id: 'b', handle: 'b', productTypeDial: 'vibrator', price: 80, compareAtPrice: 180 }),
        mk({ id: 'c', handle: 'c', productTypeDial: 'vibrator', price: 70, compareAtPrice: 160 }),
        mk({ id: 'cheap-noimg', handle: 'cheap-noimg', productTypeDial: 'vibrator', price: 19, imageUrl: null }),
      ]
      const m = matchSensationMap(NOIMG, { type: 'vibrator', feel: null })
      expect(m.items.map(p => p.id)).not.toContain('cheap-noimg')
    })

    it('does not collapse distinct products that merely share a trailing word', () => {
      // "Jelle" and "Jelle Plus" are different products; "Plus" is not a size.
      const LUBES: DiscoveryProduct[] = [
        mk({ id: 'jelle', handle: 'jelle', title: 'Wicked Jelle', brand: 'Wicked', productTypeDial: 'lube', price: 14 }),
        mk({ id: 'jelle-plus', handle: 'jelle-plus', title: 'Wicked Jelle Plus', brand: 'Wicked', productTypeDial: 'lube', price: 16 }),
        mk({ id: 'aqua', handle: 'aqua', title: 'Wicked Aqua', brand: 'Wicked', productTypeDial: 'lube', price: 12 }),
      ]
      const m = matchSensationMap(LUBES, { type: 'lube', feel: null })
      expect(m.items.map(p => p.id).sort()).toEqual(['aqua', 'jelle', 'jelle-plus'])
    })
  })
})
