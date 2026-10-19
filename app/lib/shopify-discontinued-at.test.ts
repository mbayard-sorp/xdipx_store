// Regression test for ticket #16326: the nightly discontinued sweep guarded
// its one-time `discontinued_at` write with a KV-backed Set that silently
// falls back to per-instance memory on any real KV failure (kv.server.ts),
// so the guard could read back empty for a SKU already marked days earlier
// and re-stamp the metafield with today's date on every run. getDiscontinuedAtForProducts
// reads the metafield straight from Shopify so the sweep's write guard has a
// source of truth independent of that cache.
import { describe, expect, it, vi, afterEach } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

function stubAdmin(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { nodes } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('getDiscontinuedAtForProducts', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('maps each product id to its current discontinued_at value', async () => {
    stubAdmin([
      { id: 'gid://shopify/Product/1', metafield: { value: '2026-09-20' } },
      { id: 'gid://shopify/Product/2', metafield: null },
    ])
    const { getDiscontinuedAtForProducts } = await import('~/lib/shopify.server')
    const out = await getDiscontinuedAtForProducts(['1', '2'])
    expect(out.get('1')).toBe('2026-09-20')
    expect(out.get('2')).toBeNull()
  })

  it('accepts bare numeric ids and keys the result by bare numeric id', async () => {
    stubAdmin([{ id: 'gid://shopify/Product/42', metafield: { value: '2026-10-01' } }])
    const { getDiscontinuedAtForProducts } = await import('~/lib/shopify.server')
    const out = await getDiscontinuedAtForProducts(['gid://shopify/Product/42'])
    expect(out.get('42')).toBe('2026-10-01')
  })

  it('skips null nodes (an id Shopify could not resolve) instead of throwing', async () => {
    stubAdmin([null, { id: 'gid://shopify/Product/3', metafield: { value: '2026-09-01' } }])
    const { getDiscontinuedAtForProducts } = await import('~/lib/shopify.server')
    const out = await getDiscontinuedAtForProducts(['missing', '3'])
    expect(out.get('3')).toBe('2026-09-01')
    expect(out.size).toBe(1)
  })

  it('short-circuits an empty id list without calling Shopify', async () => {
    const fetchSpy = stubAdmin([])
    const { getDiscontinuedAtForProducts } = await import('~/lib/shopify.server')
    await expect(getDiscontinuedAtForProducts([])).resolves.toEqual(new Map())
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
