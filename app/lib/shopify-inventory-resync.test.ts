/**
 * Ticket #14756 — `syncVariantInventoryQuantity` (shopify.server.ts). Newly
 * published import products went live unsellable because
 * `createShopifyProductFromFeed` sets `inventory_quantity` once at import
 * time and nothing re-syncs it before the enrichment-delayed publish days
 * later. This is the REST resync helper `publishEnrichedProducts` now calls
 * at publish time with a fresh feed quantity.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { syncVariantInventoryQuantity } from './shopify.server'

const respond = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

describe('syncVariantInventoryQuantity (#14756)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the inventory item and its existing location(s), then sets the fresh quantity at each', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url.includes('/products/')) {
        return respond({ product: { variants: [{ inventory_item_id: 555 }] } })
      }
      if (url.includes('/inventory_levels.json')) {
        return respond({ inventory_levels: [{ location_id: 111 }, { location_id: 222 }] })
      }
      return respond({})
    }))

    await syncVariantInventoryQuantity('gid://shopify/Product/999', 2137)

    const sets = calls.filter(c => c.url.includes('/inventory_levels/set.json'))
    expect(sets).toHaveLength(2)
    expect(sets[0]!.body).toEqual({ location_id: 111, inventory_item_id: 555, available: 2137 })
    expect(sets[1]!.body).toEqual({ location_id: 222, inventory_item_id: 555, available: 2137 })
  })

  it('accepts a bare numeric id the same as a gid, and no-ops quietly with no variant', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) return respond({ product: { variants: [] } })
      return respond({})
    }))

    await expect(syncVariantInventoryQuantity('999', 10)).resolves.toBeUndefined()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1) // never reached inventory_levels.json
  })

  it('no-ops quietly when the item has no known location yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) return respond({ product: { variants: [{ inventory_item_id: 555 }] } })
      if (url.includes('/inventory_levels.json')) return respond({ inventory_levels: [] })
      return respond({})
    }))

    await expect(syncVariantInventoryQuantity('999', 10)).resolves.toBeUndefined()
    const sets = vi.mocked(fetch).mock.calls.filter(c => String(c[0]).includes('/inventory_levels/set.json'))
    expect(sets).toHaveLength(0)
  })
})
