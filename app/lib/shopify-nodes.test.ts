// Regression test for the 2026-07-29 PDP 500.
//
// Shopify's Storefront `nodes(ids:)` returns null for any id it cannot resolve,
// which is what a deleted or unpublished product looks like once something
// still holds its gid. The `accessory_product_ids` and `pairing_why` metafields
// hold exactly those gids and are never cleaned up when a product goes away, so
// getProductsByIds' unguarded `n.__typename` threw a TypeError and took the
// whole PDP down with a 500. /products/diy-vibrating-dildo-kit-light-skin-tone
// was serving 500 in production off one dangling accessory reference.
//
// This drives the real getProductsByIds. shopify.server.ts reaches KV and
// tag-normalize at module scope, so KV is mocked and the Storefront call is a
// stubbed fetch returning the exact `[null]` shape Shopify sends back.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

const productNode = (handle: string) => ({
  __typename: 'Product',
  id: `gid://shopify/Product/${handle}`,
  handle,
  title: handle,
  description: '',
  descriptionHtml: '',
  vendor: 'test',
  productType: '',
  tags: [],
  images: { edges: [] },
  variants: { edges: [] },
  priceRange: { minVariantPrice: { amount: '1.00', currencyCode: 'USD' } },
  metafields: [],
})

function stubStorefront(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { nodes } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('getProductsByIds', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('skips gids Shopify cannot resolve instead of throwing', async () => {
    stubStorefront([productNode('alive'), null, productNode('also-alive')])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    const out = await getProductsByIds(['gid://a', 'gid://dangling', 'gid://b'])
    expect(out.map(p => p.handle)).toEqual(['alive', 'also-alive'])
  })

  it('returns empty when every reference is dangling', async () => {
    stubStorefront([null, null])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    await expect(getProductsByIds(['gid://x', 'gid://y'])).resolves.toEqual([])
  })

  it('short-circuits an empty id list without calling Shopify', async () => {
    const fetchSpy = stubStorefront([])
    const { getProductsByIds } = await import('~/lib/shopify.server')
    await expect(getProductsByIds([])).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
