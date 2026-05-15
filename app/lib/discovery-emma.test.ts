import { describe, expect, it } from 'vitest'
import {
  audiencePhrase,
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
