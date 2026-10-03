// Ticket #13144 (owner all-hands 2026-10-02): an admin session always paid the
// full live variant-A assembly (getDiscoveryRails + getDiscoveryVocab, the
// request-time fan-out) on every homepage load, because loadVariantAData
// special-cased `isAdmin` to skip the precompute-blob path entirely. Measured
// against prod: the live build cost seconds versus ~170ms for the blob path,
// and the __xdipx_admin cookie is path '/' with a 7-day maxAge, so anyone who
// had used /admin that week paid this on every single request.
//
// Admin now reads the same precompute-blob / cold-miss path as everyone else
// by default; only an explicit `fresh: true` (the route's `?fresh=1`) still
// forces the live build, for previewing an unsaved Sanity edit.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/discovery.server', () => ({
  getDiscoveryRails: vi.fn(() => Promise.resolve({ rails: [{ id: 'live-rail' }], total: 1, available: {} })),
  getDiscoveryVocab: vi.fn(() => Promise.resolve({ moods: ['live-mood'], audiences: [], matters: [] })),
}))

vi.mock('~/lib/homepage-payload.server', () => ({
  readHomepagePayloadA: vi.fn(),
  triggerHomepageWarm: vi.fn(),
  reshuffleRailsWithSeed: vi.fn((rails: unknown[]) => rails),
  buildHomeContentBlocks: vi.fn(() => Promise.resolve({ sections: [], carouselProductMap: {} })),
}))

vi.mock('~/lib/is-bot.server', () => ({
  isLikelyBot: vi.fn(() => false),
}))

import { loadVariantAData } from './home-discover.server'
import { getDiscoveryRails, getDiscoveryVocab } from '~/lib/discovery.server'
import { readHomepagePayloadA, triggerHomepageWarm } from '~/lib/homepage-payload.server'
import { isLikelyBot } from '~/lib/is-bot.server'

const BLOB: Awaited<ReturnType<typeof readHomepagePayloadA>> = {
  version: 1 as never,
  variant: 'a',
  rails: [{ id: 'blob-rail' } as never],
  total: 1,
  welcomeBackEnabled: true,
  moods: ['blob-mood'],
  audiences: [],
  matters: [],
  available: {} as never,
  sections: [],
  carouselProductMap: {},
  builtAt: Date.now(),
  degraded: false,
}

const FAKE_REQUEST = new Request('https://xdipx.com/')

describe('loadVariantAData (ticket #13144)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('admin reads the warm blob by default, never calling the live fan-out', async () => {
    vi.stubEnv('HOMEPAGE_PRECOMPUTE_ENABLED', 'true')
    vi.mocked(readHomepagePayloadA).mockResolvedValue(BLOB)

    const result = await loadVariantAData(FAKE_REQUEST, { welcomeBackEnabled: true, isAdmin: true })

    expect(result.moods).toEqual(['blob-mood'])
    expect(getDiscoveryRails).not.toHaveBeenCalled()
    expect(getDiscoveryVocab).not.toHaveBeenCalled()
  })

  it('an explicit fresh:true still forces the live build for an admin', async () => {
    vi.stubEnv('HOMEPAGE_PRECOMPUTE_ENABLED', 'true')
    vi.mocked(readHomepagePayloadA).mockResolvedValue(BLOB)

    const result = await loadVariantAData(FAKE_REQUEST, { welcomeBackEnabled: true, isAdmin: true, fresh: true })

    expect(result.moods).toEqual(['live-mood'])
    expect(getDiscoveryRails).toHaveBeenCalledTimes(1)
    expect(getDiscoveryVocab).toHaveBeenCalledTimes(1)
    // The live path never reads the blob at all — fresh means skip it outright.
    expect(readHomepagePayloadA).not.toHaveBeenCalled()
  })

  it('anonymous behavior is unchanged: reads the blob when present', async () => {
    vi.stubEnv('HOMEPAGE_PRECOMPUTE_ENABLED', 'true')
    vi.mocked(readHomepagePayloadA).mockResolvedValue(BLOB)

    const result = await loadVariantAData(FAKE_REQUEST, { welcomeBackEnabled: true, isAdmin: false })

    expect(result.moods).toEqual(['blob-mood'])
    expect(getDiscoveryRails).not.toHaveBeenCalled()
  })

  it('admin without fresh falls back to live when the precompute flag is off, same as anonymous', async () => {
    vi.stubEnv('HOMEPAGE_PRECOMPUTE_ENABLED', 'false')

    const result = await loadVariantAData(FAKE_REQUEST, { welcomeBackEnabled: true, isAdmin: true })

    expect(result.moods).toEqual(['live-mood'])
    expect(readHomepagePayloadA).not.toHaveBeenCalled()
  })

  it('admin without fresh on a cold blob miss still gets a live build (never a blank admin view)', async () => {
    vi.stubEnv('HOMEPAGE_PRECOMPUTE_ENABLED', 'true')
    vi.mocked(readHomepagePayloadA).mockResolvedValue(null)
    vi.mocked(isLikelyBot).mockReturnValue(false)

    const result = await loadVariantAData(FAKE_REQUEST, { welcomeBackEnabled: true, isAdmin: true })

    expect(result.moods).toEqual(['live-mood'])
    expect(triggerHomepageWarm).toHaveBeenCalledTimes(1)
  })
})
