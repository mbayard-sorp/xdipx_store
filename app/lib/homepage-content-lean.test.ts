// Unit tests for buildHomeContentBlocksLean() (PR-3 hydration payload diet).
// Mirrors the mocking style of homepage-payload.test.ts, but this suite
// exercises the Sanity/Shopify fan-out path, so getHomepageSections and the
// Shopify product fetchers are mocked out.
import { describe, it, expect, vi } from 'vitest'
import type { Product } from '~/types'
import type { HomepageSections } from '~/types/cms'

vi.mock('~/lib/sanity.server', () => ({
  getHomepageSections: vi.fn(),
}))

vi.mock('~/lib/shopify.server', () => ({
  getProductsByTag: vi.fn(),
  getCollectionProducts: vi.fn(),
  getProductsByHandles: vi.fn(),
}))

import { getHomepageSections } from '~/lib/sanity.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import {
  buildHomeContentBlocksLean,
  VARIANT_B_SECTION_TYPES,
} from './homepage-payload.server'

const mockGetHomepageSections = vi.mocked(getHomepageSections)
const mockGetProductsByHandles = vi.mocked(getProductsByHandles)

/** Full Shopify `Product` fixture — deliberately fat (variants, tags, every
 *  image) so the test can assert the lean map strips it down. */
function makeFatProduct(handle: string): Product {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: `Product ${handle}`,
    seoTitle: `SEO ${handle}`,
    metaDescription: 'a long meta description',
    images: [
      { url: `https://cdn/${handle}-1.jpg`, altText: 'one' },
      { url: `https://cdn/${handle}-2.jpg`, altText: 'two' },
      { url: `https://cdn/${handle}-3.jpg`, altText: 'three' },
    ],
    videos: [
      { previewImageUrl: 'https://cdn/preview1.jpg', sources: [{ url: 'https://cdn/v1.mp4', mimeType: 'video/mp4' }] },
      { previewImageUrl: 'https://cdn/preview2.jpg', sources: [{ url: 'https://cdn/v2.mp4', mimeType: 'video/mp4' }] },
    ],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/1',
        title: 'Default',
        selectedOptions: [{ name: 'Color', value: 'Black' }],
        price: '19.99',
        compareAtPrice: null,
        availableForSale: true,
        quantityAvailable: 10,
      },
    ],
    price: 19.99,
    compareAtPrice: 29.99,
    brand: 'Acme',
    tags: ['tag1', 'tag2', 'tag3'],
    category: 'Pleasure',
    rating: { value: 4.5, count: 12 },
  }
}

function makeSections(): HomepageSections {
  return {
    _id: 'homepage',
    sections: [
      {
        _type: 'trustBar', _key: 'trust1', active: true, order: 0,
        trustItems: [{ icon: 'lock', headline: 'Discreet' }],
      },
      {
        _type: 'categoryGrid', _key: 'cat1', active: true, order: 1,
        heading: 'Shop by category', items: [], columns: 3,
      },
      {
        _type: 'productCarousel', _key: 'carousel1', active: true, order: 2,
        heading: 'Legacy carousel', source: 'manual',
        productHandles: [{ handle: 'legacy-product' }], productLimit: 8,
      },
      {
        _type: 'promoBanner', _key: 'promo1', active: true, order: 3,
        headline: 'Sale', ctaLabel: 'Shop now', ctaLink: '/collections/sale',
        layout: 'text-only', bgStyle: 'mist',
      },
      {
        _type: 'emmaCuratedRail', _key: 'rail1', active: true, order: 4,
        heading: "Emma's edit",
        productHandles: [{ handle: 'lean-product-a' }, { handle: 'lean-product-b' }],
      },
      {
        _type: 'editorialTiles', _key: 'tiles1', active: true, order: 5,
        heading: 'From the Notebook', tiles: [],
      },
    ],
  } as HomepageSections
}

function setupMocks() {
  mockGetHomepageSections.mockResolvedValue(makeSections())
  mockGetProductsByHandles.mockImplementation(async (handles: string[]) => {
    if (handles.includes('legacy-product')) return [makeFatProduct('legacy-product')]
    return handles.map(makeFatProduct)
  })
}

describe('buildHomeContentBlocksLean', () => {
  it('keeps only VARIANT_B_SECTION_TYPES members in sections', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    expect(result.sections.length).toBeGreaterThan(0)
    for (const s of result.sections) {
      expect(VARIANT_B_SECTION_TYPES).toContain(s._type)
    }
    // Shell-owned / legacy types must not survive.
    const types = result.sections.map(s => s._type)
    expect(types).not.toContain('trustBar')
    expect(types).not.toContain('categoryGrid')
    expect(types).not.toContain('productCarousel')
    expect(types).not.toContain('promoBanner')
    expect(types).toContain('emmaCuratedRail')
    expect(types).toContain('editorialTiles')
  })

  it('every product in the lean map has exactly the whitelisted keys, truncated media, no variants/tags', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    const products = result.carouselProductMap['rail1'] ?? []
    expect(products.length).toBeGreaterThan(0)
    const expectedKeys = ['id', 'handle', 'title', 'price', 'compareAtPrice', 'brand', 'images', 'videos'].sort()
    for (const p of products) {
      expect(Object.keys(p).sort()).toEqual(expectedKeys)
      expect(p.images.length).toBeLessThanOrEqual(1)
      expect(p.videos === undefined || p.videos.length <= 1).toBe(true)
      expect((p as unknown as Record<string, unknown>)['variants']).toBeUndefined()
      expect((p as unknown as Record<string, unknown>)['tags']).toBeUndefined()
    }
  })

  it('carouselProductMap keys are only surviving emmaCuratedRail _keys (productCarousel key absent)', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    expect(Object.keys(result.carouselProductMap)).toEqual(['rail1'])
    expect(result.carouselProductMap['carousel1']).toBeUndefined()
  })

  it('JSON.stringify(result) never contains "variants"', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    expect(JSON.stringify(result)).not.toContain('"variants"')
  })

  it('type-level: any Product is assignable to LeanCardProduct', () => {
    // Compile-time-only assertion — `npm run typecheck` fails if LeanCardProduct
    // ever drifts to require a field Product doesn't have. The runtime
    // assertion just confirms the fixture object exists.
    const _check: import('~/types').LeanCardProduct = {} as Product
    expect(_check).toBeDefined()
  })
})
