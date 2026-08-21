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
import { getProductsByHandles, getCollectionProducts } from '~/lib/shopify.server'
import {
  buildHomeContentBlocksLean,
  getAnchorCollectionProducts,
  DEFAULT_ANCHOR_COLLECTION_HANDLE,
  VARIANT_B_SECTION_TYPES,
} from './homepage-payload.server'

const mockGetHomepageSections = vi.mocked(getHomepageSections)
const mockGetProductsByHandles = vi.mocked(getProductsByHandles)
const mockGetCollectionProducts = vi.mocked(getCollectionProducts)

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
      {
        _type: 'homepageFaq', _key: 'faq1', active: true, order: 6,
        heading: 'Questions, answered.',
        faqItems: [{ question: 'How discreet is shipping?', answer: 'Plain packaging.' }],
      },
      {
        _type: 'playTogetherBanner', _key: 'couples1', active: true, order: 7,
        heading: 'Better together.', body: 'For two.',
        ctaLabel: 'Show me', ctaLink: '/collections/couples', imagePosition: 'right',
        productHandles: [{ handle: 'couples-product-a' }],
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
    expect(types).not.toContain('categoryGrid')
    expect(types).not.toContain('productCarousel')
    expect(types).not.toContain('promoBanner')
    expect(types).toContain('emmaCuratedRail')
    expect(types).toContain('editorialTiles')
    // trustBar and homepageFaq are content-controlled now, NOT shell-owned.
    // They used to be filtered out here, which is exactly why the hero trust
    // strip and the FAQ band stayed hardcoded arrays no agent could edit.
    expect(types).toContain('trustBar')
    expect(types).toContain('homepageFaq')
    expect(types).toContain('playTogetherBanner')
  })

  it('carries published trustBar items through to the lean payload', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    const trust = result.sections.find(s => s._type === 'trustBar')
    expect(trust).toBeDefined()
    expect((trust as { trustItems?: { headline: string }[] }).trustItems?.[0]?.headline)
      .toBe('Discreet')
  })

  it('carries published homepageFaq items through to the lean payload', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    const faq = result.sections.find(s => s._type === 'homepageFaq')
    expect(faq).toBeDefined()
    // The visible accordion and the FAQPage JSON-LD both read this array, so it
    // must survive the lean slim intact.
    expect((faq as { faqItems?: { question: string }[] }).faqItems).toHaveLength(1)
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

  it('carouselProductMap keys are only surviving product-bearing _keys (productCarousel key absent)', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    // The curated rail plus the couples band, which now resolves its own
    // "chosen for sharing" strip. The legacy productCarousel is filtered out of
    // variant b, so its key must not ride along.
    expect(Object.keys(result.carouselProductMap).sort()).toEqual(['couples1', 'rail1'])
    expect(result.carouselProductMap['carousel1']).toBeUndefined()
  })

  it('resolves the couples band productHandles into the map (the strip was dead code)', async () => {
    setupMocks()
    const result = await buildHomeContentBlocksLean()
    expect(result.carouselProductMap['couples1']?.map(p => p.handle)).toEqual(['couples-product-a'])
  })

  it('a rejecting couples fetch costs only its own strip, never the whole payload', async () => {
    // Regression cover for the failure mode PR #322 fixed: every homepage block
    // resolves inside one Promise.all, so one bad block used to reject the whole
    // contentBlocks build and blank every team-published section for days.
    mockGetHomepageSections.mockResolvedValue(makeSections())
    mockGetProductsByHandles.mockImplementation(async (handles: string[]) => {
      if (handles.includes('couples-product-a')) throw new Error('shopify down')
      return handles.map(makeFatProduct)
    })

    const result = await buildHomeContentBlocksLean()

    expect(result.carouselProductMap['couples1']).toEqual([])
    // The curated rail is untouched by its neighbour's failure.
    expect(result.carouselProductMap['rail1']?.length).toBeGreaterThan(0)
    expect(result.sections.map(s => s._type)).toContain('emmaCuratedRail')
  })

  it('a rejecting emmaCuratedRail fetch costs only its own strip, never the whole payload (#4739)', async () => {
    // Same failure mode as the couples regression above, but for the
    // emmaCuratedRail leg. PR #322 hardened only couples; the rail leg stayed
    // unprotected inside the shared Promise.all, so one rail whose Shopify fetch
    // rejects blanked every team-published section on the live homepage — the
    // exact render-truth outage this ticket fixes.
    mockGetHomepageSections.mockResolvedValue(makeSections())
    mockGetProductsByHandles.mockImplementation(async (handles: string[]) => {
      if (handles.includes('lean-product-a')) throw new Error('shopify down')
      return handles.map(makeFatProduct)
    })

    const result = await buildHomeContentBlocksLean()

    // The whole team surface still renders — sections are NOT blanked.
    expect(result.sections.length).toBeGreaterThan(0)
    expect(result.sections.map(s => s._type)).toContain('emmaCuratedRail')
    expect(result.sections.map(s => s._type)).toContain('playTogetherBanner')
    // The bad rail costs only its own products.
    expect(result.carouselProductMap['rail1']).toEqual([])
    // Its neighbour (the couples strip) is untouched.
    expect(result.carouselProductMap['couples1']?.length).toBeGreaterThan(0)
  })

  it('a rejecting productCarousel fetch costs only its own strip, never the whole payload (#4739)', async () => {
    // productCarousel is filtered out of variant b, but its products are still
    // resolved inside buildHomeContentBlocks (shared with variant A), in the
    // same Promise.all — so a rejecting carousel fetch could blank the whole
    // lean payload too, even though the carousel section itself never renders.
    mockGetHomepageSections.mockResolvedValue(makeSections())
    mockGetProductsByHandles.mockImplementation(async (handles: string[]) => {
      if (handles.includes('legacy-product')) throw new Error('shopify down')
      return handles.map(makeFatProduct)
    })

    const result = await buildHomeContentBlocksLean()

    // The surviving variant-b sections still render.
    expect(result.sections.length).toBeGreaterThan(0)
    expect(result.sections.map(s => s._type)).toContain('emmaCuratedRail')
    // The healthy rail resolved its own products despite the carousel's failure.
    expect(result.carouselProductMap['rail1']?.length).toBeGreaterThan(0)
  })

  it('tolerates bare-string productHandles on the couples band', async () => {
    // The array exists in the dataset in two shapes; a bare string used to
    // collapse to null in a GROQ object projection and throw downstream.
    const sections = makeSections()
    const couples = sections.sections.find(s => s._type === 'playTogetherBanner')
    ;(couples as { productHandles?: unknown }).productHandles = ['couples-product-a', null, '']
    mockGetHomepageSections.mockResolvedValue(sections)
    mockGetProductsByHandles.mockImplementation(async (handles: string[]) =>
      handles.map(makeFatProduct),
    )

    const result = await buildHomeContentBlocksLean()

    expect(result.carouselProductMap['couples1']?.map(p => p.handle)).toEqual(['couples-product-a'])
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

describe('getAnchorCollectionProducts — Nº 03 grid source (ticket #464)', () => {
  it('reads from the configured collection handle, slimmed to lean cards', async () => {
    mockGetCollectionProducts.mockResolvedValue([makeFatProduct('a'), makeFatProduct('b')])
    const lean = await getAnchorCollectionProducts('curated-picks')
    expect(mockGetCollectionProducts).toHaveBeenCalledWith('curated-picks', expect.any(Number))
    expect(lean.map(p => p.handle)).toEqual(['a', 'b'])
    // Slimmed: the fat Product's variants never ride along in the payload.
    expect(JSON.stringify(lean)).not.toContain('"variants"')
  })

  it('defaults to the best-sellers collection when the handle is unset/blank', async () => {
    mockGetCollectionProducts.mockResolvedValue([makeFatProduct('x')])
    await getAnchorCollectionProducts(undefined)
    expect(mockGetCollectionProducts).toHaveBeenCalledWith(DEFAULT_ANCHOR_COLLECTION_HANDLE, expect.any(Number))
    mockGetCollectionProducts.mockClear()
    await getAnchorCollectionProducts('   ')
    expect(mockGetCollectionProducts).toHaveBeenCalledWith(DEFAULT_ANCHOR_COLLECTION_HANDLE, expect.any(Number))
  })

  it('degrades to [] on an empty collection or a failed Shopify leg (discovery fallback)', async () => {
    mockGetCollectionProducts.mockResolvedValue([])
    expect(await getAnchorCollectionProducts('empty-one')).toEqual([])
    mockGetCollectionProducts.mockRejectedValue(new Error('shopify down'))
    expect(await getAnchorCollectionProducts('best-sellers')).toEqual([])
  })
})
