import { describe, expect, it } from 'vitest'
import {
  audiencePhrase,
  computeAvailable,
  emmaQuestions,
  getEmmaLine,
  railTitlePlain,
  railTitleSegments,
  rankRails,
  scoreProduct,
  welcomeBackSegments,
} from './discovery-emma'
import type {
  Audience,
  Category,
  DiscoveryProduct,
  DiscoveryState,
  Matters,
  Mood,
} from '~/types/discovery'
import { EMPTY_STATE } from '~/types/discovery'

function product(overrides: Partial<DiscoveryProduct> = {}): DiscoveryProduct {
  return {
    id:          'gid://test/1',
    handle:      'test-product',
    title:       'Test Product',
    price:       50,
    imageUrl:    null,
    imageAlt:    null,
    category:    'Pleasure',
    subcategory: 'Vibrators',
    mood:        [],
    audience:    [],
    matters:     [],
    ...overrides,
  }
}

function state(overrides: Partial<DiscoveryState> = {}): DiscoveryState {
  return { ...EMPTY_STATE, ...overrides }
}

describe('scoreProduct', () => {
  it('returns 0 with no selections', () => {
    expect(scoreProduct(product({ mood: ['Sensual'] }), state())).toBe(0)
  })

  it('weights mood=3, audience=2, matters=2', () => {
    const p = product({ mood: ['Sensual'], audience: ['Us'], matters: ['Body-Safe Silicone'] })
    const s = state({ mood: ['Sensual'], audience: ['Us'], matters: ['Body-Safe Silicone'] })
    expect(scoreProduct(p, s)).toBe(3 + 2 + 2)
  })

  it('counts each intersection separately', () => {
    const p = product({ mood: ['Sensual', 'Romantic'] as Mood[] })
    const s = state({ mood: ['Sensual', 'Romantic'] as Mood[] })
    expect(scoreProduct(p, s)).toBe(6)
  })

  it('ignores chips that don\'t intersect', () => {
    const p = product({ mood: ['Bold'] })
    const s = state({ mood: ['Sensual'] })
    expect(scoreProduct(p, s)).toBe(0)
  })
})

describe('rankRails', () => {
  const idx: DiscoveryProduct[] = [
    product({ id: '1', category: 'Pleasure', mood: ['Sensual'], price: 50 }),
    product({ id: '2', category: 'Pleasure', mood: ['Bold'],    price: 50 }),
    product({ id: '3', category: 'Play',     mood: ['Sensual'], price: 50 }),
    product({ id: '4', category: 'Body',     mood: ['Sensual'], price: 50 }),
    product({ id: '5', category: 'Wear',     mood: ['Sensual'], price: 50 }),
  ]

  it('returns canonical category order with no selections', () => {
    const rails = rankRails(idx, state())
    expect(rails.map(r => r.category)).toEqual(['Pleasure', 'Play', 'Body', 'Wear'])
  })

  it('reorders by aggregate score when selections present', () => {
    // Two Sensual matches in Pleasure (id 1) vs one in each other cat:
    // Pleasure aggregate is just one Sensual match (id 1) too — so ties break canonical.
    // Make Pleasure win: add another Sensual in Pleasure.
    const augmented = [
      ...idx,
      product({ id: '6', category: 'Pleasure', mood: ['Sensual'], price: 50 }),
    ]
    const rails = rankRails(augmented, state({ mood: ['Sensual'] }))
    expect(rails[0]?.category).toBe('Pleasure')
  })

  it('filters by budget', () => {
    const idxWithExpensive: DiscoveryProduct[] = [
      product({ id: '1', category: 'Pleasure', price: 500 }),
      product({ id: '2', category: 'Pleasure', price: 50  }),
    ]
    const rails = rankRails(idxWithExpensive, state({ budget: 100 }))
    const pleasure = rails.find(r => r.category === 'Pleasure')!
    expect(pleasure.items.length).toBe(1)
    expect(pleasure.items[0]?.product.id).toBe('2')
  })

  it('respects perRail cap', () => {
    const many: DiscoveryProduct[] = Array.from({ length: 10 }, (_, i) =>
      product({ id: String(i), category: 'Pleasure', price: 50 }),
    )
    const rails = rankRails(many, state(), { perRail: 3 })
    expect(rails[0]?.items.length).toBe(3)
  })

  it('drops empty rails when dropEmpty=true', () => {
    const single = [product({ id: '1', category: 'Pleasure', mood: ['Sensual'] })]
    const rails = rankRails(single, state({ mood: ['Sensual'] }), { dropEmpty: true })
    expect(rails.map(r => r.category)).toEqual(['Pleasure'])
  })

  it('keeps stable canonical order on score ties', () => {
    const equal: DiscoveryProduct[] = [
      product({ id: '1', category: 'Wear', mood: ['Sensual'] }),
      product({ id: '2', category: 'Body', mood: ['Sensual'] }),
    ]
    const rails = rankRails(equal, state({ mood: ['Sensual'] }))
    // Both Body and Wear score equally; canonical order has Body before Wear.
    const bodyIdx = rails.findIndex(r => r.category === 'Body')
    const wearIdx = rails.findIndex(r => r.category === 'Wear')
    expect(bodyIdx).toBeLessThan(wearIdx)
  })
})

