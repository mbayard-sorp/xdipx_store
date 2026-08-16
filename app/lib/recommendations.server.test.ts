// Regression guard for ticket #3447: the PDP "Complete the set" rail used to
// source SUBSTITUTES (via a same-tag/same-vendor cold-start fallback keyed on
// tags[0], which is almost always the brand: tag) for the product the
// visitor was about to buy — a decision-reset rail sitting under the buy
// button. getFrequentlyBoughtWith() must now source real order co-purchase
// data ONLY, must never recommend the product itself, and must never fall
// back to any tag/category/vendor heuristic. The tag-based lookup that used
// to power this rail still exists as getSimilarByTag(), for the Ask Emma
// "similar products" tool where a substitute is the right answer — this file
// asserts the two are not the same function anymore.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** Rows returned by the next db.select() chain. */
    selectRows: [] as { other: string; count: number }[],
    /** Every predicate passed to .where(), so tests can assert the handle used. */
    whereArgs: [] as unknown[],
  }

  function chain(onCall?: (m: string, args: unknown[]) => void) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(state.selectRows).then(ok, err)
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args)
          return proxy
        }
      },
    }) as Record<string, unknown>
    return proxy
  }

  const db = {
    select: () => chain((m, args) => {
      if (m === 'where') state.whereArgs.push(args[0])
    }),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))
vi.mock('../../db/schema', () => ({
  productCopurchase: { handleA: 'handleA', handleB: 'handleB', count: 'count' },
}))
// KV memo/cache is bypassed entirely so every test call hits the "db" mock.
vi.mock('~/lib/kv.server', () => ({
  kvGetMemo: async () => null,
  kvSet: async () => {},
  primeKvMemo: () => {},
  KV_KEYS: { fbt: (handle: string) => `fbt:v2:${handle}` },
}))

const shopifyMock = vi.hoisted(() => ({
  getProductByHandle: vi.fn(),
  getProductsByTag: vi.fn(),
}))
vi.mock('~/lib/shopify.server', () => shopifyMock)

import { getFrequentlyBoughtWith, getSimilarByTag } from './recommendations.server'

beforeEach(() => {
  h.state.selectRows = []
  h.state.whereArgs = []
  shopifyMock.getProductByHandle.mockReset()
  shopifyMock.getProductsByTag.mockReset()
})

describe('getFrequentlyBoughtWith — the PDP cross-sell rail', () => {
  it('never returns the product itself, even if a bad row slipped into product_copurchase', async () => {
    h.state.selectRows = [
      { other: 'lelo-sona-cruise', count: 4 },
      { other: 'lelo-sona-cruise', count: 4 }, // same handle both sides of a corrupt row
    ]
    const handles = await getFrequentlyBoughtWith('lelo-sona-cruise', 4)
    expect(handles).not.toContain('lelo-sona-cruise')
  })

  it('returns real co-purchase handles when they exist', async () => {
    h.state.selectRows = [{ other: 'lube-water-based-4oz', count: 12 }]
    const handles = await getFrequentlyBoughtWith('lelo-sona-cruise', 4)
    expect(handles).toEqual(['lube-water-based-4oz'])
  })

  it('renders nothing (returns []) rather than falling back to a substitute when there is no order data', async () => {
    h.state.selectRows = []
    const handles = await getFrequentlyBoughtWith('doxy-die-cast-max', 4)
    expect(handles).toEqual([])
  })

  it('never calls the Shopify tag/vendor lookup — no heuristic fallback lives in this function anymore', async () => {
    h.state.selectRows = []
    await getFrequentlyBoughtWith('doxy-die-cast-max', 4)
    expect(shopifyMock.getProductByHandle).not.toHaveBeenCalled()
    expect(shopifyMock.getProductsByTag).not.toHaveBeenCalled()
  })

  it('propagates a db failure as an empty result instead of throwing (the rail must degrade to nothing, not 500)', async () => {
    const db = h.db as { select: () => unknown }
    const original = db.select
    db.select = () => { throw new Error('connection reset') }
    try {
      await expect(getFrequentlyBoughtWith('some-handle', 4)).resolves.toEqual([])
    } finally {
      db.select = original
    }
  })
})

describe('getSimilarByTag — Ask Emma "show me something similar", substitutes are correct here', () => {
  it('uses the same-tag heuristic and excludes the product itself', async () => {
    shopifyMock.getProductByHandle.mockResolvedValue({ handle: 'lelo-sona-cruise', tags: ['brand:lelo'] })
    shopifyMock.getProductsByTag.mockResolvedValue([
      { handle: 'lelo-sona-cruise' },
      { handle: 'lelo-mia-3' },
      { handle: 'lelo-mia-3-deep' },
    ])
    const handles = await getSimilarByTag('lelo-sona-cruise', 2)
    expect(handles).not.toContain('lelo-sona-cruise')
    expect(handles).toEqual(['lelo-mia-3', 'lelo-mia-3-deep'])
  })

  it('returns [] when the product has no tags', async () => {
    shopifyMock.getProductByHandle.mockResolvedValue({ handle: 'no-tags-product', tags: [] })
    const handles = await getSimilarByTag('no-tags-product', 2)
    expect(handles).toEqual([])
    expect(shopifyMock.getProductsByTag).not.toHaveBeenCalled()
  })
})
