/**
 * Unit tests for discovery-rules pure functions.
 *
 * All fixtures are built inline — no DB, no KV, no network.
 * Only applyRules, fillFallbacks, and autoLoosen are tested here;
 * async I/O helpers are covered by integration tests.
 */

import { describe, it, expect } from 'vitest'
import {
  applyRules,
  fillFallbacks,
  autoLoosen,
  resolveCollectionPins,
} from './discovery-rules.server'
import type { DiscoveryProduct, DiscoveryRule, Rail } from '~/types/discovery'
import { EMPTY_STATE } from '~/types/discovery'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<DiscoveryProduct> & Pick<DiscoveryProduct, 'handle' | 'category'>): DiscoveryProduct {
  return {
    id:             `gid://shopify/Product/${overrides.handle}`,
    title:          overrides.title ?? overrides.handle,
    price:          overrides.price ?? 50,
    imageUrl:       null,
    imageAlt:       null,
    subcategory:    overrides.subcategory ?? overrides.category,
    mood:           overrides.mood ?? [],
    audience:       overrides.audience ?? [],
    matters:        overrides.matters ?? [],
    totalInventory: overrides.totalInventory !== undefined ? overrides.totalInventory : 10,
    productType:    overrides.productType ?? null,
    productTypeDial: overrides.productTypeDial ?? null,
    ...overrides,
  }
}

