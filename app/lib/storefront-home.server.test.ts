// Unit tests for the variant-b storefront payload assembly:
//   - the homepage-performance cache-window widening (60s -> 300s -> 900s edge
//     cache): the pure railSeedBucket helper + STOREFRONT_EDGE_CACHE_HEADERS
//   - the contentBlocks resolution contract (regression cover for the P0 where
//     team-published sections rendered as shell fallbacks in production)
//   - the precomputed payload's read-time hydration
// storefront-home.server.ts pulls in several server modules with real upstreams
// (discovery index, Sanity, sensation map), so those are mocked out.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    // Anchor-collection fetch (ticket #464) hits Shopify, which is not mocked in
    // this suite; stub it to an empty set so the build path falls back to the
    // discovery best-of, exactly like a cold/empty collection would.
    getAnchorCollectionProducts: vi.fn(() => Promise.resolve([])),
    // Default to a blob MISS so assembleStorefrontHome takes the live-build
    // path and the upstream stubs below are the thing under test.
    readHomepagePayloadB: vi.fn(() => Promise.resolve(null)),
    writeHomepagePayloadB: vi.fn(() => Promise.resolve()),
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
  getStorefrontHomeLayout: vi.fn(),
}))

import {
  assembleStorefrontHome,
  railSeedBucket,
  RAIL_SEED_BUCKET_MS,
  STOREFRONT_EDGE_CACHE_HEADERS,
  hydrateStorefrontPayloadB,
} from './storefront-home.server'
import { getDiscoveryRails } from '~/lib/discovery.server'
import {
  buildHomeContentBlocksLean,
  readHomepagePayloadB,
  HOMEPAGE_PAYLOAD_B_VERSION,
  type HomepagePayloadB,
} from '~/lib/homepage-payload.server'
import { getSensationMapData } from '~/lib/sensation-map.server'
import { getEmmaHeroSettings, getBlogPosts, getEditor } from '~/lib/sanity.server'
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

/**
 * Regression cover for the P0 where every team-published homepage section
 * rendered as a hardcoded shell fallback in production. `contentBlocks` used to
 * be handed to the component as an un-awaited promise and streamed in after the
 * shell, which never survived the storefront's edge cache — so published rails,
 * the wayfinder mosaic, the Notebook override and the couples band were
 * invisible to visitors and crawlers alike. It must now be a RESOLVED value on
 * the payload, and it must degrade to the empty payload (== the same shell
 * fallbacks) rather than reject the render.
 */
