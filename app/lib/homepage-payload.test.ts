import { describe, expect, it } from 'vitest'
import {
  assertJsonSafe,
  reshuffleRailsWithSeed,
  HOMEPAGE_PAYLOAD_VERSION,
  HOMEPAGE_PAYLOAD_B_VERSION,
  HOMEPAGE_PAYLOAD_B_KV_KEY,
  VARIANT_B_SECTION_TYPES,
  type HomepagePayloadA,
} from './homepage-payload.server'
import type { Rail } from '~/types/discovery'

function makeRail(category: 'Pleasure' | 'Play' | 'Body' | 'Wear', n: number): Rail {
  return {
    category,
    score: 1,
    total: n,
    items: Array.from({ length: n }, (_, i) => ({
      score: n - i,
      product: {
        id: `gid://shopify/Product/${category}-${i}`,
        handle: `${category.toLowerCase()}-${i}`,
        title: `Item ${i}`,
        defaultVariantId: null,
        price: 10 + i,
        priceMax: null,
        compareAtPrice: null,
        colorValues: [],
        sizeValues: [],
        imageUrl: null,
        imageAlt: null,
        category,
        subcategory: 'X',
        brand: null,
        mood: [],
        audience: [],
        matters: [],
        totalInventory: null,
        productType: null,
        productTypeDial: null,
      },
    })),
  }
}

function makePayload(): HomepagePayloadA {
  return {
    version: HOMEPAGE_PAYLOAD_VERSION,
    variant: 'a',
    rails: [makeRail('Pleasure', 5), makeRail('Body', 3)],
    total: 8,
    welcomeBackEnabled: true,
    moods: ['cozy'],
    audiences: ['solo'],
    matters: ['Whisper-quiet'],
    available: { moods: ['cozy'], audiences: ['solo'], matters: ['Whisper-quiet'] },
    sections: [],
    carouselProductMap: {},
    builtAt: 1_700_000_000_000,
    degraded: false,
  }
}

describe('assertJsonSafe', () => {
  it('passes a clean payload and survives a deep JSON round-trip', () => {
    const p = makePayload()
    expect(() => assertJsonSafe(p)).not.toThrow()
    // The exact bug class that poisoned the sitemap (Set -> {}): the payload
    // must be byte-identical after a JSON round-trip.
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
  })

  it('detects a Date corrupting builtAt (would survive as a string, not a number)', () => {
    const p = makePayload()
    // @ts-expect-error — deliberately inject a non-JSON-safe value
    p.builtAt = new Date(1_700_000_000_000)
    expect(() => assertJsonSafe(p)).toThrow(/builtAt/)
  })
})

describe('VARIANT_B_SECTION_TYPES', () => {
  it('lets the team own the trust strip and the FAQ band', () => {
    // Both blocks already existed in Sanity and were already projected, but this
    // whitelist filtered them out of variant b, which is why the hero trust
    // strip and the FAQ were hardcoded arrays no agent could reach.
    expect(VARIANT_B_SECTION_TYPES).toContain('trustBar')
    expect(VARIANT_B_SECTION_TYPES).toContain('homepageFaq')
  })

  it('still carries the merchandising surfaces the storefront reads', () => {
    for (const t of ['emmaCuratedRail', 'editorialTiles', 'wayfinderMosaic', 'playTogetherBanner']) {
      expect(VARIANT_B_SECTION_TYPES).toContain(t)
    }
  })
})

describe('HOMEPAGE_PAYLOAD_B_VERSION', () => {
  it('is past b4, so blobs built before the panelDeck field miss', () => {
    // The blob is read verbatim from KV and Neon. Shipping a new payload shape
    // without bumping this serves the OLD shape until the caches expire, and
    // none of the new content appears live. b5 added `panelDeck`: a b4 blob has
    // no such field, so the deck would stay invisible after the team published
    // it.
    expect(HOMEPAGE_PAYLOAD_B_VERSION).not.toBe('b3')
    expect(HOMEPAGE_PAYLOAD_B_VERSION).not.toBe('b4')
    expect(HOMEPAGE_PAYLOAD_B_VERSION).toBe('b5')
  })

  it('embeds the version in the KV key so old blobs cannot be read back', () => {
    expect(HOMEPAGE_PAYLOAD_B_KV_KEY).toContain(HOMEPAGE_PAYLOAD_B_VERSION)
  })
})

describe('reshuffleRailsWithSeed', () => {
  it('is deterministic for a given seed', () => {
    const rails = [makeRail('Pleasure', 5)]
    const a = reshuffleRailsWithSeed(rails, 42)
    const b = reshuffleRailsWithSeed(rails, 42)
    expect(a[0]!.items.map(i => i.product.id)).toEqual(b[0]!.items.map(i => i.product.id))
  })

  it('preserves the exact item set (permutation only, no add/drop)', () => {
    const rails = [makeRail('Pleasure', 5)]
    const out = reshuffleRailsWithSeed(rails, 7)
    expect(out[0]!.items.map(i => i.product.id).sort())
      .toEqual(rails[0]!.items.map(i => i.product.id).sort())
  })

  it('does not mutate the input rails', () => {
    const rails = [makeRail('Pleasure', 5)]
    const before = rails[0]!.items.map(i => i.product.id)
    reshuffleRailsWithSeed(rails, 99)
    expect(rails[0]!.items.map(i => i.product.id)).toEqual(before)
  })

  it('leaves single-item and empty rails untouched', () => {
    const rails = [makeRail('Body', 1), makeRail('Wear', 0)]
    const out = reshuffleRailsWithSeed(rails, 3)
    expect(out[0]!.items).toHaveLength(1)
    expect(out[1]!.items).toHaveLength(0)
  })
})
