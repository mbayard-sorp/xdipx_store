/**
 * ivr-search-contract.test.ts
 *
 * Data-contract regression suite for the conversation search path
 * (ticket #1276, conv-audit D1), plus the fixes it covers directly:
 * Shopify fallback resilience for discoverForIvr / strict-category zero
 * results (ticket #1269, conv-audit C2) and stock honesty (ticket #1270,
 * conv-audit C3).
 *
 * This is NOT a smoke suite. Every test asserts on the actual returned
 * cards/reason contract, or on the GROQ query shape actually sent to
 * Sanity, against fixture data standing in for Sanity + Shopify. There is
 * no groq-js in this repo (package.json is a protected path a ticket may
 * not touch), so the "~20 real query shapes" run through the real exported
 * functions with a mocked Sanity client and mocked Shopify hydration:
 * behavior tests assert on what the function returns for a given fixture
 * pool, and the "query contract" tests below capture the built GROQ
 * string/params and assert the P0 fixes (no priceMax in GROQ, matters tags
 * queried through the normalized field, enrichment filters carry the
 * count(coalesce(...))==0 escape) are actually present in the query the
 * code builds today. Revert any of them locally and the matching test in
 * this file goes red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '~/types'

// ─── Mocks (hoisted by vitest above the imports below) ───────────────────────
// vi.mock factories are hoisted to the top of the module, above ordinary const
// declarations, so the mock fns they close over must be created via
// vi.hoisted() rather than a plain `const` or the factory sees them
// uninitialized.

const { sanityFetchMock, getProductsByHandlesMock, searchProductsMock, sentryCaptureMock } = vi.hoisted(() => ({
  sanityFetchMock: vi.fn(),
  getProductsByHandlesMock: vi.fn(),
  searchProductsMock: vi.fn(),
  sentryCaptureMock: vi.fn(),
}))

// ivr-search.server reads SANITY_PROJECT_ID into a module-level const at
// import time (see loadWithNoSanityClient below), so it has to be truthy
// BEFORE the static `import ... from '~/lib/ivr-search.server'` a few lines
// down evaluates, or getSanityClient() returns null for every test in this
// file, not just the ones that opt into that via loadWithNoSanityClient().
// vi.hoisted runs before all imports, which is what makes this reliable.
// Locally this was masked: .env sets a real SANITY_PROJECT_ID that vitest
// auto-loads into process.env. CI's `check` job sets only DATABASE_URL (see
// .github/workflows/ci.yml), so without this every "normal path" test here
// silently took the sanity-unavailable fallback branch instead of exercising
// the GROQ query building this file exists to pin. `??=` leaves a real value
// (local dev, or a future CI secret) untouched.
vi.hoisted(() => {
  process.env['SANITY_PROJECT_ID'] ??= 'test-sanity-project'
})

vi.mock('@sanity/client', () => ({
  createClient: vi.fn(() => ({ fetch: sanityFetchMock })),
}))

vi.mock('~/lib/shopify.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/shopify.server')>()
  return {
    ...actual,
    getProductsByHandles: getProductsByHandlesMock,
    searchProducts: searchProductsMock,
  }
})

// Bypass the KV cache entirely so every test call reaches the mocked Sanity
// fetch deterministically instead of returning a memoized value from an
// earlier test (cache keys are derived from the GROQ string + params, so
// identical-shaped queries across tests would otherwise collide).
vi.mock('~/lib/kv.server', () => ({
  cached: (_key: string, _ttl: number, fn: () => unknown) => fn(),
}))

vi.mock('~/lib/sentry.server', () => ({
  Sentry: { captureException: sentryCaptureMock },
}))

import {
  searchForIvrWithDiagnostics,
  discoverForIvrWithDiagnostics,
} from '~/lib/ivr-search.server'

// ─── "Sanity client unavailable" helper ──────────────────────────────────────
// ivr-search.server reads SANITY_PROJECT_ID into a module-level const at
// import time (`const projectId = process.env['SANITY_PROJECT_ID']`), not
// fresh on every getSanityClient() call, so stubbing the env var after this
// test file's top-level import already ran has no effect on the statically
// imported functions above. To exercise the "client unavailable" branch, force
// a fresh module instantiation (vi.resetModules) with the env stubbed to
// empty BEFORE the dynamic import captures it. The mocks registered above
// (vi.hoisted mock fns) stay in effect across the fresh instantiation.
async function loadWithNoSanityClient() {
  vi.resetModules()
  vi.stubEnv('SANITY_PROJECT_ID', '')
  return import('~/lib/ivr-search.server')
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

type SanityCandidate = { handle: string; title: string; category: string | null; tagline: string | null }

function candidate(handle: string, overrides: Partial<SanityCandidate> = {}): SanityCandidate {
  return { handle, title: handle, category: 'for-her', tagline: `${handle} tagline`, ...overrides }
}

function makeProduct(opts: {
  handle: string
  price?: number
  compareAtPrice?: number
  mapPrice?: number
  wholesaleCost?: number
  availableForSale?: boolean
}): Product & { mapPrice?: number; wholesaleCost?: number } {
  const price = opts.price ?? 30
  const available = opts.availableForSale ?? true
  return {
    id: `gid://shopify/Product/${opts.handle}`,
    handle: opts.handle,
    title: opts.handle,
    images: [],
    videos: [],
    variants: [
      {
        id: `gid://shopify/ProductVariant/${opts.handle}-1`,
        title: 'Default',
        selectedOptions: [],
        price: String(price),
        compareAtPrice: opts.compareAtPrice != null ? String(opts.compareAtPrice) : null,
        availableForSale: available,
        quantityAvailable: available ? 10 : 0,
      },
    ],
    price,
    ...(opts.compareAtPrice != null ? { compareAtPrice: opts.compareAtPrice } : {}),
    tags: [],
    mapPrice: opts.mapPrice ?? 0,
    wholesaleCost: opts.wholesaleCost ?? 0,
  }
}

/** Wires getProductsByHandlesMock to resolve from a fixed handle->product map. */
function wireProducts(products: (Product & { mapPrice?: number; wholesaleCost?: number })[]): void {
  const map = new Map(products.map((p) => [p.handle, p]))
  getProductsByHandlesMock.mockImplementation(async (handles: string[]) =>
    handles.map((h) => map.get(h)).filter((p): p is Product => Boolean(p)),
  )
}

