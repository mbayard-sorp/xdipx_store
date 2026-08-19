import { describe, expect, it } from 'vitest'
import type { DiscoveryProduct } from '~/types/discovery'
import {
  familyKey,
  dedupeByFamily,
  applySanityFloor,
  mixPriceBands,
  rotate,
  resolveLane,
  resolveShelf,
  DEFAULT_SHELF_CONTENT,
  type ResolveOptions,
} from './curiosity-shelf'
import type { CuriosityLane } from '~/types/curiosity'
import { SHELF_SLOTS } from '~/types/curiosity'

/** Minimal DiscoveryProduct factory — only the fields the resolver reads matter. */
function mk(p: Partial<DiscoveryProduct> & { id: string; handle: string }): DiscoveryProduct {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title ?? p.handle,
    defaultVariantId: null,
    price: p.price ?? 50,
    priceMax: null,
    compareAtPrice: p.compareAtPrice ?? null,
    mapPrice: null,
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
    totalInventory: p.totalInventory === undefined ? null : p.totalInventory,
    productType: p.productType ?? null,
    productTypeDial: p.productTypeDial ?? null,
  }
}

/** N products of one typeDial, priced across a spread, distinct families. */
function typePool(dial: string, n: number, priceAt: (i: number) => number): DiscoveryProduct[] {
  return Array.from({ length: n }, (_, i) =>
    mk({ id: `${dial}${i}`, handle: `${dial}-${i}`, title: `${dial} model ${i}`, productTypeDial: dial, price: priceAt(i) }),
  )
}

const OPTS = (dayBucket = 0): ResolveOptions => ({
  dayBucket,
  verifiedCollections: new Set(['vibrators', 'couples', 'lubricants', 'wear', 'best-sellers']),
})

const lane = (over: Partial<CuriosityLane> & { key: string }): CuriosityLane => ({
  label: over.label ?? over.key,
  key: over.key,
  emmaLine: over.emmaLine ?? '',
  productHandles: over.productHandles ?? [],
  backfill: over.backfill ?? { typeDial: 'vibrator', mood: null, minPrice: null, maxPrice: null },
  seeAllHandle: over.seeAllHandle ?? 'vibrators',
  enabled: over.enabled ?? true,
})

// ── 1. family dedupe collapses a size trio, cheapest-with-image survives ──────
describe('dedupeByFamily', () => {
  it('collapses the Prowler RED jeans trio to one; the cheapest with an image survives', () => {
    const jeans = [
      mk({ id: 'j-l', handle: 'prowler-red-jeans-l', title: 'Prowler RED Jeans (Large)', brand: 'Prowler RED', price: 420 }),
      mk({ id: 'j-m', handle: 'prowler-red-jeans-m', title: 'Prowler RED Jeans (Medium)', brand: 'Prowler RED', price: 400 }),
      mk({ id: 'j-s', handle: 'prowler-red-jeans-s', title: 'Prowler RED Jeans (Small)', brand: 'Prowler RED', price: 380, imageUrl: null }),
    ]
    expect(new Set(jeans.map(familyKey)).size).toBe(1)
    const survivors = dedupeByFamily(jeans)
    expect(survivors).toHaveLength(1)
    // j-s is cheapest but imageless; j-m is the cheapest WITH an image.
    expect(survivors[0]!.id).toBe('j-m')
  })

  // ── 2. a curated handle beats its algorithmic sibling in the same family ────
  it('lets a curated member win its family over a cheaper algorithmic sibling', () => {
    const curated = mk({ id: 'j-l', handle: 'jeans-l', title: 'Prowler RED Jeans (Large)', brand: 'Prowler RED', price: 420 })
    const sibling = mk({ id: 'j-m', handle: 'jeans-m', title: 'Prowler RED Jeans (Medium)', brand: 'Prowler RED', price: 400 })
    const survivors = dedupeByFamily([curated, sibling], p => p.id === 'j-l')
    expect(survivors).toHaveLength(1)
    expect(survivors[0]!.id).toBe('j-l')
  })
})

