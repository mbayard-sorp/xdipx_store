// Unit tests for the PR-4 homepage-performance cache-window widening
// (60s -> 300s edge cache for variant b). storefront-home.server.ts pulls in
// several server modules with real upstreams (discovery index, Sanity,
// sensation map), so those are mocked out — these tests only exercise the
// pure railSeedBucket helper and the STOREFRONT_EDGE_CACHE_HEADERS constant.
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/discovery.server', () => ({
  getDiscoveryIndex: vi.fn(),
  getDiscoveryRails: vi.fn(),
}))

vi.mock('~/lib/homepage-payload.server', () => ({
  buildHomeContentBlocksLean: vi.fn(),
}))

vi.mock('~/lib/sensation-map.server', () => ({
  getSensationMapData: vi.fn(),
}))

vi.mock('~/lib/sanity.server', () => ({
  getEmmaHeroSettings: vi.fn(),
  getBlogPosts: vi.fn(),
  getEditor: vi.fn(),
}))

import { railSeedBucket, STOREFRONT_EDGE_CACHE_HEADERS } from './storefront-home.server'

describe('railSeedBucket', () => {
  it('returns the same bucket for two timestamps inside one 300s window', () => {
    const base = Date.UTC(2026, 6, 22, 12, 0, 0)
    const a = railSeedBucket(base)
    const b = railSeedBucket(base + 299_000) // 4:59 later, still inside the bucket
    expect(a).toBe(b)
  })

  it('returns a different bucket once the timestamp crosses a 300s boundary', () => {
    const base = Date.UTC(2026, 6, 22, 12, 0, 0)
    const a = railSeedBucket(base)
    const b = railSeedBucket(base + 300_000) // exactly one bucket later
    expect(b).toBe(a + 1)
  })

  it('defaults to Date.now() when called with no argument', () => {
    const before = Math.floor(Date.now() / 300_000)
    const bucket = railSeedBucket()
    const after = Math.floor(Date.now() / 300_000)
    expect(bucket).toBeGreaterThanOrEqual(before)
    expect(bucket).toBeLessThanOrEqual(after)
  })
})

describe('STOREFRONT_EDGE_CACHE_HEADERS', () => {
  it('sets a 300s s-maxage with 600s stale-while-revalidate on Cache-Control', () => {
    expect(STOREFRONT_EDGE_CACHE_HEADERS['Cache-Control']).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    )
  })

  it('sets a 300s s-maxage with 900s stale-while-revalidate on Vercel-CDN-Cache-Control', () => {
    expect(STOREFRONT_EDGE_CACHE_HEADERS['Vercel-CDN-Cache-Control']).toBe(
      'public, s-maxage=300, stale-while-revalidate=900',
    )
  })
})