describe('railTitleSegments', () => {
  const cat: Category = 'Pleasure'

  it('returns just the category with no selections', () => {
    expect(railTitlePlain(cat, state())).toBe('Pleasure')
  })

  it('prepends mood', () => {
    expect(railTitlePlain(cat, state({ mood: ['Sensual'] }))).toBe('Sensual Pleasure')
  })

  it('appends audience', () => {
    expect(railTitlePlain(cat, state({ audience: ['Us'] }))).toBe('Pleasure for Us')
  })

  it('combines mood + audience', () => {
    expect(railTitlePlain(cat, state({ mood: ['Sensual'], audience: ['Us'] })))
      .toBe('Sensual Pleasure for Us')
  })

  it('handles Date Night audience phrase', () => {
    expect(railTitlePlain(cat, state({ audience: ['Date Night'] })))
      .toBe('Pleasure for Date Night')
  })

  it('handles Solo (no "for")', () => {
    expect(railTitlePlain(cat, state({ audience: ['Solo'] })))
      .toBe('Pleasure Solo')
  })

  it('emphasizes mood and audience segments only', () => {
    const segs = railTitleSegments(cat, state({ mood: ['Sensual'], audience: ['Us'] }))
    const emph = segs.filter(s => s.emphasized).map(s => s.text)
    expect(emph).toEqual(['Sensual', 'for Us'])
  })

  it('falls back to matters when no mood/audience', () => {
    expect(railTitlePlain(cat, state({ matters: ['Beginner-Friendly'] })))
      .toBe('Beginner-Friendly Pleasure')
  })
})

describe('audiencePhrase', () => {
  it.each<[Audience, string]>([
    ['Me', 'for Me'],
    ['Us', 'for Us'],
    ['A Partner', 'for Them'],
    ['Date Night', 'for Date Night'],
    ['Solo', 'Solo'],
    ['Gift', 'as a Gift'],
  ])('%s → %s', (aud, phrase) => {
    expect(audiencePhrase(aud)).toBe(phrase)
  })
})

