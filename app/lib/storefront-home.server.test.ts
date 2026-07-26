// Unit tests for the homepage-performance cache-window widening
// (60s -> 300s -> 900s edge cache for variant b) and the precomputed
// storefront payload's read-time hydration. storefront-home.server.ts pulls in
// several server modules with real upstreams (discovery index, Sanity,
// sensation map), so those are mocked out — these tests exercise the pure
// railSeedBucket helper, the STOREFRONT_EDGE_CACHE_HEADERS constant, and
// hydrateStorefrontPayloadB, none of which touch an upstream.
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/discovery.server', () => ({
  getDiscoveryIndex: vi.fn(),
  getDiscoveryRails: vi.fn(),
}))

vi.mock('~/lib/homepage-payload.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/homepage-payload.server')>(
    '~/lib/homepage-payload.server',
  )
  return {
    // reshuffleRailsWithSeed is pure — keep the real one so hydration is
    // exercised end-to-end rather than against a stub.
    reshuffleRailsWithSeed: actual.reshuffleRailsWithSeed,
    HOMEPAGE_PAYLOAD_B_VERSION: actual.HOMEPAGE_PAYLOAD_B_VERSION,
    buildHomeContentBlocksLean: vi.fn(() => Promise.resolve({ sections: [], carouselProductMap: {} })),
    readHomepagePayloadB: vi.fn(),
    writeHomepagePayloadB: vi.fn(),
    triggerHomepageWarmB: vi.fn(),
  }
})

vi.mock('~/lib/sensation-map.server', () => ({
  getSensationMapData: vi.fn(),
}))

vi.mock('~/lib/sanity.server', () => ({
  getEmmaHeroSettings: vi.fn(),
  getBlogPosts: vi.fn(),
  getEditor: vi.fn(),
}))

import {
  railSeedBucket,
  RAIL_SEED_BUCKET_MS,
  STOREFRONT_EDGE_CACHE_HEADERS,
  hydrateStorefrontPayloadB,
} from './storefront-home.server'
import { HOMEPAGE_PAYLOAD_B_VERSION, type HomepagePayloadB } from './homepage-payload.server'
import type { DiscoveryProduct, Rail } from '~/types/discovery'

describe('railSeedBucket', () => {
  it('returns the same bucket for two timestamps inside one window', () => {
    const base = Date.UTC(2026, 6, 22, 12, 0, 0)
    const a = railSeedBucket(base)
    const b = railSeedBucket(base + RAIL_SEED_BUCKET_MS - 1_000) // still inside
    expect(a).toBe(b)
  })

  it('returns a different bucket once the timestamp crosses a window boundary', () => {
    const base = Date.UTC(2026, 6, 22, 12, 0, 0)
    const a = railSeedBucket(base)
    const b = railSeedBucket(base + RAIL_SEED_BUCKET_MS) // exactly one bucket later
    expect(b).toBe(a + 1)
  })

  it('defaults to Date.now() when called with no argument', () => {
    const before = Math.floor(Date.now() / RAIL_SEED_BUCKET_MS)
    const bucket = railSeedBucket()
    const after = Math.floor(Date.now() / RAIL_SEED_BUCKET_MS)
    expect(bucket).toBeGreaterThanOrEqual(before)
    expect(bucket).toBeLessThanOrEqual(after)
  })

  it('stays aligned with the edge cache window', () => {
    // The shuffle cadence and the cache window must match, otherwise the rails
    // re-order inside a single cached render's lifetime for no visible benefit.
    const sMaxAge = /s-maxage=(\d+)/.exec(STOREFRONT_EDGE_CACHE_HEADERS['Vercel-CDN-Cache-Control'])?.[1]
    expect(Number(sMaxAge) * 1000).toBe(RAIL_SEED_BUCKET_MS)
  })
})

