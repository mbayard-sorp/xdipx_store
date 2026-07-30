import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `invalidateHomeSeoCache` has to clear BOTH cache tiers. `invalidateCache` is
 * L1-only and per-serverless-instance; `kvDel` is the shared L2 half whose TTL
 * is ttl+60 (360s here). Clearing only one leaves a publish invisible at the
 * origin for minutes, including the negative-cached null that exists before the
 * singleton has ever been published.
 */
vi.mock('~/lib/kv.server', () => ({
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  invalidateCache: vi.fn(),
  kvDel: vi.fn(async () => undefined),
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
  kvGetMemo: vi.fn(async () => null),
  primeKvMemo: vi.fn(),
  isKvConfigured: vi.fn(() => false),
}))

const { HOME_SEO_KV_KEY, invalidateHomeSeoCache } = await import('~/lib/sanity.server')
const { invalidateCache, kvDel } = await import('~/lib/kv.server')

describe('invalidateHomeSeoCache', () => {
  beforeEach(() => {
    vi.mocked(invalidateCache).mockClear()
    vi.mocked(kvDel).mockClear()
  })

  it('clears the L1 tier with the home-seo key', async () => {
    await invalidateHomeSeoCache()
    expect(invalidateCache).toHaveBeenCalledWith(HOME_SEO_KV_KEY)
  })

  it('clears the L2 tier with the same key', async () => {
    await invalidateHomeSeoCache()
    expect(kvDel).toHaveBeenCalledWith(HOME_SEO_KV_KEY)
  })

  it('uses the literal key the loader reads through', () => {
    // `cached()` does not namespace, so this string IS the KV key. If it drifts
    // from getHomeSeo's key the purge silently stops working.
    expect(HOME_SEO_KV_KEY).toBe('sanity:home-seo')
  })
})
