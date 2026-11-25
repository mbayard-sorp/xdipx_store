// Ticket #24294: searchAll()'s featuredImage used to fall back to
// sp.previewImageUrl (raw, written straight from Shopify's featuredImage
// with no card-art doctrine gate applied — see gateCardImages() in
// shopify.server.ts) whenever shopify.images was empty, which is exactly the
// state a gated-with-no-mood-image product is supposed to be in, and also the
// state a genuine Shopify-lookup miss produces. Either way the fallback
// rendered the flagged frame instead of degrading toward the gate's own
// compliant default (hard rule #12616: a renderer missing a value a doctrine
// rule depends on must degrade TOWARD the rule, not away from it).
//
// getSearchClient() captures SANITY_PROJECT_ID at module load — set it
// before the dynamic import below so searchAll() takes the Sanity branch
// instead of short-circuiting to shopifyFallback().
process.env['SANITY_PROJECT_ID'] = 'test-project'

import { describe, expect, it, vi } from 'vitest'
import type { Product } from '~/types'

let nextFetchResult: unknown = null

vi.mock('@sanity/client', () => ({
  createClient: vi.fn(() => ({ fetch: vi.fn(async () => nextFetchResult) })),
}))

vi.mock('~/lib/shopify.server', () => ({
  getProductsByHandles: vi.fn(),
  searchProducts: vi.fn(),
  predictiveSearch: vi.fn(),
}))

const { searchAll } = await import('~/lib/search.server')
const { getProductsByHandles } = await import('~/lib/shopify.server')
const mockGetProductsByHandles = vi.mocked(getProductsByHandles)

/** The raw, ungated value sp.previewImageUrl would carry for a flagged SKU. */
const FLAGGED_URL = 'https://cdn/flagged-packshot.jpg'
const MOOD_URL = 'https://cdn/reviewed-mood.jpg'
const REAL_URL = 'https://cdn/real-bare-shot.jpg'

function sanityRow(handle: string) {
  return {
    handle,
    title: `Product ${handle}`,
    vendor: null,
    tags: [],
    category: null,
    previewImageUrl: FLAGGED_URL,
    shopifyId: `gid://shopify/Product/${handle}`,
  }
}

function makeProduct(handle: string, images: Array<{ url: string; altText?: string | null }>): Product {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: `Product ${handle}`,
    images,
    videos: [],
    variants: [],
    price: 19.99,
    compareAtPrice: null,
    brand: null,
    tags: [],
    category: null,
  } as unknown as Product
}

describe('searchAll never falls back to the ungated previewImageUrl (ticket #24294)', () => {
  it('not blocked: featuredImage is the real, gate-filtered image', async () => {
    nextFetchResult = { products: [sanityRow('not-blocked')], totalProducts: 1 }
    mockGetProductsByHandles.mockResolvedValue([
      makeProduct('not-blocked', [{ url: REAL_URL, altText: 'real' }]),
    ])

    const result = await searchAll({ query: 'test' })

    expect(result.products[0]?.featuredImage).toEqual({ url: REAL_URL, altText: 'real' })
  })

  it('blocked with a reviewed mood image: featuredImage is the mood image, never the flagged frame', async () => {
    nextFetchResult = { products: [sanityRow('blocked-mood')], totalProducts: 1 }
    // gateCardImages() returns [{ url: moodImageUrl, altText: '' }] for a
    // blocked product that has a reviewed mood image on file.
    mockGetProductsByHandles.mockResolvedValue([
      makeProduct('blocked-mood', [{ url: MOOD_URL, altText: '' }]),
    ])

    const result = await searchAll({ query: 'test' })

    expect(result.products[0]?.featuredImage).toEqual({ url: MOOD_URL, altText: '' })
  })

  it('blocked with no mood image: featuredImage is null, never the raw previewImageUrl fallback', async () => {
    nextFetchResult = { products: [sanityRow('blocked-bare')], totalProducts: 1 }
    // gateCardImages() returns [] for a blocked product with no mood image.
    mockGetProductsByHandles.mockResolvedValue([makeProduct('blocked-bare', [])])

    const result = await searchAll({ query: 'test' })

    expect(result.products[0]?.featuredImage).toBeNull()
  })

  it('Shopify lookup miss entirely: featuredImage is null, never the raw previewImageUrl fallback', async () => {
    nextFetchResult = { products: [sanityRow('missing-from-shopify')], totalProducts: 1 }
    mockGetProductsByHandles.mockResolvedValue([])

    const result = await searchAll({ query: 'test' })

    expect(result.products[0]?.featuredImage).toBeNull()
  })
})
