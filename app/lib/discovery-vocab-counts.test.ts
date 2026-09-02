// computeVocabCounts (ticket #5631): per-tag product counts across the three
// Ask Emma vocab dimensions, the data api.team.discovery-vocab.tsx serves to
// credential-free cloud routines. Pure function, no DB/KV/network.
import { describe, it, expect } from 'vitest'
import { computeVocabCounts } from './discovery.server'
import type { DiscoveryProduct } from '~/types/discovery'

function makeProduct(overrides: Partial<DiscoveryProduct> & Pick<DiscoveryProduct, 'handle' | 'category'>): DiscoveryProduct {
  return {
    id:             `gid://shopify/Product/${overrides.handle}`,
    title:          overrides.title ?? overrides.handle,
    defaultVariantId: null,
    price:          overrides.price ?? 50,
    priceMax:       overrides.priceMax ?? null,
    compareAtPrice: overrides.compareAtPrice ?? null,
    colorValues:    overrides.colorValues ?? [],
    sizeValues:     overrides.sizeValues ?? [],
    imageUrl:       null,
    imageAlt:       null,
    subcategory:    overrides.subcategory ?? overrides.category,
    brand:          overrides.brand ?? null,
    mood:           overrides.mood ?? [],
    audience:       overrides.audience ?? [],
    matters:        overrides.matters ?? [],
    totalInventory: overrides.totalInventory !== undefined ? overrides.totalInventory : 10,
    productType:    overrides.productType ?? null,
    productTypeDial: overrides.productTypeDial ?? null,
    ...overrides,
  }
}

describe('computeVocabCounts', () => {
  it('counts products per tag, split by group', () => {
    const index = [
      makeProduct({ handle: 'a', category: 'Body', mood: ['playful', 'intense'] }),
      makeProduct({ handle: 'b', category: 'Body', mood: ['playful'], audience: ['couples'] }),
      makeProduct({ handle: 'c', category: 'Body', matters: ['beginner-friendly'] }),
    ]
    const counts = computeVocabCounts(index)
    expect(counts).toContainEqual({ group: 'mood', tag: 'playful', productCount: 2 })
    expect(counts).toContainEqual({ group: 'mood', tag: 'intense', productCount: 1 })
    expect(counts).toContainEqual({ group: 'audience', tag: 'couples', productCount: 1 })
    expect(counts).toContainEqual({ group: 'matters', tag: 'beginner-friendly', productCount: 1 })
  })

  it('sorts each group by count descending, alpha tiebreak', () => {
    const index = [
      makeProduct({ handle: 'a', category: 'Body', mood: ['b-tag', 'a-tag'] }),
      makeProduct({ handle: 'b', category: 'Body', mood: ['b-tag'] }),
    ]
    const moods = computeVocabCounts(index).filter(c => c.group === 'mood')
    expect(moods).toEqual([
      { group: 'mood', tag: 'b-tag', productCount: 2 },
      { group: 'mood', tag: 'a-tag', productCount: 1 },
    ])
  })

  it('returns an empty array for an empty index rather than throwing', () => {
    expect(computeVocabCounts([])).toEqual([])
  })

  it('matches computeVocab\'s own tally semantics (occurrences, not deduped products)', () => {
    const index = [makeProduct({ handle: 'a', category: 'Body', mood: ['playful', 'playful'] })]
    const moods = computeVocabCounts(index).filter(c => c.group === 'mood')
    expect(moods).toEqual([{ group: 'mood', tag: 'playful', productCount: 2 }])
  })
})