// ── 3. a lane whose backfill cannot reach six is dropped ──────────────────────
describe('resolveLane', () => {
  it('drops a lane that cannot honestly fill six after filtering', () => {
    const index = typePool('vibrator', 3, () => 50) // only three
    expect(resolveLane(lane({ key: 'hums' }), index, 0, OPTS())).toBeNull()
  })

  // ── 5. backfilled products never cross the lane typeDial ────────────────────
  it('never backfills a product outside the lane typeDial', () => {
    const index = [...typePool('lube', 8, i => 12 + i), ...typePool('vibrator', 8, i => 30 + i)]
    const resolved = resolveLane(lane({ key: 'slick', backfill: { typeDial: 'lube', mood: null, minPrice: null, maxPrice: null }, seeAllHandle: 'lubricants' }), index, 0, OPTS())
    expect(resolved).not.toBeNull()
    expect(resolved!.deck.every(p => p.productTypeDial === 'lube')).toBe(true)
  })

  // ── 6. $150 ceiling excludes $418.99; a maxPrice:500 lane admits it ─────────
  it('applies the $150 ceiling by default and honours a per-lane maxPrice override', () => {
    const wear = [
      ...typePool('wear', 5, i => 20 + i),
      mk({ id: 'w-lux', handle: 'wear-lux', title: 'lux teddy', productTypeDial: 'wear', price: 418.99 }),
    ]
    // Default ceiling: the $418.99 item is excluded, leaving only five → dropped.
    const capped = lane({ key: 'worn', backfill: { typeDial: 'wear', mood: null, minPrice: null, maxPrice: null }, seeAllHandle: 'wear' })
    expect(resolveLane(capped, wear, 0, OPTS())).toBeNull()
    // maxPrice 500: the sixth item is admitted and the lane fills.
    const raised = lane({ key: 'worn', backfill: { typeDial: 'wear', mood: null, minPrice: null, maxPrice: 500 }, seeAllHandle: 'wear' })
    const resolved = resolveLane(raised, wear, 0, OPTS())
    expect(resolved).not.toBeNull()
    expect(resolved!.deck).toHaveLength(SHELF_SLOTS)
    expect(resolved!.deck.some(p => p.id === 'w-lux')).toBe(true)
  })

  // ── 7. every shipped page of six has ≥2 under $40 and ≤2 over $80 ───────────
  it('composes every page of six with at least 2 under $40 and at most 2 over $80', () => {
    // 4 low, 4 mid, 4 high → a full 12-deck of two pages.
    const prices = [20, 25, 30, 35, 50, 55, 60, 70, 90, 100, 110, 120]
    const index = prices.map((price, i) => mk({ id: `v${i}`, handle: `v-${i}`, title: `v ${i}`, productTypeDial: 'vibrator', price }))
    const resolved = resolveLane(lane({ key: 'hums' }), index, 0, OPTS())
    expect(resolved).not.toBeNull()
    expect(resolved!.deck).toHaveLength(12)
    for (const start of [0, 6]) {
      const page = resolved!.deck.slice(start, start + 6)
      expect(page.filter(p => p.price < 40).length).toBeGreaterThanOrEqual(2)
      expect(page.filter(p => p.price > 80).length).toBeLessThanOrEqual(2)
    }
  })

  // ── 8. deck rotation changes page-0 day over day; curated hold position ─────
  it('rotates the backfill tail across day buckets while pinning curated to the front', () => {
    // All mid-priced so the price-mix does not reorder — rotation shows through.
    const index = typePool('vibrator', 12, () => 55)
    index.unshift(mk({ id: 'cur', handle: 'curated-pick', title: 'curated pick', productTypeDial: 'vibrator', price: 55 }))
    const withCurated = lane({ key: 'hums', productHandles: ['curated-pick'] })
    const day0 = resolveLane(withCurated, index, 0, OPTS(0))!
    const day1 = resolveLane(withCurated, index, 0, OPTS(1))!
    // Curated pick holds position 0 on both days.
    expect(day0.deck[0]!.handle).toBe('curated-pick')
    expect(day1.deck[0]!.handle).toBe('curated-pick')
    // The backfilled page-0 set differs between the two days.
    const set0 = day0.deck.slice(0, 6).map(p => p.handle).join(',')
    const set1 = day1.deck.slice(0, 6).map(p => p.handle).join(',')
    expect(set0).not.toBe(set1)
  })

  // ── 10. seeAllHref resolves to a verified collection, else drops to null ─────
  it('validates seeAllHandle against the verified list and drops the See-all when unverified', () => {
    const index = typePool('vibrator', 8, i => 30 + i)
    const good = resolveLane(lane({ key: 'hums', seeAllHandle: 'vibrators' }), index, 0, OPTS())!
    expect(good.seeAllHref).toBe('/collections/vibrators')
    // Mission brief §1: no silent best-sellers fallback for an auto-generated
    // module. An unverified handle renders NO See-all rather than a mismatch.
    const bad = resolveLane(lane({ key: 'hums', seeAllHandle: 'does-not-exist' }), index, 0, OPTS())!
    expect(bad.seeAllHref).toBeNull()
    // An empty authored handle (the partial-doc default) also drops the See-all,
    // never accidentally verifying against a live best-sellers collection.
    const empty = resolveLane(lane({ key: 'hums', seeAllHandle: '' }), index, 0, OPTS())!
    expect(empty.seeAllHref).toBeNull()
    // best-sellers is no longer magic: even if it is a real collection it only
    // renders when a lane genuinely authored it AND it verifies as in-stock.
    const bestSellersUnverified = resolveLane(
      lane({ key: 'hums', seeAllHandle: 'best-sellers' }),
      index,
      0,
      { dayBucket: 0, verifiedCollections: new Set(['vibrators']) },
    )!
    expect(bestSellersUnverified.seeAllHref).toBeNull()
  })
})

