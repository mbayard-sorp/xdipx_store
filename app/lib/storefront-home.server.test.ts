// Unit tests for the variant-b storefront payload assembly:
//   - the PR-4 homepage-performance cache-window widening (60s -> 300s edge
//     cache): the pure railSeedBucket helper + STOREFRONT_EDGE_CACHE_HEADERS
//   - the contentBlocks resolution contract (regression cover for the P0 where
//     team-published sections rendered as shell fallbacks in production)
// storefront-home.server.ts pulls in several server modules with real upstreams
// (discovery index, Sanity, sensation map), so those are mocked out.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { assembleStorefrontHome, railSeedBucket, STOREFRONT_EDGE_CACHE_HEADERS } from './storefront-home.server'
import { getDiscoveryRails } from '~/lib/discovery.server'
import { buildHomeContentBlocksLean } from '~/lib/homepage-payload.server'
import { getSensationMapData } from '~/lib/sensation-map.server'
import { getEmmaHeroSettings, getBlogPosts, getEditor } from '~/lib/sanity.server'

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
