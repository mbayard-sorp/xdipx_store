// Card-art doctrine gate (ticket #9675, design-critic run 905 P1: supplier
// packshots rendering as rail/grid card art breached design-doctrine.md
// §4.3's on-site imagery ceiling). xdipx.card_art_blocked must suppress a
// product's default image from every card-shaped conversion path, falling
// back to xdipx.mood_image_url when present and to no image otherwise.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

const mf = (entries: Record<string, string>) =>
  Object.entries(entries).map(([key, value]) => ({ namespace: 'xdipx', key, value }))

describe('nodeToVaultDeal card-art gate', () => {
  it('suppresses images entirely when blocked with no mood image', async () => {
    const { nodeToVaultDeal } = await import('~/lib/shopify.server')
    const deal = nodeToVaultDeal({
      id: 'gid://shopify/Product/1',
      handle: 'flagged-product',
      title: 'Flagged Product',
      vendor: 'test',
      tags: [],
      images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: null } }] },
      variants: { edges: [{ node: { id: 'gid://v1', price: { amount: '10.00' }, compareAtPrice: null, quantityAvailable: 5, availableForSale: true } }] },
      metafields: mf({ card_art_blocked: 'true' }),
    })
    expect(deal.images).toEqual([])
  })

  it('falls back to the reviewed mood image when blocked and one is set', async () => {
    const { nodeToVaultDeal } = await import('~/lib/shopify.server')
    const deal = nodeToVaultDeal({
      id: 'gid://shopify/Product/2',
      handle: 'flagged-with-mood',
      title: 'Flagged With Mood',
      vendor: 'test',
      tags: [],
      images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: null } }] },
      variants: { edges: [{ node: { id: 'gid://v2', price: { amount: '10.00' }, compareAtPrice: null, quantityAvailable: 5, availableForSale: true } }] },
      metafields: mf({ card_art_blocked: 'true', mood_image_url: 'https://cdn.shopify.com/mood.jpg' }),
    })
    expect(deal.images).toEqual([{ url: 'https://cdn.shopify.com/mood.jpg', altText: '' }])
  })

  it('passes images through unchanged when not blocked', async () => {
    const { nodeToVaultDeal } = await import('~/lib/shopify.server')
    const deal = nodeToVaultDeal({
      id: 'gid://shopify/Product/3',
      handle: 'clean-product',
      title: 'Clean Product',
      vendor: 'test',
      tags: [],
      images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: 'front' } }] },
      variants: { edges: [{ node: { id: 'gid://v3', price: { amount: '10.00' }, compareAtPrice: null, quantityAvailable: 5, availableForSale: true } }] },
      metafields: mf({}),
    })
    expect(deal.images).toEqual([{ url: 'https://cdn.shopify.com/packshot.jpg', altText: 'front' }])
  })
})

function stubStorefront(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { nodes } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const productNode = (handle: string, metafields: { namespace: string; key: string; value: string }[]) => ({
  __typename: 'Product',
  id: `gid://shopify/Product/${handle}`,
  handle,
  title: handle,
  description: '',
  descriptionHtml: '',
  vendor: 'test',
  productType: '',
  tags: [],
  images: { edges: [{ node: { url: 'https://cdn.shopify.com/packshot.jpg', altText: null } }] },
  variants: { edges: [] },
  priceRange: { minVariantPrice: { amount: '1.00', currencyCode: 'USD' } },
  metafields,
})

describe('nodeToProduct card-art gate (via getProductsByIds)', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('suppresses the default image on the list/rail Product shape when blocked', async () => {
    stubStorefront([productNode('flagged', mf({ card_art_blocked: 'true' }))])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://flagged'])
    expect(product?.images).toEqual([])
  })

  it('leaves the default image alone when not blocked', async () => {
    stubStorefront([productNode('clean', mf({}))])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const [product] = await getProductsByIds(['gid://clean'])
    expect(product?.images).toEqual([{ url: 'https://cdn.shopify.com/packshot.jpg', altText: '' }])
  })
})