/** Wires the Shopify search fallback (searchProducts) to return the given handles. */
function wireShopifySearch(handles: string[]): void {
  searchProductsMock.mockResolvedValue({
    products: handles.map((h) => ({ handle: h })),
    totalCount: handles.length,
    filters: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  sanityFetchMock.mockReset()
  getProductsByHandlesMock.mockReset()
  searchProductsMock.mockReset()
  sentryCaptureMock.mockReset()
  vi.restoreAllMocks()
})

// ─── searchForIvrWithDiagnostics: query shapes ───────────────────────────────

describe('searchForIvrWithDiagnostics query shapes', () => {
  it('category search returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('wand-1'), candidate('wand-2')])
    wireProducts([makeProduct({ handle: 'wand-1' }), makeProduct({ handle: 'wand-2' })])

    const result = await searchForIvrWithDiagnostics({ query: 'wand', category: 'for-her', limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.cards.every((c) => c.handle)).toBe(true)
  })

  it('brand+model (vendor/title text) search returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('dame-fin')])
    wireProducts([makeProduct({ handle: 'dame-fin' })])

    const result = await searchForIvrWithDiagnostics({ query: 'dame fin', limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toContain('dame-fin')
  })

  it('budget/priceMax filters post-hydration by live Shopify price', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('cheap'), candidate('pricey')])
    wireProducts([
      makeProduct({ handle: 'cheap', price: 20 }),
      makeProduct({ handle: 'pricey', price: 200 }),
    ])

    const result = await searchForIvrWithDiagnostics({ query: 'toy', priceMax: 50, limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['cheap'])
  })

  it('matters preference (soft OR) returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('plus-size-friendly-1')])
    wireProducts([makeProduct({ handle: 'plus-size-friendly-1' })])

    const result = await searchForIvrWithDiagnostics({
      query: 'toy',
      mattersTags: ['Plus-size friendly'],
      limit: 3,
    })

    expect(result.reason).toBe('matched')
    expect(result.cards.length).toBe(1)
  })

  it('productTypeDial + productSubtypeDial narrows and still matches', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('wand-classic')])
    wireProducts([makeProduct({ handle: 'wand-classic' })])

    const result = await searchForIvrWithDiagnostics({
      query: 'wand',
      productTypeDial: 'wand',
      productSubtypeDial: 'classic',
      limit: 3,
    })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['wand-classic'])
  })

  it('order-status style query with nothing in the catalog returns no-base-results, not fabricated products', async () => {
    sanityFetchMock.mockResolvedValueOnce([])
    searchProductsMock.mockResolvedValue({
      products: [],
      totalCount: 0,
      filters: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    })

    const result = await searchForIvrWithDiagnostics({ query: 'where is my order', limit: 3 })

    expect(result.reason).toBe('no-base-results')
    expect(result.cards).toEqual([])
  })
})

