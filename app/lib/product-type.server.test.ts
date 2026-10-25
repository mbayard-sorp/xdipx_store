// Enrich/publish-time product_type guard (ticket #17600; premise corrected
// by #17678). "Discontinued" IS a real product_type — Nalpac's own
// Integration app writes it on the live Shopify product when Nalpac
// discontinues an item (owner decision 2026-10-24) — but this import/enrich
// path must never be the one to set or overwrite it, so neither a current
// nor a derived value of it may ever publish through here. The derivation
// side of that invariant (no rule here can emit it) is covered in
// product-type-derive.test.ts; these cover the guard itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = {
  vocabRows: [{ productType: 'Dildo' }, { productType: 'Wand Massager' }, { productType: 'Discontinued' }],
  setShopifyProductType: vi.fn(async (..._args: unknown[]) => {}),
}

vi.mock('~/lib/db.server', () => ({
  db: { select: () => ({ from: () => Promise.resolve(h.vocabRows) }) },
}))
vi.mock('~/lib/shopify.server', () => ({
  getShopifyProductType: vi.fn(),
  setShopifyProductType: (...args: unknown[]) => h.setShopifyProductType(...args),
}))

import { ensureProductTypeForPublish } from './product-type.server'

describe('ensureProductTypeForPublish — Discontinued guard (#17600)', () => {
  beforeEach(() => {
    h.setShopifyProductType.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses to publish when the current type is "Discontinued"', async () => {
    const result = await ensureProductTypeForPublish({
      numericProductId: '1', sku: 'TEST-1', categories: [], title: 'Whatever', currentType: 'Discontinued',
    })
    expect(result).toBeNull()
    expect(h.setShopifyProductType).not.toHaveBeenCalled()
  })

  it('keeps a valid current type unchanged (unaffected by the new guard)', async () => {
    const result = await ensureProductTypeForPublish({
      numericProductId: '1', sku: 'TEST-2', categories: [], title: 'Whatever', currentType: 'Dildo',
    })
    expect(result).toBe('Dildo')
    expect(h.setShopifyProductType).not.toHaveBeenCalled()
  })

  it('derives and backfills a real type when none is set (unaffected by the new guard)', async () => {
    const result = await ensureProductTypeForPublish({
      numericProductId: '1', sku: 'TEST-3', categories: ['Wands'], title: 'Midnight Wand Massager', currentType: null,
    })
    expect(result).toBe('Wand Massager')
    expect(h.setShopifyProductType).toHaveBeenCalledWith('1', 'Wand Massager')
  })

  it('refuses and never writes when derivation itself would produce "Discontinued" (defense in depth)', async () => {
    vi.doMock('~/lib/product-type-derive', () => ({
      deriveProductType: () => ({ productType: 'Discontinued', matchedBy: 'category' }),
    }))
    vi.resetModules()
    const { ensureProductTypeForPublish: freshEnsure } = await import('./product-type.server')
    const result = await freshEnsure({
      numericProductId: '1', sku: 'TEST-4', categories: [], title: 'Whatever', currentType: null,
    })
    expect(result).toBeNull()
    expect(h.setShopifyProductType).not.toHaveBeenCalled()
    vi.doUnmock('~/lib/product-type-derive')
  })
})
