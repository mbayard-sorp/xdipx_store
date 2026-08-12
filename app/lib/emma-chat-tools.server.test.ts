import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchDiagnostics, IvrSearchOpts } from '~/lib/ivr-search.server'
import type { EmmaProductCard } from '~/lib/shopify.server'

// ticket #619: web chat catalog search must run the same core as voice/SMS
// (searchForIvrWithDiagnostics), gain productTypeDial/mattersTags filtering, and
// hydrate the ranked handles into display-correct EmmaProductCards — not the
// voice card's TTS-normalized shape.

const searchForIvrWithDiagnostics =
  vi.fn<(opts: IvrSearchOpts) => Promise<SearchDiagnostics>>()
const getEmmaCardsByHandles =
  vi.fn<(handles: string[]) => Promise<EmmaProductCard[]>>()

vi.mock('~/lib/ivr-search.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/ivr-search.server')>()
  return { ...actual, searchForIvrWithDiagnostics }
})

vi.mock('~/lib/shopify.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/shopify.server')>()
  return { ...actual, getEmmaCardsByHandles }
})

afterEach(() => {
  searchForIvrWithDiagnostics.mockReset()
  getEmmaCardsByHandles.mockReset()
})

function card(handle: string, priceUsd: number): EmmaProductCard {
  return {
    handle,
    url: `https://xdipx.com/products/${handle}`,
    title: handle,
    productType: null,
    priceUsd,
    compareAtUsd: null,
    available: true,
    mapRestricted: false,
    tagline: null,
    productTypeDial: null,
    audienceTags: [],
    moodTags: [],
    mattersTags: [],
  }
}

async function load() {
  return import('~/lib/emma-chat-tools.server')
}

describe('executeEmmaChatTool search_products (ticket #619)', () => {
  it('routes through the shared core and maps category/audience/matters/priceMax', async () => {
    const { executeEmmaChatTool } = await load()
    searchForIvrWithDiagnostics.mockResolvedValue({
      reason: 'matched',
      cards: [{ handle: 'a' } as never, { handle: 'b' } as never],
    })
    getEmmaCardsByHandles.mockResolvedValue([card('a', 40), card('b', 55)])

    const res = await executeEmmaChatTool('search_products', {
      keyword: 'wand',
      category: 'wand',
      audience: 'for-her',
      matters: ['quiet', 'waterproof'],
      price_max: 80,
    })

    expect(searchForIvrWithDiagnostics).toHaveBeenCalledTimes(1)
    const opts = searchForIvrWithDiagnostics.mock.calls[0]![0]
    expect(opts.query).toBe('wand')
    // 'wand' is a vibrator subtype, not a dial value of its own.
    expect(opts.productTypeDial).toBe('vibrator')
    expect(opts.productSubtypeDial).toBe('wand')
    expect(opts.category).toBe('for-her') // audience -> category axis
    expect(opts.mattersTags).toEqual(['quiet', 'waterproof'])
    expect(opts.priceMax).toBe(80)

    // Hydrated in ranked order, EmmaProductCard shape preserved.
    expect(getEmmaCardsByHandles).toHaveBeenCalledWith(['a', 'b'])
    const parsed = JSON.parse(res.content) as { count: number; results: EmmaProductCard[] }
    expect(parsed.count).toBe(2)
    expect(parsed.results.map((c) => c.handle)).toEqual(['a', 'b'])
    expect(parsed.results[0]).toMatchObject({ handle: 'a', priceUsd: 40, mapRestricted: false })
  })

  it('applies price_min as a post-hydration floor (the core has no minimum)', async () => {
    const { executeEmmaChatTool } = await load()
    searchForIvrWithDiagnostics.mockResolvedValue({
      reason: 'matched',
      cards: [
        { handle: 'cheap' } as never,
        { handle: 'mid' } as never,
        { handle: 'pricey' } as never,
      ],
    })
    getEmmaCardsByHandles.mockResolvedValue([
      card('cheap', 20),
      card('mid', 45),
      card('pricey', 90),
    ])

    const res = await executeEmmaChatTool('search_products', { keyword: 'lube', price_min: 40 })

    const parsed = JSON.parse(res.content) as { count: number; results: EmmaProductCard[] }
    expect(parsed.results.map((c) => c.handle)).toEqual(['mid', 'pricey'])
    expect(parsed.count).toBe(2)
  })

  it('defaults an empty keyword to a browse query so an argument-less search still returns', async () => {
    const { executeEmmaChatTool } = await load()
    searchForIvrWithDiagnostics.mockResolvedValue({ reason: 'matched', cards: [] })
    getEmmaCardsByHandles.mockResolvedValue([])

    await executeEmmaChatTool('search_products', {})
    expect(searchForIvrWithDiagnostics.mock.calls[0]![0].query).toBe('wellness')
  })
})