// ─── discoverForIvrWithDiagnostics: query shapes ─────────────────────────────

describe('discoverForIvrWithDiagnostics query shapes', () => {
  it('mood filter returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('romantic-set')])
    wireProducts([makeProduct({ handle: 'romantic-set' })])

    const result = await discoverForIvrWithDiagnostics({ mood: ['romantic'], limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['romantic-set'])
  })

  it('experience filter returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('first-timer')])
    wireProducts([makeProduct({ handle: 'first-timer' })])

    const result = await discoverForIvrWithDiagnostics({ experience: 'first-time', limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['first-timer'])
  })

  it('useCase filter returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('date-night-kit')])
    wireProducts([makeProduct({ handle: 'date-night-kit' })])

    const result = await discoverForIvrWithDiagnostics({ useCase: ['date-night'], limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['date-night-kit'])
  })

  it('features filter returns matched products', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('quiet-vibe')])
    wireProducts([makeProduct({ handle: 'quiet-vibe' })])

    const result = await discoverForIvrWithDiagnostics({ features: ['quiet'], limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['quiet-vibe'])
  })

  it('combined mood + experience + useCase + features + category still matches', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('combo-product')])
    wireProducts([makeProduct({ handle: 'combo-product' })])

    const result = await discoverForIvrWithDiagnostics({
      mood: ['playful'],
      experience: 'curious',
      useCase: ['gift'],
      features: ['waterproof'],
      category: 'for-her',
      limit: 3,
    })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['combo-product'])
  })

  it('priceMax filters discover results post-hydration too', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('cheap-mood'), candidate('pricey-mood')])
    wireProducts([
      makeProduct({ handle: 'cheap-mood', price: 15 }),
      makeProduct({ handle: 'pricey-mood', price: 150 }),
    ])

    const result = await discoverForIvrWithDiagnostics({ mood: ['playful'], priceMax: 40, limit: 3 })

    expect(result.reason).toBe('matched')
    expect(result.cards.map((c) => c.handle)).toEqual(['cheap-mood'])
  })
})

// ─── Ticket #1269 (conv-audit C2): Shopify fallback resilience ───────────────

