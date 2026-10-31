/**
 * Ticket #18009 (tracker p2-1-pseo): the quality gate for the programmatic
 * SEO pilot. A combination with fewer than PSEO_MIN_PRODUCTS live products
 * must never reach the sitemap, and `getPseoCombo` must resolve an unknown
 * tag or type slug to null rather than an empty-but-"found" result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DiscoveryProduct } from '~/types/discovery'

const { getAskEmmaVocabulary, getDiscoveryIndex } = vi.hoisted(() => ({
  getAskEmmaVocabulary: vi.fn(),
  getDiscoveryIndex: vi.fn(),
}))
vi.mock('~/lib/ask-emma-vocab.server', () => ({ getAskEmmaVocabulary }))
vi.mock('~/lib/discovery.server', () => ({ getDiscoveryIndex }))

import { getPseoCombo, getPseoCombosForSitemap, getPseoTags, PSEO_MIN_PRODUCTS, PSEO_SITEMAP_LIMIT } from './pseo-combos.server'

function product(overrides: Partial<DiscoveryProduct> = {}): DiscoveryProduct {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'test-product',
    title: 'Test Product',
    defaultVariantId: null,
    price: 10,
    priceMax: null,
    compareAtPrice: null,
    mapPrice: null,
    colorValues: [],
    sizeValues: [],
    imageUrl: null,
    imageAlt: null,
    category: 'Pleasure',
    subcategory: 'Vibrators',
    brand: null,
    mood: [],
    audience: [],
    matters: [],
    totalInventory: null,
    productType: null,
    productTypeDial: null,
    discontinuedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getAskEmmaVocabulary.mockResolvedValue({
    mood: ['playful'],
    audience: ['couples'],
  })
})

describe('getPseoTags', () => {
  it('normalizes vocab values to the same Title-Case form the discovery index stores', async () => {
    const tags = await getPseoTags()
    const playful = tags.find(t => t.slug === 'playful')
    expect(playful?.normalized).toBe('Playful')
  })

  it('dedupes by slug', async () => {
    getAskEmmaVocabulary.mockResolvedValue({ mood: ['playful'], audience: ['playful'] })
    const tags = await getPseoTags()
    expect(tags.filter(t => t.slug === 'playful')).toHaveLength(1)
  })
})

describe('getPseoCombo', () => {
  it('returns null for an unknown type slug', async () => {
    getDiscoveryIndex.mockResolvedValue([])
    const combo = await getPseoCombo('playful', 'not-a-real-type')
    expect(combo).toBeNull()
  })

  it('returns null for an unknown tag slug', async () => {
    getDiscoveryIndex.mockResolvedValue([])
    const combo = await getPseoCombo('not-a-real-tag', 'vibrator')
    expect(combo).toBeNull()
  })

  it('matches products by normalized tag across mood/audience/matters, and type dial', async () => {
    getDiscoveryIndex.mockResolvedValue([
      product({ handle: 'a', mood: ['Playful'], productTypeDial: 'vibrator' }),
      product({ handle: 'b', audience: ['Playful'], productTypeDial: 'vibrator' }),
      product({ handle: 'c', mood: ['Playful'], productTypeDial: 'lube' }), // wrong type
      product({ handle: 'd', mood: ['Romantic'], productTypeDial: 'vibrator' }), // wrong tag
    ])
    const combo = await getPseoCombo('playful', 'vibrator')
    expect(combo?.products.map(p => p.handle).sort()).toEqual(['a', 'b'])
  })

  it('excludes discontinued products', async () => {
    getDiscoveryIndex.mockResolvedValue([
      product({ handle: 'live', mood: ['Playful'], productTypeDial: 'vibrator' }),
      product({ handle: 'gone', mood: ['Playful'], productTypeDial: 'vibrator', discontinuedAt: '2026-01-01' }),
    ])
    const combo = await getPseoCombo('playful', 'vibrator')
    expect(combo?.products.map(p => p.handle)).toEqual(['live'])
  })
})

describe('getPseoCombosForSitemap', () => {
  it('excludes combinations below PSEO_MIN_PRODUCTS', async () => {
    const thin = Array.from({ length: PSEO_MIN_PRODUCTS - 1 }, (_, i) =>
      product({ handle: `thin-${i}`, mood: ['Playful'], productTypeDial: 'vibrator' }))
    getDiscoveryIndex.mockResolvedValue(thin)

    const combos = await getPseoCombosForSitemap()
    expect(combos.find(c => c.tagSlug === 'playful' && c.typeSlug === 'vibrator')).toBeUndefined()
  })

  it('includes a combination at or above PSEO_MIN_PRODUCTS', async () => {
    const enough = Array.from({ length: PSEO_MIN_PRODUCTS }, (_, i) =>
      product({ handle: `ok-${i}`, mood: ['Playful'], productTypeDial: 'vibrator' }))
    getDiscoveryIndex.mockResolvedValue(enough)

    const combos = await getPseoCombosForSitemap()
    const match = combos.find(c => c.tagSlug === 'playful' && c.typeSlug === 'vibrator')
    expect(match?.count).toBe(PSEO_MIN_PRODUCTS)
  })

  it('never returns more than the requested limit, defaulting to PSEO_SITEMAP_LIMIT', async () => {
    // Every mood/audience value crossed with every type, well above the limit.
    getAskEmmaVocabulary.mockResolvedValue({
      mood: ['playful', 'romantic', 'bold', 'curious', 'tender'],
      audience: ['couples', 'solo', 'first-time'],
    })
    const index: DiscoveryProduct[] = []
    for (const tag of ['Playful', 'Romantic', 'Bold', 'Curious', 'Tender', 'Couples', 'Solo', 'First-Time']) {
      for (const type of ['vibrator', 'dildo', 'massage', 'lube', 'wear'] as const) {
        for (let i = 0; i < PSEO_MIN_PRODUCTS; i++) {
          index.push(product({ handle: `${tag}-${type}-${i}`, mood: [tag], productTypeDial: type }))
        }
      }
    }
    getDiscoveryIndex.mockResolvedValue(index)

    const combos = await getPseoCombosForSitemap()
    expect(combos.length).toBeLessThanOrEqual(PSEO_SITEMAP_LIMIT)

    const capped = await getPseoCombosForSitemap(3)
    expect(capped).toHaveLength(3)
  })

  it('ranks by product count descending', async () => {
    const index: DiscoveryProduct[] = [
      ...Array.from({ length: PSEO_MIN_PRODUCTS }, (_, i) =>
        product({ handle: `fewer-${i}`, mood: ['Playful'], productTypeDial: 'vibrator' })),
      ...Array.from({ length: PSEO_MIN_PRODUCTS + 5 }, (_, i) =>
        product({ handle: `more-${i}`, audience: ['Couples'], productTypeDial: 'massage' })),
    ]
    getDiscoveryIndex.mockResolvedValue(index)

    const combos = await getPseoCombosForSitemap()
    expect(combos[0]?.tagSlug).toBe('couples')
    expect(combos[0]?.typeSlug).toBe('massage')
  })
})
