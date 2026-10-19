/**
 * Ticket #16273 — `syncVariantInventoryQuantity` (shopify.server.ts),
 * follow-up to #14756. The original version read only `variants[0]` and
 * wrote the SAME combined total to every location the item was stocked at,
 * which silently skipped every other variant on a multi-variant product and
 * double-counted the real on-hand once a product is stocked at both xdipx
 * locations (Nalpac + Entrenue). This now resyncs every variant by its own
 * SKU and sets each location from its own feed column.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { syncVariantInventoryQuantity, type VariantInventoryResyncTarget } from './shopify.server'

const ENTRENUE_ID = 85557510315
const NALPAC_ID   = 85557477547

const respond = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

describe('syncVariantInventoryQuantity (#16273)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resyncs every variant by its own SKU, routing each location to its own feed column', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url.includes('/products/')) {
        return respond({
          product: {
            variants: [
              { sku: 'A1', inventory_item_id: 555 },
              { sku: 'A2', inventory_item_id: 556 },
            ],
          },
        })
      }
      if (url.includes('inventory_item_ids=555')) {
        return respond({ inventory_levels: [{ location_id: NALPAC_ID }, { location_id: ENTRENUE_ID }] })
      }
      if (url.includes('inventory_item_ids=556')) {
        return respond({ inventory_levels: [{ location_id: NALPAC_ID }, { location_id: ENTRENUE_ID }] })
      }
      return respond({})
    }))

    const qtyBySku = new Map<string, VariantInventoryResyncTarget>([
      ['A1', { nalpacQty: 59, entrenueQty: 10 }],
      ['A2', { nalpacQty: 203, entrenueQty: 0 }],
    ])

    const result = await syncVariantInventoryQuantity('gid://shopify/Product/999', qtyBySku)

    const sets = calls.filter(c => c.url.includes('/inventory_levels/set.json')).map(c => c.body)
    expect(sets).toHaveLength(4)
    expect(sets).toContainEqual({ location_id: NALPAC_ID, inventory_item_id: 555, available: 59 })
    expect(sets).toContainEqual({ location_id: ENTRENUE_ID, inventory_item_id: 555, available: 10 })
    expect(sets).toContainEqual({ location_id: NALPAC_ID, inventory_item_id: 556, available: 203 })
    expect(sets).toContainEqual({ location_id: ENTRENUE_ID, inventory_item_id: 556, available: 0 })
    expect(result).toEqual({ resynced: 2, skippedNoFeedRow: 0, failed: 0 })
  })

  it('leaves a location untouched when its own feed column is null, instead of zeroing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) return respond({ product: { variants: [{ sku: 'A1', inventory_item_id: 555 }] } })
      if (url.includes('/inventory_levels.json')) return respond({ inventory_levels: [{ location_id: NALPAC_ID }, { location_id: ENTRENUE_ID }] })
      return respond({})
    }))

    const qtyBySku = new Map<string, VariantInventoryResyncTarget>([['A1', { nalpacQty: 59, entrenueQty: null }]])
    const result = await syncVariantInventoryQuantity('999', qtyBySku)

    const sets = vi.mocked(fetch).mock.calls.filter(c => String(c[0]).includes('/inventory_levels/set.json'))
    expect(sets).toHaveLength(1)
    expect(JSON.parse((sets[0]![1] as RequestInit).body as string)).toEqual({ location_id: NALPAC_ID, inventory_item_id: 555, available: 59 })
    expect(result).toEqual({ resynced: 1, skippedNoFeedRow: 0, failed: 0 })
  })

  it('counts a variant with no feed row for its SKU as skipped, not failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) return respond({ product: { variants: [{ sku: 'UNKNOWN-SKU', inventory_item_id: 555 }] } })
      return respond({})
    }))

    const result = await syncVariantInventoryQuantity('999', new Map())
    expect(result).toEqual({ resynced: 0, skippedNoFeedRow: 1, failed: 0 })
    // Never reached inventory_levels.json for a SKU with nothing to resync.
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes('/inventory_levels.json'))).toBe(false)
  })

  it('skips a variant with no sku or no inventory_item_id without counting it at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) {
        return respond({ product: { variants: [{ sku: null, inventory_item_id: 555 }, { sku: 'A1', inventory_item_id: null }] } })
      }
      return respond({})
    }))

    const qtyBySku = new Map<string, VariantInventoryResyncTarget>([['A1', { nalpacQty: 10, entrenueQty: 0 }]])
    const result = await syncVariantInventoryQuantity('999', qtyBySku)
    expect(result).toEqual({ resynced: 0, skippedNoFeedRow: 0, failed: 0 })
  })

  it('counts a per-variant error as failed and continues to the next variant', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) {
        return respond({ product: { variants: [{ sku: 'BAD', inventory_item_id: 555 }, { sku: 'GOOD', inventory_item_id: 556 }] } })
      }
      if (url.includes('inventory_item_ids=555')) return respond({ error: 'boom' }, 500)
      if (url.includes('inventory_item_ids=556')) return respond({ inventory_levels: [{ location_id: NALPAC_ID }] })
      return respond({})
    }))

    const qtyBySku = new Map<string, VariantInventoryResyncTarget>([
      ['BAD', { nalpacQty: 5, entrenueQty: 0 }],
      ['GOOD', { nalpacQty: 5, entrenueQty: 0 }],
    ])
    const result = await syncVariantInventoryQuantity('999', qtyBySku)
    expect(result).toEqual({ resynced: 1, skippedNoFeedRow: 0, failed: 1 })
  })

  it('counts a variant with no stocked location as skipped rather than resynced', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/products/')) return respond({ product: { variants: [{ sku: 'A1', inventory_item_id: 555 }] } })
      if (url.includes('/inventory_levels.json')) return respond({ inventory_levels: [] })
      return respond({})
    }))

    const qtyBySku = new Map<string, VariantInventoryResyncTarget>([['A1', { nalpacQty: 10, entrenueQty: 0 }]])
    const result = await syncVariantInventoryQuantity('999', qtyBySku)
    expect(result).toEqual({ resynced: 0, skippedNoFeedRow: 1, failed: 0 })
  })
})