describe('ticket #1269: Shopify fallback for discoverForIvr / strict-category zero results', () => {
  it('discoverForIvrWithDiagnostics falls back to Shopify when the Sanity client is unavailable', async () => {
    wireShopifySearch(['fallback-mood-product'])
    wireProducts([makeProduct({ handle: 'fallback-mood-product' })])
    const { discoverForIvrWithDiagnostics: discover } = await loadWithNoSanityClient()

    const result = await discover({ mood: ['romantic'], category: 'for-her', limit: 3 })

    // Before the fix this returned { cards: [], reason: 'sanity-unavailable' }
    // unconditionally: Sanity being down meant total silence even though
    // Shopify (source of truth for product data) was reachable.
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.cards.map((c) => c.handle)).toContain('fallback-mood-product')
    // Real products from a degraded path must not be tagged with the reason
    // that tells the model to apologize for an outage (ai-agent/tools.server
    // searchReasonGuidance treats sanity-unavailable as "be honest, do not
    // invent products, apologize"), a semantic collision the fix avoids.
    expect(result.reason).toBe('sanity-degraded')
    expect(sanityFetchMock).not.toHaveBeenCalled()
  })

  it('discoverForIvrWithDiagnostics stays silent (not empty-string search) when there is nothing to fall back on', async () => {
    const { discoverForIvrWithDiagnostics: discover } = await loadWithNoSanityClient()

    const result = await discover({ limit: 3 })

    expect(result).toEqual({ cards: [], reason: 'sanity-unavailable' })
    expect(searchProductsMock).not.toHaveBeenCalled()
  })

  it('discoverForIvrWithDiagnostics falls back to Shopify when the Sanity GROQ fetch throws', async () => {
    sanityFetchMock.mockRejectedValueOnce(new Error('sanity down'))
    wireShopifySearch(['thrown-fallback'])
    wireProducts([makeProduct({ handle: 'thrown-fallback' })])

    const result = await discoverForIvrWithDiagnostics({ productTypeDial: 'wand', limit: 3 })

    expect(result.reason).toBe('sanity-degraded')
    expect(result.cards.map((c) => c.handle)).toContain('thrown-fallback')
  })

  it('searchForIvrWithDiagnostics falls back to Shopify for a strict-category term with zero Sanity results and no extra filters', async () => {
    sanityFetchMock.mockResolvedValueOnce([]) // main strict-category query: nothing
    wireShopifySearch(['fallback-lube'])
    wireProducts([makeProduct({ handle: 'fallback-lube' })])

    const result = await searchForIvrWithDiagnostics({ query: 'lube', limit: 3 })

    // Before the fix, a strict-category zero result returned straight to the
    // caller with reason 'no-base-results' and zero resilience, even though
    // this is exactly the highest-intent kind of query ("lube", "vibrator").
    expect(result.reason).toBe('sanity-degraded')
    expect(result.cards.map((c) => c.handle)).toContain('fallback-lube')
  })

  it('searchForIvrWithDiagnostics falls back to Shopify for a strict-category term filtered to zero by extra filters', async () => {
    sanityFetchMock
      .mockResolvedValueOnce([]) // main query with filters: nothing
      .mockResolvedValueOnce([{ handle: 'exists' }]) // base-check (no filters): catalog has vibrators
    wireShopifySearch(['fallback-vibrator'])
    wireProducts([makeProduct({ handle: 'fallback-vibrator', price: 20 })]) // under the $25 priceMax

    const result = await searchForIvrWithDiagnostics({ query: 'vibrator', priceMax: 25, limit: 3 })

    expect(result.reason).toBe('sanity-degraded')
    expect(result.cards.map((c) => c.handle)).toContain('fallback-vibrator')
  })

  it('stays honestly empty when Sanity is unavailable AND the Shopify fallback also finds nothing', async () => {
    wireShopifySearch([])
    wireProducts([])
    const { searchForIvrWithDiagnostics: search } = await loadWithNoSanityClient()

    const result = await search({ query: 'lube', limit: 3 })

    expect(result).toEqual({ cards: [], reason: 'sanity-unavailable' })
  })
})

// ─── Ticket #1270 (conv-audit C3): stock honesty ─────────────────────────────