describe('getEmmaLine', () => {
  it('returns intro copy when empty', () => {
    expect(getEmmaLine(state())).toMatch(/Hi, I'm Emma/)
  })

  it('asks who-it\'s-for when only mood is set', () => {
    expect(getEmmaLine(state({ mood: ['Sensual'] }))).toMatch(/sensual\. Good start/)
  })

  it('asks mood when only audience is set', () => {
    expect(getEmmaLine(state({ audience: ['Us'] }))).toMatch(/For us\. Noted/)
  })

  it('uses "you" instead of "me" when audience=Me', () => {
    expect(getEmmaLine(state({ mood: ['Sensual'], audience: ['Me'] }))).toMatch(/for you/)
  })

  it('confirms a complete brief when all three are set', () => {
    const line = getEmmaLine(state({
      mood:     ['Sensual'],
      audience: ['Us'],
      matters:  ['Body-Safe Silicone'] as Matters[],
    }))
    expect(line).toMatch(/That's a real brief/)
  })

  it('contains no em dashes (CLAUDE.md voice rule)', () => {
    const lines = [
      getEmmaLine(state()),
      getEmmaLine(state({ mood: ['Sensual'] })),
      getEmmaLine(state({ mood: ['Sensual'], audience: ['Us'] })),
      getEmmaLine(state({ mood: ['Sensual'], audience: ['Us'], matters: ['Hands-Free'] as Matters[] })),
    ]
    for (const l of lines) expect(l).not.toContain('—')
  })
})

describe('emmaQuestions', () => {
  it('intro headline does not use em dashes', () => {
    expect(emmaQuestions.intro.headline).not.toContain('—')
  })

  it('audience question echoes the prior mood', () => {
    expect(emmaQuestions.audience('Sensual').headline).toMatch(/sensual/i)
  })

  it('matters question echoes the prior audience', () => {
    expect(emmaQuestions.matters('Us').headline).toMatch(/for the two of you/)
  })

  it('done line echoes mood and audience', () => {
    const d = emmaQuestions.done('Sensual', 'Us')
    expect(d.headline).toMatch(/sensual/)
    expect(d.headline).toMatch(/for both of you/)
  })
})

describe('welcomeBackSegments', () => {
  it('returns mood + audience when both present', () => {
    const w = welcomeBackSegments({ mood: ['Sensual'], audience: ['Us'] })
    expect(w.mood).toBe('sensual')
    expect(w.audience).toBe('for us')
  })

  it('handles mood-only', () => {
    const w = welcomeBackSegments({ mood: ['Bold'], audience: [] })
    expect(w.mood).toBe('bold')
    expect(w.audience).toBeNull()
  })

  it('handles empty', () => {
    const w = welcomeBackSegments({ mood: [], audience: [] })
    expect(w.mood).toBeNull()
    expect(w.audience).toBeNull()
  })
})

describe('computeAvailable', () => {
  const idx: DiscoveryProduct[] = [
    product({ id: '1', mood: ['Sensual'],  audience: ['Us'], matters: ['Body-Safe-Silicone'] }),
    product({ id: '2', mood: ['Bold'],     audience: ['Me'], matters: ['Waterproof'] }),
    product({ id: '3', mood: ['Sensual'],  audience: ['Me'], matters: ['Travel-Size'] }),
    product({ id: '4', mood: ['Playful'],  audience: ['Us'], matters: ['Hands-Free'] }),
  ]

  it('returns all tags as available under the empty state', () => {
    const a = computeAvailable(idx, EMPTY_STATE)
    expect(Array.from(a.moods).sort()).toEqual(['Bold', 'Playful', 'Sensual'])
    expect(Array.from(a.audiences).sort()).toEqual(['Me', 'Us'])
    expect(Array.from(a.matters).sort()).toEqual(['Body-Safe-Silicone', 'Hands-Free', 'Travel-Size', 'Waterproof'])
  })

  it('narrows audiences when a mood is selected', () => {
    const a = computeAvailable(idx, { ...EMPTY_STATE, mood: ['Sensual'] })
    // Sensual products are 1 (Us) + 3 (Me) → both audiences
    expect(Array.from(a.audiences).sort()).toEqual(['Me', 'Us'])
    // And matters narrows to those carried by Sensual products
    expect(Array.from(a.matters).sort()).toEqual(['Body-Safe-Silicone', 'Travel-Size'])
  })

  it('drops audiences with no co-occurring product', () => {
    // Only Bold product is #2 with audience=Me. So Us drops out.
    const a = computeAvailable(idx, { ...EMPTY_STATE, mood: ['Bold'] })
    expect(Array.from(a.audiences)).toEqual(['Me'])
    expect(Array.from(a.matters)).toEqual(['Waterproof'])
  })

  it('keeps within-group chips open even with a same-group selection', () => {
    // Selecting Sensual (mood) shouldn't hide other mood chips — they expand
    // the mood set OR-style. Bold is still available because it co-occurs
    // with audiences/matters that satisfy the (empty) other-group filters.
    const a = computeAvailable(idx, { ...EMPTY_STATE, mood: ['Sensual'] })
    expect(Array.from(a.moods).sort()).toEqual(['Bold', 'Playful', 'Sensual'])
  })

  it('strands matters when cross-group filter has zero intersection', () => {
    // mood=Bold (product 2 only) AND audience=Us (products 1, 4) → 0 products.
    // Mood chips remain available because their own selection is ignored
    // when evaluating mood chips — adding a mood is OR-within-group, so
    // it could rescue results. Same for audience chips. But matters has
    // no escape: every matters chip needs a product that satisfies BOTH
    // the mood AND audience selection, which is empty.
    const a = computeAvailable(idx, {
      ...EMPTY_STATE,
      mood:     ['Bold'],
      audience: ['Us'],
    })
    // Audience=Us products are 1 (Sensual) and 4 (Playful) → those moods open
    expect(Array.from(a.moods).sort()).toEqual(['Playful', 'Sensual'])
    // Mood=Bold products are only #2 (audience=Me)
    expect(Array.from(a.audiences)).toEqual(['Me'])
    // matters has no co-occurring product
    expect(a.matters.size).toBe(0)
  })
})
