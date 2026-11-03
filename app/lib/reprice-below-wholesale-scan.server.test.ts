import { describe, it, expect } from 'vitest'
import { buildCandidateRows, formatScanSummary, type RepriceBelowWholesaleScanResult } from './reprice-below-wholesale-scan.server'

// Pure logic only -- no Shopify/DB. Mirrors the shape scanRepriceBelowWholesale's
// live GraphQL walk produces, so these fixtures exercise the exact same
// enforceWholesaleFloor clamp the pricing-apply-v2 write path enforces.

function product(overrides: Partial<{
  id: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  wholesaleCost: string | null
  variants: Array<{ id: string; sku: string | null; price: string; compareAtPrice: string | null; inventoryQuantity: number }>
}> = {}) {
  const wholesaleCost = 'wholesaleCost' in overrides ? overrides.wholesaleCost : '20.00'
  return {
    id: overrides.id ?? 'gid://shopify/Product/1',
    handle: overrides.handle ?? 'widget',
    title: overrides.title ?? 'Widget',
    vendor: overrides.vendor ?? 'Acme',
    productType: overrides.productType ?? 'wand',
    variants: { nodes: overrides.variants ?? [{ id: 'gid://shopify/ProductVariant/1', sku: 'SKU1', price: '15.00', compareAtPrice: null, inventoryQuantity: 5 }] },
    metafields: {
      nodes: wholesaleCost == null ? [] : [{ namespace: 'xdipx', key: 'xdipx.wholesale_cost', value: wholesaleCost }],
    },
  }
}

describe('buildCandidateRows', () => {
  it('flags a variant priced below the wholesale floor as a reprice candidate when in stock', () => {
    const { rows } = buildCandidateRows([product()], 0.1) // floor = 20 * 1.1 = 22
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sku: 'SKU1', price: 15, wholesaleCost: 20, floorPrice: 22, qty: 5, recommendation: 'reprice' })
  })

  it('flags an out-of-stock violator as a delist candidate', () => {
    const p = product({ variants: [{ id: 'v1', sku: 'SKU2', price: '15.00', compareAtPrice: null, inventoryQuantity: 0 }] })
    const { rows } = buildCandidateRows([p], 0.1)
    expect(rows[0]).toMatchObject({ recommendation: 'delist', qty: 0 })
  })

  it('skips a variant already at or above the floor', () => {
    const p = product({ variants: [{ id: 'v1', sku: 'SKU3', price: '30.00', compareAtPrice: null, inventoryQuantity: 5 }] })
    const { rows } = buildCandidateRows([p], 0.1)
    expect(rows).toHaveLength(0)
  })

  it('skips a product with no wholesale_cost metafield entirely', () => {
    const p = product({ wholesaleCost: null })
    const { rows, variantsScanned } = buildCandidateRows([p], 0.1)
    expect(rows).toHaveLength(0)
    expect(variantsScanned).toBe(0) // never reaches the variant loop without a cost
  })

  it('excludes XDX-TEST- skus from the violator list but still counts them as scanned', () => {
    const p = product({ variants: [{ id: 'v1', sku: 'XDX-TEST-123', price: '15.00', compareAtPrice: null, inventoryQuantity: 5 }] })
    const { rows, variantsScanned } = buildCandidateRows([p], 0.1)
    expect(rows).toHaveLength(0)
    expect(variantsScanned).toBe(1)
  })

  it('sorts violators worst margin first', () => {
    const p = product({
      variants: [
        { id: 'v1', sku: 'BETTER', price: '19.00', compareAtPrice: null, inventoryQuantity: 1 }, // margin (19-20)/19 ~ -5.3%
        { id: 'v2', sku: 'WORSE', price: '10.00', compareAtPrice: null, inventoryQuantity: 1 },   // margin (10-20)/10 = -100%
      ],
    })
    const { rows } = buildCandidateRows([p], 0.1)
    expect(rows.map(r => r.sku)).toEqual(['WORSE', 'BETTER'])
  })
})

describe('formatScanSummary', () => {
  const base: RepriceBelowWholesaleScanResult = {
    scannedProducts: 10,
    variantsScanned: 20,
    minMarkupPct: 0.1,
    violators: 2,
    repriceCount: 1,
    delistCount: 1,
    rows: [
      { variantGid: 'v1', sku: 'A', handle: 'a', title: 'A', vendor: 'Acme', productType: 'wand', price: 10, wholesaleCost: 20, floorPrice: 22, compareAtPrice: null, currentMarginPct: -100, qty: 0, recommendation: 'delist' },
      { variantGid: 'v2', sku: 'B', handle: 'b', title: 'B', vendor: 'Acme', productType: 'wand', price: 19, wholesaleCost: 20, floorPrice: 22, compareAtPrice: null, currentMarginPct: -5.3, qty: 3, recommendation: 'reprice' },
    ],
  }

  it('states the violator count, scanned totals, and the qty split', () => {
    const text = formatScanSummary(base)
    expect(text).toContain('2 ACTIVE variant(s) priced below the wholesale floor')
    expect(text).toContain('10 products / 20 variants scanned')
    expect(text).toContain('1 reprice candidate(s)')
    expect(text).toContain('1 delist candidate(s)')
  })

  it('includes each row up to the limit', () => {
    const text = formatScanSummary(base, 1)
    expect(text).toContain('Top 1 of 2')
    expect(text).toContain('A $10.00')
    expect(text).not.toContain('B $19.00')
  })
})