describe('assembleStorefrontHome — contentBlocks resolution', () => {
  const TEAM_SECTIONS = [
    { _type: 'emmaCuratedRail', _key: 'rail-1', heading: 'Fills you slow.' },
    { _type: 'wayfinderMosaic', _key: 'way-1' },
  ]

  function stubUpstreams() {
    // Blob miss -> live build, so the upstream stubs below are what's exercised.
    vi.mocked(readHomepagePayloadB).mockResolvedValue(null)
    vi.mocked(getDiscoveryRails).mockResolvedValue({
      rails: [], total: 0, available: { moods: [], audiences: [], matters: [] },
    } as unknown as Awaited<ReturnType<typeof getDiscoveryRails>>)
    vi.mocked(getEmmaHeroSettings).mockResolvedValue(null)
    vi.mocked(getBlogPosts).mockResolvedValue({ posts: [], total: 0 })
    vi.mocked(getEditor).mockResolvedValue(null)
    vi.mocked(getSensationMapData).mockResolvedValue({
      types: [], feels: [], defaultState: null, defaultMatch: null,
    } as unknown as Awaited<ReturnType<typeof getSensationMapData>>)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    stubUpstreams()
  })

  it('returns team sections as a resolved value, not a promise', async () => {
    vi.mocked(buildHomeContentBlocksLean).mockResolvedValue({
      sections: TEAM_SECTIONS, carouselProductMap: { 'rail-1': [] },
    } as unknown as Awaited<ReturnType<typeof buildHomeContentBlocksLean>>)

    const payload = await assembleStorefrontHome()

    // The load-bearing assertion: a promise here is the original defect.
    expect(payload.contentBlocks).not.toBeInstanceOf(Promise)
    expect(payload.contentBlocks.sections).toHaveLength(2)
    expect(payload.contentBlocks.sections.map(s => s._type)).toEqual([
      'emmaCuratedRail', 'wayfinderMosaic',
    ])
    expect(payload.contentBlocks.carouselProductMap).toHaveProperty('rail-1')
  })

  it('asks the Notebook for 6 posts, not 3', async () => {
    vi.mocked(buildHomeContentBlocksLean).mockResolvedValue({
      sections: [], carouselProductMap: {},
    } as unknown as Awaited<ReturnType<typeof buildHomeContentBlocksLean>>)

    await assembleStorefrontHome()

    // The homepage Notebook shelf is the only path from ~21% of sessions into
    // the rest of the archive, so it shows six posts plus a see-all link.
    expect(getBlogPosts).toHaveBeenCalledWith({ perPage: 6 })
  })

  it('degrades to the empty payload when the team-content upstream rejects', async () => {
    vi.mocked(buildHomeContentBlocksLean).mockRejectedValue(new Error('sanity down'))

    // Must not reject: a failed merchandising leg falls back to shell content,
    // it never takes the homepage down.
    const payload = await assembleStorefrontHome()

    expect(payload.contentBlocks).toEqual({ sections: [], carouselProductMap: {} })
    expect(payload.variant).toBe('b')
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
    anchorProducts: [],
    total: 4,
    pinnedProduct: null,
    emmaHero: null,
    emmaPhotoUrl: null,
    emmaPhotoAlt: null,
    contentBlocks: { sections: [], carouselProductMap: {} },
    notebookPosts: [],
    sensationMap: { types: [], feels: [], defaultState: null, defaultMatch: null },
    layout: null,
    panelDeck: null,
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

  it('passes the anchor collection products through verbatim (ticket #464)', () => {
    // Curated collection order is merchandising, not a rotation set, so it must
    // reach the component unchanged (never reshuffled like `rails`).
    const anchor = [
      { id: 'gid://shopify/Product/anchor-1', handle: 'anchor-1', title: 'Anchor One', price: 12, images: [] },
      { id: 'gid://shopify/Product/anchor-2', handle: 'anchor-2', title: 'Anchor Two', price: 34, images: [] },
    ]
    const data = hydrateStorefrontPayloadB(payload({ anchorProducts: anchor }))
    expect(data.anchorProducts).toEqual(anchor)
  })

  it('defaults anchorProducts to [] when the blob predates the field', () => {
    // Defensive: a malformed/older blob without the field must not crash the
    // pure hydrate; the component then falls back to the discovery best-of.
    const legacy = payload()
    delete (legacy as { anchorProducts?: unknown }).anchorProducts
    expect(hydrateStorefrontPayloadB(legacy).anchorProducts).toEqual([])
  })

  it('survives an empty (degraded) payload without throwing', () => {
    const data = hydrateStorefrontPayloadB(payload({ rails: [], total: 0, degraded: true }))
    expect(data.rails).toEqual([])
    expect(data.featured).toEqual([])
  })

  it('serves contentBlocks off the blob as a resolved value, never a promise', () => {
    // The blob-read path has to honour the same invariant PR #322 established
    // for the live path: an un-awaited promise here never survives the edge
    // cache, which is how team-published merchandising went invisible.
    const contentBlocks = {
      sections: [{ _type: 'emmaCuratedRail', _key: 'rail-1' }],
      carouselProductMap: { 'rail-1': [] },
    } as unknown as HomepagePayloadB['contentBlocks']
    const data = hydrateStorefrontPayloadB(payload({ contentBlocks }))

    expect(data.contentBlocks).not.toBeInstanceOf(Promise)
    expect(data.contentBlocks.sections).toHaveLength(1)
    expect(data.contentBlocks.sections[0]!._type).toBe('emmaCuratedRail')
  })
})
