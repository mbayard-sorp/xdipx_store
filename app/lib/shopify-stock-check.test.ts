/**
 * getProductStockCheck (ticket #11154): an uncached Storefront read of a
 * product's current availability, for callers that cannot tolerate the PDP's
 * edge-cache staleness (the video-render routine's Step 3 stock re-check).
 * Deliberately bypasses `cached()` — every call must hit Shopify.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  // A stock-check call must never go through the cache wrapper at all.
  cached: vi.fn(() => { throw new Error('stock-check must not use cached()') }),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

const { getProductStockCheck } = await import('~/lib/shopify.server')

const respond = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response

describe('getProductStockCheck', () => {
  it('returns null when Shopify answers and the product does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: { product: null } })))
    await expect(getProductStockCheck('gone-for-real')).resolves.toBeNull()
    vi.unstubAllGlobals()
  })

  it('is available when any variant is availableForSale, and surfaces the nalpac_sku metafield', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({
      data: {
        product: {
          handle: 'satin-wand',
          totalInventory: 12,
          variants: {
            edges: [
              { node: { id: 'v1', title: 'Pink', availableForSale: false, quantityAvailable: 0 } },
              { node: { id: 'v2', title: 'Black', availableForSale: true, quantityAvailable: 12 } },
            ],
          },
          metafields: [{ namespace: 'xdipx', key: 'nalpac_sku', value: 'AB123' }],
        },
      },
    })))
    const stock = await getProductStockCheck('satin-wand')
    expect(stock).toEqual({
      handle: 'satin-wand',
      availableForSale: true,
      totalInventory: 12,
      nalpacSku: 'AB123',
      variants: [
        { id: 'v1', title: 'Pink', availableForSale: false, quantityAvailable: 0 },
        { id: 'v2', title: 'Black', availableForSale: true, quantityAvailable: 12 },
      ],
    })
    vi.unstubAllGlobals()
  })

  it('is unavailable when no variant is availableForSale', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({
      data: {
        product: {
          handle: 'sold-out-thing',
          totalInventory: 0,
          variants: { edges: [{ node: { id: 'v1', title: 'Default', availableForSale: false, quantityAvailable: 0 } }] },
          metafields: [],
        },
      },
    })))
    const stock = await getProductStockCheck('sold-out-thing')
    expect(stock?.availableForSale).toBe(false)
    expect(stock?.nalpacSku).toBeNull()
    vi.unstubAllGlobals()
  })

  it('throws on a Storefront transport error rather than returning a false positive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({}, false, 502)))
    await expect(getProductStockCheck('live-product')).rejects.toThrow()
    vi.unstubAllGlobals()
  })
})