describe('STOREFRONT_EDGE_CACHE_HEADERS', () => {
  it('sets a 900s s-maxage with a 1h stale-while-revalidate on Cache-Control', () => {
    expect(STOREFRONT_EDGE_CACHE_HEADERS['Cache-Control']).toBe(
      'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
    )
  })

  it('sets a 900s s-maxage with a 1h stale-while-revalidate on Vercel-CDN-Cache-Control', () => {
    expect(STOREFRONT_EDGE_CACHE_HEADERS['Vercel-CDN-Cache-Control']).toBe(
      'public, s-maxage=900, stale-while-revalidate=3600',
    )
  })

  it('keeps the warm cron (every 15 min) inside the freshness window', () => {
    // The whole point of widening: /cron/warm runs every 900s, so the edge
    // entry must still be fresh when the next warm lands. If s-maxage ever
    // drops below the cron cadence the cache goes cold between visits again.
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(STOREFRONT_EDGE_CACHE_HEADERS['Vercel-CDN-Cache-Control'])?.[1])
    expect(sMaxAge).toBeGreaterThanOrEqual(900)
  })
})

/* ── hydrateStorefrontPayloadB ───────────────────────────────────────────── */

function product(handle: string): DiscoveryProduct {
  return { id: `gid://${handle}`, handle, title: handle } as unknown as DiscoveryProduct
}

function rail(category: string, handles: string[]): Rail {
  return {
    category,
    items: handles.map(h => ({ product: product(h), score: 1 })),
  } as unknown as Rail
}

function payload(over: Partial<HomepagePayloadB> = {}): HomepagePayloadB {
  return {
    version: HOMEPAGE_PAYLOAD_B_VERSION,
    variant: 'b',
    rails: [rail('Pleasure', ['a', 'b']), rail('Play', ['c', 'd'])],
    total: 4,
    pinnedProduct: null,
    emmaHero: null,
    emmaPhotoUrl: null,
    emmaPhotoAlt: null,
    notebookPosts: [],
    sensationMap: { types: [], feels: [], defaultState: null, defaultMatch: null },
    builtAt: 0,
    degraded: false,
    ...over,
  }
}

describe('hydrateStorefrontPayloadB', () => {
  it('derives featured from the lead item of each rail', () => {
    const data = hydrateStorefrontPayloadB(payload())
    expect(data.featured).toHaveLength(2)
    // One per populated rail, in rail order.
    expect(data.featured.map(p => p.handle)).toEqual(
      data.rails.map(r => r.items[0]!.product.handle),
    )
  })

  it('keeps featured[0] consistent with rails[0] after the read-time reshuffle', () => {
    // The hero image is derived from featured[0] and the rail beneath it
    // renders rails[0]; if these ever disagree the page shows one product in
    // the hero and a different one leading the rail below it.
    const data = hydrateStorefrontPayloadB(payload())
    expect(data.featured[0]!.handle).toBe(data.rails[0]!.items[0]!.product.handle)
  })

  it('promotes the pinned product to featured[0] without dropping the others', () => {
    const pinned = product('pinned-one')
    const data = hydrateStorefrontPayloadB(payload({ pinnedProduct: pinned }))
    expect(data.featured[0]!.handle).toBe('pinned-one')
    expect(data.featured).toHaveLength(3) // pin + the two rail leads
  })

  it('does not duplicate a pinned product that is already a rail lead', () => {
    const data = hydrateStorefrontPayloadB(payload({ pinnedProduct: product('a') }))
    expect(data.featured[0]!.handle).toBe('a')
    expect(data.featured.filter(p => p.handle === 'a')).toHaveLength(1)
  })

  it('passes rails, total and sensation map through untouched', () => {
    const p = payload({ total: 42 })
    const data = hydrateStorefrontPayloadB(p)
    expect(data.total).toBe(42)
    expect(data.variant).toBe('b')
    expect(data.rails).toHaveLength(2)
    expect(data.sensationMap).toEqual(p.sensationMap)
  })

  it('survives an empty (degraded) payload without throwing', () => {
    const data = hydrateStorefrontPayloadB(payload({ rails: [], total: 0, degraded: true }))
    expect(data.rails).toEqual([])
    expect(data.featured).toEqual([])
  })
})