describe('ticket #1270: stock honesty', () => {
  it('searchForIvrWithDiagnostics never recommends an out-of-stock product when enough in-stock alternatives exist', async () => {
    sanityFetchMock.mockResolvedValueOnce([
      candidate('oos-1'), candidate('in-1'), candidate('in-2'), candidate('in-3'), candidate('oos-2'),
    ])
    wireProducts([
      makeProduct({ handle: 'oos-1', availableForSale: false }),
      makeProduct({ handle: 'in-1', availableForSale: true }),
      makeProduct({ handle: 'in-2', availableForSale: true }),
      makeProduct({ handle: 'in-3', availableForSale: true }),
      makeProduct({ handle: 'oos-2', availableForSale: false }),
    ])

    const result = await searchForIvrWithDiagnostics({ query: 'toy', limit: 2 })

    expect(result.cards).toHaveLength(2)
    expect(result.cards.every((c) => c.inStock)).toBe(true)
  })

  it('searchForIvrWithDiagnostics leads with in-stock even when the pool is smaller than the limit (regression: previously shuffled together)', async () => {
    sanityFetchMock.mockResolvedValueOnce([candidate('only-in-stock'), candidate('only-oos')])
    wireProducts([
      makeProduct({ handle: 'only-in-stock', availableForSale: true }),
      makeProduct({ handle: 'only-oos', availableForSale: false }),
    ])

    const result = await searchForIvrWithDiagnostics({ query: 'toy', limit: 5 })

    expect(result.cards).toHaveLength(2)
    // Never invent products: the OOS card still appears (only 2 candidates for
    // a limit of 5), but must trail the in-stock one instead of being able to
    // land first, since a single-item group cannot be reordered by shuffle.
    expect(result.cards[0]!.inStock).toBe(true)
    expect(result.cards[1]!.inStock).toBe(false)
  })

  it('discoverForIvrWithDiagnostics never recommends an out-of-stock product when enough in-stock alternatives exist', async () => {
    sanityFetchMock.mockResolvedValueOnce([
      candidate('d-oos-1'), candidate('d-in-1'), candidate('d-in-2'), candidate('d-in-3'),
    ])
    wireProducts([
      makeProduct({ handle: 'd-oos-1', availableForSale: false }),
      makeProduct({ handle: 'd-in-1', availableForSale: true }),
      makeProduct({ handle: 'd-in-2', availableForSale: true }),
      makeProduct({ handle: 'd-in-3', availableForSale: true }),
    ])

    const result = await discoverForIvrWithDiagnostics({ mood: ['playful'], limit: 2 })

    expect(result.cards).toHaveLength(2)
    expect(result.cards.every((c) => c.inStock)).toBe(true)
  })

  it('discoverForIvrWithDiagnostics leads with in-stock when the pool is smaller than the limit (regression: previously a raw score-order slice)', async () => {
    // Sanity relevance order deliberately puts the OOS product first, mimicking
    // the real bug: Sanity has no stock data, so its score ordering can rank an
    // out-of-stock product ahead of an in-stock one.
    sanityFetchMock.mockResolvedValueOnce([candidate('d-only-oos'), candidate('d-only-in-stock')])
    wireProducts([
      makeProduct({ handle: 'd-only-oos', availableForSale: false }),
      makeProduct({ handle: 'd-only-in-stock', availableForSale: true }),
    ])

    const result = await discoverForIvrWithDiagnostics({ mood: ['playful'], limit: 5 })

    expect(result.cards).toHaveLength(2)
    expect(result.cards[0]!.inStock).toBe(true)
    expect(result.cards[1]!.inStock).toBe(false)
  })
})

// ─── Hydration-miss logging (ticket #1270) ───────────────────────────────────

describe('hydration-miss logging', () => {
  it('logs a Sanity candidate that misses Shopify hydration in searchForIvrWithDiagnostics instead of dropping it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sanityFetchMock.mockResolvedValueOnce([candidate('present'), candidate('ghost-handle')])
    wireProducts([makeProduct({ handle: 'present' })]) // 'ghost-handle' never resolves

    const result = await searchForIvrWithDiagnostics({ query: 'toy', limit: 3 })

    expect(result.cards.map((c) => c.handle)).toEqual(['present'])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 Sanity candidate(s) missed Shopify hydration'),
      expect.arrayContaining(['ghost-handle']),
    )
  })

  it('logs a Sanity candidate that misses Shopify hydration in discoverForIvrWithDiagnostics instead of dropping it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sanityFetchMock.mockResolvedValueOnce([candidate('d-present'), candidate('d-ghost-handle')])
    wireProducts([makeProduct({ handle: 'd-present' })])

    const result = await discoverForIvrWithDiagnostics({ mood: ['playful'], limit: 3 })

    expect(result.cards.map((c) => c.handle)).toEqual(['d-present'])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 Sanity candidate(s) missed Shopify hydration'),
      expect.arrayContaining(['d-ghost-handle']),
    )
  })
})

