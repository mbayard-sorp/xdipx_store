// Regression test for ticket #3563: getWholesaleCostBySKU silently resolved an
// unresolvable wholesale cost to 0. The product is located by a
// `tag:nalpac-sku-<sku>` Storefront search, and that tag exists on only some
// products; on a miss the old code returned parseFloat(undefined ?? '0') === 0.
// That 0 was written into the xdipx.profit_<sku> order metafield and, being
// indistinguishable from a real zero, inflated the line to 100% margin in
// daily_profit_summary. The function now returns null (UNKNOWN) on any miss so
// the profit summary can exclude the line instead of counting it as pure profit.
//
// Drives the real getWholesaleCostBySKU through a stubbed fetch, with KV mocked
// at module scope (shopify.server.ts touches KV on import), mirroring
// shopify-nodes.test.ts.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

function stubStorefront(edges: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { products: { edges } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const edgeWithCost = (value: string) => ({
  node: { metafields: [{ key: 'wholesale_cost', value }] },
})

describe('getWholesaleCostBySKU', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns the parsed cost when the metafield resolves', async () => {
    stubStorefront([edgeWithCost('12.50')])
    const { getWholesaleCostBySKU } = await import('~/lib/shopify.server')
    await expect(getWholesaleCostBySKU('TAGGED-1')).resolves.toBe(12.5)
  })

  it('returns null (UNKNOWN), never 0, when no product matches the nalpac-sku tag', async () => {
    // The exact defect: an untagged SKU finds no product. Old code returned 0.
    stubStorefront([])
    const { getWholesaleCostBySKU } = await import('~/lib/shopify.server')
    await expect(getWholesaleCostBySKU('37041')).resolves.toBeNull()
  })

  it('returns null when the product carries no wholesale_cost metafield', async () => {
    stubStorefront([{ node: { metafields: [] } }])
    const { getWholesaleCostBySKU } = await import('~/lib/shopify.server')
    await expect(getWholesaleCostBySKU('NO-MF')).resolves.toBeNull()
  })

  it('returns null when the metafield value does not parse to a number', async () => {
    stubStorefront([edgeWithCost('free')])
    const { getWholesaleCostBySKU } = await import('~/lib/shopify.server')
    await expect(getWholesaleCostBySKU('BAD')).resolves.toBeNull()
  })
})