// ── 4. fewer than three surviving lanes → resolveShelf returns null ───────────
describe('resolveShelf', () => {
  it('returns null when fewer than three lanes survive', () => {
    const index = typePool('vibrator', 8, i => 30 + i) // only the vibrator lane can fill
    const content = {
      ...DEFAULT_SHELF_CONTENT,
      lanes: [
        DEFAULT_SHELF_CONTENT.lanes[0]!, // vibrator — fills
        DEFAULT_SHELF_CONTENT.lanes[2]!, // couples — no products → dropped
        DEFAULT_SHELF_CONTENT.lanes[3]!, // lube — no products → dropped
      ],
    }
    expect(resolveShelf(content, index, OPTS())).toBeNull()
  })

  // ── 9. absent/invalid Sanity doc → the code-side DEFAULT_LANES render ───────
  it('renders the default shelf content when three lanes can fill', () => {
    const index = [
      ...typePool('vibrator', 8, i => 20 + i * 5),
      ...typePool('couples', 8, i => 30 + i * 5),
      ...typePool('lube', 8, i => 12 + i),
    ]
    const shelf = resolveShelf(DEFAULT_SHELF_CONTENT, index, OPTS())
    expect(shelf).not.toBeNull()
    expect(shelf!.heading).toBe('What are you curious about?')
    expect(shelf!.emphasis).toBe('curious')
    expect(shelf!.lanes.length).toBeGreaterThanOrEqual(3)
    expect(shelf!.lanes.every(l => l.deck.length >= SHELF_SLOTS)).toBe(true)
  })
})

// ── supporting pure helpers ───────────────────────────────────────────────────
describe('pure helpers', () => {
  it('rotate wraps and handles negatives without mutating', () => {
    const a = [1, 2, 3, 4]
    expect(rotate(a, 1)).toEqual([2, 3, 4, 1])
    expect(rotate(a, -1)).toEqual([4, 1, 2, 3])
    expect(rotate(a, 4)).toEqual([1, 2, 3, 4])
    expect(a).toEqual([1, 2, 3, 4])
  })

  it('applySanityFloor keeps everything for a null dial and filters by type otherwise', () => {
    const pool = [...typePool('vibrator', 2, () => 40), ...typePool('lube', 2, () => 15)]
    expect(applySanityFloor(pool, null)).toHaveLength(4)
    expect(applySanityFloor(pool, 'lube').every(p => p.productTypeDial === 'lube')).toBe(true)
  })

  it('mixPriceBands honours the caps when the buckets allow', () => {
    const pool = [20, 25, 30, 50, 90, 100, 110].map((price, i) =>
      mk({ id: `p${i}`, handle: `p-${i}`, price }),
    )
    const page = mixPriceBands(pool, 6)
    expect(page).toHaveLength(6)
    expect(page.filter(p => p.price < 40).length).toBeGreaterThanOrEqual(2)
    expect(page.filter(p => p.price > 80).length).toBeLessThanOrEqual(2)
  })
})
