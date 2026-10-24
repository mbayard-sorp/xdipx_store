// Nightly `sale:active` tag sweep (ticket #17601).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SALE_DISCOUNT_THRESHOLD,
  SALE_TAG,
  meetsSaleRule,
  runSaleTagSweep,
  type SaleTagProduct,
  type SaleTagRepo,
} from './sale-tag-sweep.server'

function product(overrides: Partial<SaleTagProduct> = {}): SaleTagProduct {
  return {
    productId: 'gid://shopify/Product/1',
    tags: [],
    status: 'ACTIVE',
    totalInventory: 10,
    variants: [{ price: 6, compareAtPrice: 10 }],
    ...overrides,
  }
}

describe('meetsSaleRule', () => {
  const T = 0.6

  it('qualifies a variant priced exactly at the threshold', () => {
    expect(meetsSaleRule(product({ variants: [{ price: 6, compareAtPrice: 10 }] }), T)).toBe(true)
  })

  it('does not qualify a variant priced one cent over the threshold', () => {
    expect(meetsSaleRule(product({ variants: [{ price: 6.01, compareAtPrice: 10 }] }), T)).toBe(false)
  })

  it('qualifies when ANY variant clears the threshold, even if another does not', () => {
    expect(meetsSaleRule(product({
      variants: [{ price: 9, compareAtPrice: 10 }, { price: 6, compareAtPrice: 10 }],
    }), T)).toBe(true)
  })

  it('never qualifies a draft or archived product, however deep the discount', () => {
    expect(meetsSaleRule(product({ status: 'DRAFT' }), T)).toBe(false)
    expect(meetsSaleRule(product({ status: 'ARCHIVED' }), T)).toBe(false)
  })

  it('never qualifies an out-of-stock product', () => {
    expect(meetsSaleRule(product({ totalInventory: 0 }), T)).toBe(false)
  })

  it('never qualifies a variant with no compare-at price', () => {
    expect(meetsSaleRule(product({ variants: [{ price: 1, compareAtPrice: null }] }), T)).toBe(false)
  })

  it('never qualifies a variant with a zero compare-at price', () => {
    expect(meetsSaleRule(product({ variants: [{ price: 1, compareAtPrice: 0 }] }), T)).toBe(false)
  })

  it('never qualifies a product with no variants', () => {
    expect(meetsSaleRule(product({ variants: [] }), T)).toBe(false)
  })
})

function fakeRepo(products: SaleTagProduct[]): SaleTagRepo & { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  return {
    added,
    removed,
    listCandidates: async () => products,
    addTag: async (id) => { added.push(id) },
    removeTag: async (id) => { removed.push(id) },
  }
}

describe('runSaleTagSweep', () => {
  it('adds the tag to a qualifying product that lacks it', async () => {
    const repo = fakeRepo([product({ productId: 'p1', tags: [] })])
    const result = await runSaleTagSweep({ repo, threshold: 0.6 })
    expect(repo.added).toEqual(['p1'])
    expect(repo.removed).toEqual([])
    expect(result).toEqual({ checked: 1, added: 1, removed: 0, threshold: 0.6 })
  })

  it('removes the tag from a product that no longer qualifies', async () => {
    const repo = fakeRepo([product({ productId: 'p1', tags: [SALE_TAG], variants: [{ price: 9, compareAtPrice: 10 }] })])
    const result = await runSaleTagSweep({ repo, threshold: 0.6 })
    expect(repo.removed).toEqual(['p1'])
    expect(repo.added).toEqual([])
    expect(result.removed).toBe(1)
  })

  it('leaves a product alone when its tag already matches the rule, either way', async () => {
    const repo = fakeRepo([
      product({ productId: 'already-tagged', tags: [SALE_TAG] }),
      product({ productId: 'already-untagged', tags: [], variants: [{ price: 9, compareAtPrice: 10 }] }),
    ])
    const result = await runSaleTagSweep({ repo, threshold: 0.6 })
    expect(repo.added).toEqual([])
    expect(repo.removed).toEqual([])
    expect(result).toEqual({ checked: 2, added: 0, removed: 0, threshold: 0.6 })
  })

  it('never touches any tag other than sale:active', async () => {
    const repo = fakeRepo([product({ productId: 'p1', tags: ['brand:tantus', 'for:couples'] })])
    await runSaleTagSweep({ repo, threshold: 0.6 })
    // addTag/removeTag each take one literal tag string — there is no call
    // shape here that could pass anything but SALE_TAG.
    expect(repo.added).toEqual(['p1'])
  })
})

describe('saleDiscountThreshold', () => {
  afterEach(() => {
    vi.doUnmock('./feed-processor.server')
    vi.resetModules()
  })

  it('falls back to the default when unset', async () => {
    vi.doMock('./feed-processor.server', () => ({ getPipelineSetting: async () => null }))
    vi.resetModules()
    const { saleDiscountThreshold: fresh } = await import('./sale-tag-sweep.server')
    expect(await fresh()).toBe(DEFAULT_SALE_DISCOUNT_THRESHOLD)
  })

  it('falls back to the default when the stored value is out of (0,1)', async () => {
    vi.doMock('./feed-processor.server', () => ({ getPipelineSetting: async () => '1.5' }))
    vi.resetModules()
    const { saleDiscountThreshold: fresh } = await import('./sale-tag-sweep.server')
    expect(await fresh()).toBe(DEFAULT_SALE_DISCOUNT_THRESHOLD)
  })

  it('uses the stored value when it is a valid fraction', async () => {
    vi.doMock('./feed-processor.server', () => ({ getPipelineSetting: async () => '0.5' }))
    vi.resetModules()
    const { saleDiscountThreshold: fresh } = await import('./sale-tag-sweep.server')
    expect(await fresh()).toBe(0.5)
  })
})
