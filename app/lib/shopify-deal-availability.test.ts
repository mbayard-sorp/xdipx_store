/**
 * getDealByHandle: "Shopify said no" vs "Shopify said nothing".
 *
 * Collapsing those two into `null` is what put live PDPs into Search Console
 * as "Not found (404)" — the lookup raced the fetch against a 5s timeout that
 * resolved to `null`, the PDP loader read `null` as gone and threw a 404, and
 * `cached()` pinned that verdict for the full read TTL. These tests lock the
 * distinction in place: only a real answer may ever become a 404, and an
 * outage must never be written to the cache.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const writes: Array<{ key: string; data: unknown }> = []

vi.mock('~/lib/kv.server', () => ({
  // Cache-miss passthrough that records what would have been stored, so a test
  // can assert an outage never reaches the cache.
  cached: async <T,>(key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => {
    const data = await fn()
    writes.push({ key, data })
    return data
  },
  invalidateCache: vi.fn(),
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
  KV_KEYS: {},
}))

const { getDealByHandle, StorefrontUnavailableError } = await import('~/lib/shopify.server')

/** One Storefront HTTP response. */
const respond = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response

const PRODUCT = {
  id: 'gid://shopify/Product/1',
  handle: 'test-handle',
  title: 'Test Product',
  descriptionHtml: '',
  tags: [],
  productType: '',
  vendor: '',
  images: { edges: [] },
  variants: { edges: [] },
  metafields: [],
  options: [],
  priceRange: { minVariantPrice: { amount: '10.00', currencyCode: 'USD' } },
}

beforeEach(() => {
  writes.length = 0
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getDealByHandle', () => {
  it('returns null when Shopify answers and the product does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: { product: null } })))
    await expect(getDealByHandle('gone-for-real')).resolves.toBeNull()
  })

  it('caches that genuine miss — a real 404 is worth remembering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: { product: null } })))
    await getDealByHandle('gone-for-real')
    expect(writes).toHaveLength(1)
    expect(writes[0]!.data).toBeNull()
  })

  it('throws StorefrontUnavailableError when the Storefront API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({}, false, 502)))
    await expect(getDealByHandle('live-product')).rejects.toBeInstanceOf(StorefrontUnavailableError)
  })

  it('throws StorefrontUnavailableError on a GraphQL-level error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ errors: [{ message: 'Throttled' }] })))
    await expect(getDealByHandle('live-product')).rejects.toBeInstanceOf(StorefrontUnavailableError)
  })

  it('never caches an outage, so one bad call cannot pin a 404 for the TTL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({}, false, 502)))
    await expect(getDealByHandle('live-product')).rejects.toThrow()
    expect(writes).toHaveLength(0)
  })

  it('throws rather than resolving null when Shopify is too slow to answer', async () => {
    vi.useFakeTimers()
    // A fetch that never settles: the 5s budget is the only thing that fires.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const p = getDealByHandle('slow-product')
    const assertion = expect(p).rejects.toBeInstanceOf(StorefrontUnavailableError)
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    expect(writes).toHaveLength(0)
  })

  it('names the handle so a 503 in the logs is traceable to a product', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({}, false, 502)))
    await expect(getDealByHandle('prowler-red-cub-socks')).rejects.toThrow(/prowler-red-cub-socks/)
  })

  it('still returns the product on the happy path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: { product: PRODUCT } })))
    const deal = await getDealByHandle('test-handle')
    expect(deal?.handle).toBe('test-handle')
  })
})