// ─── Query contract: the P0 fixes stay in the GROQ the code builds ──────────

describe('query contract regressions (conv-audit P0 1/2/4)', () => {
  it('never puts priceMax into the GROQ filter or params (P0-1: price lives only in Shopify, not Sanity)', async () => {
    sanityFetchMock.mockResolvedValueOnce([])
    searchProductsMock.mockResolvedValue({ products: [], totalCount: 0, filters: [], pageInfo: { hasNextPage: false, endCursor: null } })

    await searchForIvrWithDiagnostics({ query: 'toy', priceMax: 40, limit: 3 })

    const [groq, params] = sanityFetchMock.mock.calls[0]!
    expect(groq).not.toContain('price <=')
    expect(groq).not.toMatch(/\bprice\b/)
    expect(params).not.toHaveProperty('priceMax')
  })

  it('discoverForIvrWithDiagnostics also keeps priceMax out of GROQ', async () => {
    sanityFetchMock.mockResolvedValueOnce([])

    await discoverForIvrWithDiagnostics({ mood: ['playful'], priceMax: 40, limit: 3 })

    const [groq, params] = sanityFetchMock.mock.calls[0]!
    expect(groq).not.toContain('price <=')
    expect(params).not.toHaveProperty('priceMax')
  })

  it('queries mattersTags through the normalized field with a slugified param (P0-2: casing mismatch)', async () => {
    sanityFetchMock.mockResolvedValueOnce([])
    searchProductsMock.mockResolvedValue({ products: [], totalCount: 0, filters: [], pageInfo: { hasNextPage: false, endCursor: null } })

    await searchForIvrWithDiagnostics({ query: 'toy', mattersTags: ['Plus-size Friendly'], limit: 3 })

    const [groq, params] = sanityFetchMock.mock.calls[0]!
    expect(groq).toContain('mattersTagsNormalized')
    expect(groq).not.toContain('$mt0 in mattersTags)')
    const values = Object.values(params as Record<string, unknown>)
    expect(values).toContain('plus-size-friendly')
    expect(values).not.toContain('Plus-size Friendly')
  })

  it('mood/experience/useCase/features filters carry the empty-array escape (P0-4: no hard AND on enrichment fields)', async () => {
    sanityFetchMock.mockResolvedValueOnce([])

    await discoverForIvrWithDiagnostics({
      mood: ['playful'],
      experience: 'curious',
      useCase: ['gift'],
      features: ['quiet'],
      limit: 3,
    })

    const [groq] = sanityFetchMock.mock.calls[0]!
    expect(groq).toContain('count(coalesce(moodTags, [])) == 0 ||')
    expect(groq).toContain('count(coalesce(ivrExperience, [])) == 0 ||')
    expect(groq).toContain('count(coalesce(ivrUseCase, [])) == 0 ||')
    expect(groq).toContain('count(coalesce(ivrFeatures, [])) == 0 ||')
  })

  it('always excludes archived and hiddenUntilLive products at the Sanity layer', async () => {
    sanityFetchMock.mockResolvedValueOnce([])
    searchProductsMock.mockResolvedValue({ products: [], totalCount: 0, filters: [], pageInfo: { hasNextPage: false, endCursor: null } })

    await searchForIvrWithDiagnostics({ query: 'toy', limit: 3 })

    const [groq] = sanityFetchMock.mock.calls[0]!
    expect(groq).toContain('archived != true')
    expect(groq).toContain('hiddenUntilLive != true')
  })
})
