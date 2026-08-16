// Regression test for ticket #3562: findVariantsBySkus silently failed every
// SKU lookup because its Admin GraphQL query fetched product metafields with
// the Storefront-only `metafields(identifiers: [...])` argument, which the
// Admin API rejects with "Field 'metafields' doesn't accept argument
// 'identifiers'". The error was caught and logged, so cost-sync (WS3) ran with
// pricing_costsync_enabled=true and did nothing at all, forever.
//
// This drives the real findVariantsBySkus. shopify.server.ts reaches KV and
// tag-normalize at module scope, so KV is mocked and the Admin call is a
// stubbed fetch. Two things are pinned: the outgoing query uses the Admin
// MetafieldConnection shape (namespace + keys + nodes, never identifiers), and
// the mapper reads metafields off `.nodes` — the array-shaped consumption that
// paired with the old query would throw here.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

function stubAdmin(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { productVariants: { nodes } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const variantNode = (sku: string, metafields: Array<{ namespace: string; key: string; value: string }>) => ({
  id: `gid://shopify/ProductVariant/${sku}`,
  sku,
  title: 'Default',
  price: '49.00',
  compareAtPrice: '69.00',
  inventoryItem: { id: `gid://shopify/InventoryItem/${sku}` },
  product: {
    id: `gid://shopify/Product/${sku}`,
    handle: `handle-${sku}`,
    title: `Product ${sku}`,
    vendor: 'Acme',
    productType: 'vibrator',
    // Admin API MetafieldConnection shape.
    metafields: { nodes: metafields },
  },
})

describe('findVariantsBySkus', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('queries product metafields with the Admin connection shape, not the Storefront identifiers argument', async () => {
    const fetchSpy = stubAdmin([])
    const { findVariantsBySkus } = await import('~/lib/shopify.server')
    await findVariantsBySkus(['ABC-123'])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as { query: string }
    // The exact defect: metafields(identifiers:...) is Storefront-only and the
    // Admin API rejects it. Assert the argument form is gone from the metafields call.
    expect(body.query).not.toMatch(/metafields\s*\(\s*identifiers/)
    // The correct Admin form: MetafieldConnection scoped by namespace + keys, read via nodes.
    expect(body.query).toMatch(/metafields\(\s*namespace:\s*"xdipx"/)
    expect(body.query).toMatch(/keys:\s*\[/)
    expect(body.query).toMatch(/nodes\s*\{/)
  })

  it('maps metafields read from the connection nodes into the result', async () => {
    stubAdmin([
      variantNode('ABC-123', [
        { namespace: 'xdipx', key: 'nalpac_sku', value: 'NAL-9' },
        { namespace: 'xdipx', key: 'wholesale_cost', value: '20.00' },
        { namespace: 'xdipx', key: 'map_price', value: '45.00' },
        { namespace: 'xdipx', key: 'original_price', value: '69.00' },
        { namespace: 'xdipx', key: 'map_restricted', value: 'true' },
      ]),
    ])
    const { findVariantsBySkus } = await import('~/lib/shopify.server')
    const out = await findVariantsBySkus(['ABC-123'])

    expect(out).toHaveLength(1)
    const m = out[0]!
    expect(m.variant.sku).toBe('ABC-123')
    expect(m.metafields.nalpacSku).toBe('NAL-9')
    expect(m.metafields.wholesaleCost).toBe(20)
    expect(m.metafields.mapPrice).toBe(45)
    expect(m.metafields.originalPrice).toBe(69)
    expect(m.metafields.mapRestricted).toBe(true)
  })

  it('handles a product with no matching metafields without throwing', async () => {
    stubAdmin([variantNode('NO-MF', [])])
    const { findVariantsBySkus } = await import('~/lib/shopify.server')
    const out = await findVariantsBySkus(['NO-MF'])

    expect(out).toHaveLength(1)
    expect(out[0]!.metafields.wholesaleCost).toBeNull()
    expect(out[0]!.metafields.mapRestricted).toBe(false)
  })

  it('short-circuits an empty sku list without calling Shopify', async () => {
    const fetchSpy = stubAdmin([])
    const { findVariantsBySkus } = await import('~/lib/shopify.server')
    await expect(findVariantsBySkus([])).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