function makeRule(overrides: Partial<DiscoveryRule> & Pick<DiscoveryRule, 'ruleType' | 'ruleValue'>): DiscoveryRule {
  return {
    id:        overrides.id ?? 1,
    category:  overrides.category ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    notes:     null,
    active:    true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function makeRail(category: DiscoveryProduct['category'], items: DiscoveryProduct[] = []): Rail {
  return {
    category,
    score: 0,
    total: items.length,
    items: items.map(p => ({ product: p, score: 0 })),
  }
}

// ---------------------------------------------------------------------------
// Fixture catalog — 20 products across all four categories
// ---------------------------------------------------------------------------

const catalog: DiscoveryProduct[] = [
  // Pleasure — vibrators
  makeProduct({ handle: 'vibe-1',    category: 'Pleasure', productType: 'vibrator', price: 80,  title: 'Silicone Vibrator',        mood: ['Sensual'],    audience: ['Me'],        matters: ['Whisper-quiet'] }),
  makeProduct({ handle: 'vibe-2',    category: 'Pleasure', productType: 'vibrator', price: 120, title: 'App Vibrator',             mood: ['Adventurous'],audience: ['Us'],        matters: ['Remote-controlled'] }),
  makeProduct({ handle: 'vibe-3',    category: 'Pleasure', productType: 'vibrator', price: 200, title: 'Luxury Vibrator',          mood: ['Indulgent'],  audience: ['Me'],        matters: ['Rechargeable'] }),
  makeProduct({ handle: 'dildo-1',   category: 'Pleasure', productType: 'dildo',    price: 60,  title: 'Realistic Dildo',          mood: ['Playful'],    audience: ['Me'],        matters: ['Soft-touch'] }),
  makeProduct({ handle: 'fetish-1',  category: 'Pleasure', productType: 'dildo',    price: 45,  title: 'Fetish Fantasy Dildo',     mood: ['Adventurous'],audience: ['A Partner'], matters: ['Beginner-friendly'], totalInventory: 2 }),

  // Play — bondage/couples
  makeProduct({ handle: 'bondage-1', category: 'Play',    productType: 'bondage',   price: 35,  title: 'Soft Restraint Kit',       mood: ['Adventurous'],audience: ['Us'],        matters: ['Beginner-friendly'] }),
  makeProduct({ handle: 'bondage-2', category: 'Play',    productType: 'bondage',   price: 75,  title: 'Leather Cuffs',            mood: ['Bold'],       audience: ['A Partner'], matters: ['Soft-touch'] }),
  makeProduct({ handle: 'couples-1', category: 'Play',    productType: 'couples',   price: 150, title: 'Couples Vibrator',         mood: ['Intimate'],   audience: ['Us'],        matters: ['Rechargeable'] }),
  makeProduct({ handle: 'couples-2', category: 'Play',    productType: 'couples',   price: 90,  title: 'Remote Couples Ring',      mood: ['Playful'],    audience: ['Us'],        matters: ['Remote-controlled'] }),
  makeProduct({ handle: 'wand-1',    category: 'Play',    productType: 'vibrator',  price: 110, title: 'Magic Wand Massager',      mood: ['Sensual'],    audience: ['Me'],        matters: ['Whisper-quiet'], totalInventory: 5 }),

  // Body — lubes/wellness
  makeProduct({ handle: 'lube-1',    category: 'Body',    productType: 'lube',      price: 18,  title: 'Water-Based Lube',         mood: ['Sensual'],    audience: ['Me'],        matters: ['Latex-free'] }),
  makeProduct({ handle: 'lube-2',    category: 'Body',    productType: 'lube',      price: 28,  title: 'Silicone Lube',            mood: ['Intimate'],   audience: ['Us'],        matters: ['Latex-free'] }),
  makeProduct({ handle: 'massage-1', category: 'Body',    productType: 'massage',   price: 40,  title: 'Massage Oil Set',          mood: ['Romantic'],   audience: ['Us'],        matters: ['Easy to clean'] }),
  makeProduct({ handle: 'wellness-1',category: 'Body',    productType: 'wellness',  price: 55,  title: 'Kegel Trainer',            mood: ['Empowered'],  audience: ['Me'],        matters: ['Beginner-friendly'], totalInventory: null }),
  makeProduct({ handle: 'wellness-2',category: 'Body',    productType: 'wellness',  price: 300, title: 'Premium Wellness Kit',     mood: ['Indulgent'],  audience: ['Me'],        matters: ['Rechargeable'] }),

  // Wear — lingerie/harness
  makeProduct({ handle: 'lingerie-1',category: 'Wear',   productType: 'wear',       price: 65,  title: 'Lace Bodysuit',            mood: ['Sensual'],    audience: ['Me'],        matters: ['Soft-touch'] }),
  makeProduct({ handle: 'lingerie-2',category: 'Wear',   productType: 'wear',       price: 85,  title: 'Strappy Lingerie Set',     mood: ['Bold'],       audience: ['A Partner'], matters: ['Soft-touch'] }),
  makeProduct({ handle: 'harness-1', category: 'Wear',   productType: 'harness',    price: 95,  title: 'Leather Harness',          mood: ['Adventurous'],audience: ['Me'],        matters: ['Soft-touch'] }),
  makeProduct({ handle: 'harness-2', category: 'Wear',   productType: 'harness',    price: 130, title: 'Festival Harness',         mood: ['Bold'],       audience: ['Me'],        matters: ['Easy to clean'] }),
  makeProduct({ handle: 'harness-3', category: 'Wear',   productType: 'harness',    price: 250, title: 'Deluxe Harness Bundle',    mood: ['Indulgent'],  audience: ['Us'],        matters: ['Easy to clean'], totalInventory: 1 }),
]

// ---------------------------------------------------------------------------
// applyRules — exclude_product
// ---------------------------------------------------------------------------

describe('applyRules — exclude_product', () => {
  it('removes the exact handle and keeps everything else', () => {
    const rules = [makeRule({ ruleType: 'exclude_product', ruleValue: 'vibe-1' })]
    const result = applyRules(catalog, rules, 0)
    expect(result.find(p => p.handle === 'vibe-1')).toBeUndefined()
    expect(result.length).toBe(catalog.length - 1)
  })

  it('is case-sensitive (non-matching handle is kept)', () => {
    const rules = [makeRule({ ruleType: 'exclude_product', ruleValue: 'VIBE-1' })]
    const result = applyRules(catalog, rules, 0)
    expect(result.find(p => p.handle === 'vibe-1')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// applyRules — exclude_product_type scoped to a category
// ---------------------------------------------------------------------------

describe('applyRules — exclude_product_type with category scope', () => {
  it('removes vibrators from Pleasure but leaves the Play vibrator intact', () => {
    const rules = [
      makeRule({ ruleType: 'exclude_product_type', ruleValue: 'vibrator', category: 'Pleasure' }),
    ]
    const result = applyRules(catalog, rules, 0)

    // All Pleasure vibrators must be gone.
    const pleasureVibes = result.filter(p => p.category === 'Pleasure' && p.productType === 'vibrator')
    expect(pleasureVibes).toHaveLength(0)

    // The Play vibrator (wand-1) must still be present.
    expect(result.find(p => p.handle === 'wand-1')).toBeDefined()
  })

  it('removes vibrators from ALL categories when category is null', () => {
    const rules = [
      makeRule({ ruleType: 'exclude_product_type', ruleValue: 'vibrator', category: null }),
    ]
    const result = applyRules(catalog, rules, 0)
    const vibes = result.filter(p => p.productType === 'vibrator')
    expect(vibes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// applyRules — exclude_keyword
// ---------------------------------------------------------------------------

describe('applyRules — exclude_keyword', () => {
  it('removes products whose title contains "fetish" (case-insensitive)', () => {
    const rules = [makeRule({ ruleType: 'exclude_keyword', ruleValue: 'fetish' })]
    const result = applyRules(catalog, rules, 0)
    expect(result.find(p => p.handle === 'fetish-1')).toBeUndefined()
    // Unrelated products are unaffected.
    expect(result.find(p => p.handle === 'vibe-1')).toBeDefined()
  })

  it('matches the keyword case-insensitively', () => {
    const rules = [makeRule({ ruleType: 'exclude_keyword', ruleValue: 'FETISH' })]
    const result = applyRules(catalog, rules, 0)
    expect(result.find(p => p.handle === 'fetish-1')).toBeUndefined()
  })

  it('matches mid-word substring', () => {
    const rules = [makeRule({ ruleType: 'exclude_keyword', ruleValue: 'wand' })]
    const result = applyRules(catalog, rules, 0)
    expect(result.find(p => p.handle === 'wand-1')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// applyRules — exclude_price_max
// ---------------------------------------------------------------------------

describe('applyRules — exclude_price_max', () => {
  it('removes everything priced above $50', () => {
    const rules = [makeRule({ ruleType: 'exclude_price_max', ruleValue: '50' })]
    const result = applyRules(catalog, rules, 0)
    expect(result.every(p => p.price <= 50)).toBe(true)
    // lube-1 ($18), fetish-1 ($45), bondage-1 ($35), lube-2 ($28), massage-1 ($40) survive.
    expect(result.find(p => p.handle === 'lube-1')).toBeDefined()
    expect(result.find(p => p.handle === 'vibe-1')).toBeUndefined() // $80
  })
})

// ---------------------------------------------------------------------------
// applyRules — inventoryMin
// ---------------------------------------------------------------------------

describe('applyRules — inventoryMin', () => {
  it('keeps untracked inventory (null) regardless of the floor', () => {
    const result = applyRules(catalog, [], 3)
    // wellness-1 has totalInventory: null — must survive
    expect(result.find(p => p.handle === 'wellness-1')).toBeDefined()
  })

  it('removes products with tracked inventory below the floor', () => {
    const result = applyRules(catalog, [], 3)
    // fetish-1 has totalInventory: 2, which is below floor 3 — must be removed
    expect(result.find(p => p.handle === 'fetish-1')).toBeUndefined()
    // harness-3 has totalInventory: 1 — must be removed
    expect(result.find(p => p.handle === 'harness-3')).toBeUndefined()
  })

  it('keeps products with inventory exactly at the floor', () => {
    const result = applyRules(catalog, [], 5)
    // wand-1 has totalInventory: 5 — must survive (not strictly less than 5)
    expect(result.find(p => p.handle === 'wand-1')).toBeDefined()
  })

  it('is disabled when inventoryMin is 0', () => {
    const result = applyRules(catalog, [], 0)
    // All products survive the inventory check
    expect(result.find(p => p.handle === 'fetish-1')).toBeDefined()
    expect(result.find(p => p.handle === 'harness-3')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// fillFallbacks
// ---------------------------------------------------------------------------

describe('fillFallbacks', () => {
  it('appends pinned handles in sort_order until the rail is full', () => {
    // Simulate a Body rail with only 1 item — needs 3 more to reach perRail=4.
    const existing = catalog.find(p => p.handle === 'lube-1')
    if (!existing) throw new Error('fixture missing lube-1')
    const rail = makeRail('Body', [existing])

    const rules: DiscoveryRule[] = [
      makeRule({ id: 10, ruleType: 'pin_fallback', ruleValue: 'lube-2',    category: 'Body', sortOrder: 0 }),
      makeRule({ id: 11, ruleType: 'pin_fallback', ruleValue: 'massage-1', category: 'Body', sortOrder: 1 }),
      makeRule({ id: 12, ruleType: 'pin_fallback', ruleValue: 'wellness-1',category: 'Body', sortOrder: 2 }),
      makeRule({ id: 13, ruleType: 'pin_fallback', ruleValue: 'wellness-2',category: 'Body', sortOrder: 3 }),
    ]

    const filled = fillFallbacks(rail, rules, catalog, 4)
    expect(filled.items).toHaveLength(4)
    const handles = filled.items.map(sp => sp.product.handle)
    // Existing item stays first.
    expect(handles[0]).toBe('lube-1')
    // Pins fill in sort_order.
    expect(handles[1]).toBe('lube-2')
    expect(handles[2]).toBe('massage-1')
    expect(handles[3]).toBe('wellness-1')
  })

  it('skips pins whose handle was excluded from filteredIndex', () => {
    const existing = catalog.find(p => p.handle === 'lube-1')
    if (!existing) throw new Error('fixture missing lube-1')
    const rail = makeRail('Body', [existing])

    const rules: DiscoveryRule[] = [
      makeRule({ id: 10, ruleType: 'pin_fallback', ruleValue: 'excluded-handle', category: 'Body', sortOrder: 0 }),
      makeRule({ id: 11, ruleType: 'pin_fallback', ruleValue: 'lube-2',           category: 'Body', sortOrder: 1 }),
    ]

    // filteredIndex does NOT contain 'excluded-handle'.
    const filled = fillFallbacks(rail, rules, catalog, 4)
    expect(filled.items.find(sp => sp.product.handle === 'excluded-handle')).toBeUndefined()
    expect(filled.items.find(sp => sp.product.handle === 'lube-2')).toBeDefined()
  })

  it('skips pins already in the rail', () => {
    const lube1 = catalog.find(p => p.handle === 'lube-1')
    if (!lube1) throw new Error('fixture missing lube-1')
    const rail = makeRail('Body', [lube1])

    const rules: DiscoveryRule[] = [
      // lube-1 is already in the rail — must be skipped.
      makeRule({ id: 10, ruleType: 'pin_fallback', ruleValue: 'lube-1',  category: 'Body', sortOrder: 0 }),
      makeRule({ id: 11, ruleType: 'pin_fallback', ruleValue: 'lube-2',  category: 'Body', sortOrder: 1 }),
    ]

    const filled = fillFallbacks(rail, rules, catalog, 4)
    const handles = filled.items.map(sp => sp.product.handle)
    expect(handles.filter(h => h === 'lube-1')).toHaveLength(1) // no duplicate
    expect(handles).toContain('lube-2')
  })

  it('returns the rail unchanged when already full', () => {
    const items = catalog.filter(p => p.category === 'Body').slice(0, 4)
    const rail = makeRail('Body', items)
    const rules: DiscoveryRule[] = [
      makeRule({ id: 10, ruleType: 'pin_fallback', ruleValue: 'lube-2', category: 'Body', sortOrder: 0 }),
    ]
    const filled = fillFallbacks(rail, rules, catalog, 4)
    expect(filled.items).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// autoLoosen
// ---------------------------------------------------------------------------

describe('autoLoosen', () => {
  it('drops matters first and returns items', () => {
    // State: Sensual mood + "A Partner" audience + "Rechargeable" matters.
    // In the Pleasure category, no vibrator has all three simultaneously.
    // Dropping matters should open up Sensual + Me (vibe-1).
    const state = {
      ...EMPTY_STATE,
      mood:     ['Sensual'],
      audience: ['A Partner'],
      matters:  ['Rechargeable'],
      budget:   300,
    }
    const result = autoLoosen('Pleasure', state, catalog, 4)
    expect(result).not.toBeNull()
    expect(result!.items.length).toBeGreaterThan(0)
    expect(result!.reason).toContain('Loosened your brief')
    expect(result!.reason).toContain('Pleasure')
  })

  it('returns null when even the most-relaxed state has zero items for the category', () => {
    // Empty catalog for the category.
    const emptyForBody = catalog.filter(p => p.category !== 'Body')
    const state = { ...EMPTY_STATE, mood: ['Sensual'], budget: 300 }
    const result = autoLoosen('Body', state, emptyForBody, 4)
    expect(result).toBeNull()
  })

  it('respects budget when loosening (budget is never dropped)', () => {
    // Very low budget — only lube-1 ($18) and lube-2 ($28) in Body survive.
    const state = {
      ...EMPTY_STATE,
      mood:     ['Adventurous'],
      audience: ['A Partner'],
      matters:  ['Rechargeable'],
      budget:   30,
    }
    const result = autoLoosen('Body', state, catalog, 4)
    if (result !== null) {
      // All returned items must be within budget.
      expect(result.items.every(sp => sp.product.price <= 30)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Collection-pin tier
// ---------------------------------------------------------------------------

describe('resolveCollectionPins', () => {
  it('returns empty map when no pin_collection_fallback rules exist', async () => {
    const calls: string[] = []
    const result = await resolveCollectionPins(
      [makeRule({ ruleType: 'pin_fallback', ruleValue: 'foo', category: 'Body' })],
      async (h) => { calls.push(h); return ['gid://x/1'] },
    )
    expect(result).toEqual({})
    expect(calls).toEqual([])
  })

  it('resolves a single collection pin to category → product IDs', async () => {
    const result = await resolveCollectionPins(
      [makeRule({ id: 10, ruleType: 'pin_collection_fallback', ruleValue: 'fall-favorites', category: 'Body' })],
      async () => ['gid://x/lube-1', 'gid://x/lube-2'],
    )
    expect(result).toEqual({ Body: ['gid://x/lube-1', 'gid://x/lube-2'] })
  })

  it('preserves sort_order across multiple rules in the same category', async () => {
    const result = await resolveCollectionPins(
      [
        makeRule({ id: 10, ruleType: 'pin_collection_fallback', ruleValue: 'second',  category: 'Body', sortOrder: 1 }),
        makeRule({ id: 11, ruleType: 'pin_collection_fallback', ruleValue: 'first',   category: 'Body', sortOrder: 0 }),
      ],
      async (h) => h === 'first' ? ['gid://x/a'] : ['gid://x/b'],
    )
    expect(result.Body).toEqual(['gid://x/a', 'gid://x/b'])
  })

  it('dedupes product IDs across rules in the same category (first appearance wins)', async () => {
    const result = await resolveCollectionPins(
      [
        makeRule({ id: 10, ruleType: 'pin_collection_fallback', ruleValue: 'c1', category: 'Play', sortOrder: 0 }),
        makeRule({ id: 11, ruleType: 'pin_collection_fallback', ruleValue: 'c2', category: 'Play', sortOrder: 1 }),
      ],
      async (h) => h === 'c1' ? ['gid://x/1', 'gid://x/2'] : ['gid://x/2', 'gid://x/3'],
    )
    expect(result.Play).toEqual(['gid://x/1', 'gid://x/2', 'gid://x/3'])
  })

  it('caches identical handles across categories (one fetch per handle)', async () => {
    const calls: string[] = []
    await resolveCollectionPins(
      [
        makeRule({ id: 10, ruleType: 'pin_collection_fallback', ruleValue: 'shared', category: 'Body' }),
        makeRule({ id: 11, ruleType: 'pin_collection_fallback', ruleValue: 'shared', category: 'Wear' }),
      ],
      async (h) => { calls.push(h); return ['gid://x/1'] },
    )
    expect(calls).toEqual(['shared']) // fetched once, not twice
  })

  it('skips rules without a category', async () => {
    const calls: string[] = []
    const result = await resolveCollectionPins(
      [makeRule({ id: 10, ruleType: 'pin_collection_fallback', ruleValue: 'foo', category: null })],
      async (h) => { calls.push(h); return ['gid://x/1'] },
    )
    expect(result).toEqual({})
    expect(calls).toEqual([])
  })
})

describe('fillFallbacks with collection-pin tier', () => {
  it('uses collection pins only after handle pins are exhausted', () => {
    const rail = makeRail('Body', [])
    const pinRules: DiscoveryRule[] = [
      makeRule({ id: 1, ruleType: 'pin_fallback', ruleValue: 'lube-1', category: 'Body', sortOrder: 0 }),
    ]
    const collectionIds = { Body: [catalog.find(p => p.handle === 'lube-2')!.id] }
    const result = fillFallbacks(rail, pinRules, catalog, 2, new Set(), collectionIds)
    expect(result.items.map(sp => sp.product.handle)).toEqual(['lube-1', 'lube-2'])
  })

  it('skips collection-pin products that do not belong to the rail category', () => {
    const rail = makeRail('Body', [])
    // Inject a Play product ID into Body's collection pins — should be skipped.
    const collectionIds = { Body: [catalog.find(p => p.handle === 'wand-1')!.id] }
    const result = fillFallbacks(rail, [], catalog, 4, new Set(), collectionIds)
    expect(result.items.length).toBe(0)
  })

  it('skips collection-pin products that were excluded by other rules', () => {
    const rail = makeRail('Body', [])
    // Filter the catalog to drop lube-1 — simulating an exclusion rule already
    // having removed it from `filteredIndex`. fillFallbacks should silently
    // skip the pin even though the resolver returned it.
    const filtered = catalog.filter(p => p.handle !== 'lube-1')
    const lube1Id = catalog.find(p => p.handle === 'lube-1')!.id
    const lube2Id = catalog.find(p => p.handle === 'lube-2')!.id
    const collectionIds = { Body: [lube1Id, lube2Id] }
    const result = fillFallbacks(rail, [], filtered, 4, new Set(), collectionIds)
    expect(result.items.map(sp => sp.product.handle)).toEqual(['lube-2'])
  })

  it('respects alreadyIncludedIds across rails', () => {
    const rail = makeRail('Body', [])
    const lube1Id = catalog.find(p => p.handle === 'lube-1')!.id
    const alreadyIn = new Set([lube1Id]) // lube-1 surfaced in another rail
    const collectionIds = { Body: [lube1Id, catalog.find(p => p.handle === 'lube-2')!.id] }
    const result = fillFallbacks(rail, [], catalog, 4, alreadyIn, collectionIds)
    expect(result.items.map(sp => sp.product.handle)).toEqual(['lube-2'])
  })
})

// ---------------------------------------------------------------------------
// cleanCollectionHandle
// ---------------------------------------------------------------------------

import { cleanCollectionHandle } from './discovery-rules.server'

describe('cleanCollectionHandle', () => {
  const cases: Array<[string, string]> = [
    ['lubricants',                                       'lubricants'],
    ['  Lubricants  ',                                   'lubricants'],
    ['lubricants?matters=beginner-friendly',             'lubricants'],
    ['lubricants#variants',                              'lubricants'],
    ['/collections/lubricants',                          'lubricants'],
    ['/collections/lubricants/subpath',                  'lubricants'],
    ['/lubricants',                                      'lubricants'],
    ['https://xdipx.com/collections/lubricants',         'lubricants'],
    ['https://xdipx.com/collections/lubricants?a=1',     'lubricants'],
    ['http://xdipx.com/collections/lubricants/foo',      'lubricants'],
    ['',                                                 ''],
    ['   ',                                              ''],
  ]
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(cleanCollectionHandle(input)).toBe(expected)
    })
  }
})

describe('fillFallbacks with honorary products', () => {
  it('uses an honorary product when the collection-pin ID is not in the filtered index', () => {
    const rail = makeRail('Body', [])
    // Pin a product ID that's NOT in the catalog at all — simulating a Body-rail
    // pin pointing to a lubes collection where the lubes products aren't in
    // the Body top-level nav. fetchHonoraryProducts would have hydrated them
    // and forced category=Body upstream.
    const honorary = [
      makeProduct({ handle: 'honorary-lube-1', category: 'Body', title: 'Pinned Lube' }),
    ]
    const collectionIds = { Body: [honorary[0]!.id] }
    const honoraryByCategory = { Body: honorary }
    const result = fillFallbacks(rail, [], catalog, 4, new Set(), collectionIds, honoraryByCategory)
    expect(result.items.map(sp => sp.product.handle)).toEqual(['honorary-lube-1'])
  })

  it('prefers the indexed copy over the honorary one when both exist for the same ID', () => {
    const rail = makeRail('Body', [])
    const indexedLube = catalog.find(p => p.handle === 'lube-1')!
    const honorary = [makeProduct({ handle: 'lube-1', category: 'Body', title: 'Ghost copy' })]
    // Both share the same ID — byId should keep the indexed entry, not overwrite.
    const collectionIds = { Body: [indexedLube.id] }
    const result = fillFallbacks(rail, [], catalog, 4, new Set(), collectionIds, { Body: honorary })
    expect(result.items[0]?.product.title).toBe('Water-Based Lube') // indexed title, not the honorary "Ghost copy"
  })
})
