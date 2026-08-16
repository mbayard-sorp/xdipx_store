/**
 * parsePricingSnapshot: Shopify's Admin API returns metafield `key` as the
 * bare name ("map_price") when metafields are queried without a `keys`
 * filter, but as the fully qualified "namespace.key" form ("xdipx.map_price")
 * when queried WITH a `keys: [...]` filter, which is how every pricing query
 * asks for them. A lookup map keyed on the bare name alone misses every
 * fully qualified key, so MAP price, original price, and wholesale cost
 * parsed as null for every product since at least 2026-06-12 (ticket #3449).
 *
 * These tests pin both response shapes so a future query-shape change can't
 * silently reintroduce the miss.
 */
import { describe, expect, it } from 'vitest'
import { parsePricingSnapshot, normalizeMetafieldKey } from '~/lib/shopify.server'

function rawProduct(metafields: Array<{ namespace: string; key: string; value: string }>) {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'test-product',
    title: 'Test Product',
    vendor: 'Test Vendor',
    productType: 'Vibrator',
    variants: {
      nodes: [
        {
          id: 'gid://shopify/ProductVariant/1',
          sku: 'TEST-SKU-1',
          title: 'Default',
          price: '29.99',
          compareAtPrice: null,
          inventoryItem: { id: 'gid://shopify/InventoryItem/1', unitCost: null },
        },
      ],
    },
    metafields: { nodes: metafields },
  }
}

const FULLY_QUALIFIED_METAFIELDS = [
  { namespace: 'xdipx', key: 'xdipx.nalpac_sku', value: 'NAL-123' },
  { namespace: 'xdipx', key: 'xdipx.wholesale_cost', value: '12.50' },
  { namespace: 'xdipx', key: 'xdipx.map_price', value: '24.99' },
  { namespace: 'xdipx', key: 'xdipx.original_price', value: '39.99' },
  { namespace: 'xdipx', key: 'xdipx.map_restricted', value: 'true' },
]

const BARE_METAFIELDS = [
  { namespace: 'xdipx', key: 'nalpac_sku', value: 'NAL-123' },
  { namespace: 'xdipx', key: 'wholesale_cost', value: '12.50' },
  { namespace: 'xdipx', key: 'map_price', value: '24.99' },
  { namespace: 'xdipx', key: 'original_price', value: '39.99' },
  { namespace: 'xdipx', key: 'map_restricted', value: 'true' },
]

describe('parsePricingSnapshot', () => {
  it('parses fully qualified "namespace.key" metafield keys, the shape the `keys:` filter actually returns', () => {
    const snapshot = parsePricingSnapshot(rawProduct(FULLY_QUALIFIED_METAFIELDS))
    expect(snapshot).not.toBeNull()
    expect(snapshot!.metafields.mapPrice).toBe(24.99)
    expect(snapshot!.metafields.originalPrice).toBe(39.99)
    expect(snapshot!.metafields.wholesaleCost).toBe(12.5)
    expect(snapshot!.metafields.nalpacSku).toBe('NAL-123')
    expect(snapshot!.metafields.mapRestricted).toBe(true)
  })

  it('also parses bare metafield keys, so the fix does not break the unfiltered response shape', () => {
    const snapshot = parsePricingSnapshot(rawProduct(BARE_METAFIELDS))
    expect(snapshot).not.toBeNull()
    expect(snapshot!.metafields.mapPrice).toBe(24.99)
    expect(snapshot!.metafields.originalPrice).toBe(39.99)
    expect(snapshot!.metafields.wholesaleCost).toBe(12.5)
    expect(snapshot!.metafields.nalpacSku).toBe('NAL-123')
    expect(snapshot!.metafields.mapRestricted).toBe(true)
  })
})

describe('normalizeMetafieldKey', () => {
  it('strips the "namespace." prefix when present', () => {
    expect(normalizeMetafieldKey({ namespace: 'xdipx', key: 'xdipx.map_price' })).toBe('map_price')
  })

  it('passes bare keys through unchanged', () => {
    expect(normalizeMetafieldKey({ namespace: 'xdipx', key: 'map_price' })).toBe('map_price')
  })
})
