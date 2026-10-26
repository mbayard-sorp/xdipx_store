import { describe, it, expect, vi } from 'vitest'
import {
  isUnboundedExposure,
  computeExposureCounts,
  codeAppearsInPromoRows,
  runDiscountExposureAudit,
  type CatalogVariant,
  type PriceFloorRow,
  type DiscountExposureDeps,
  type ExposedDiscount,
} from './discount-exposure-audit.server'

// These helpers back the daily discount-exposure audit: X25XPOFF (a live,
// catalog-wide, open-ended code with no bus row) was found only because a
// strategy run happened to read Shopify directly. Read-only -- never calls a
// discount mutation. Verified without Shopify or a database.

describe('isUnboundedExposure', () => {
  it('flags a catalog-wide code (items all, context all), even with an end date and a usage limit', () => {
    expect(isUnboundedExposure({ itemsAll: true, contextAll: true, endsAt: '2026-12-01T00:00:00Z', usageLimit: 100 })).toBe(true)
  })
  it('flags an open-ended code (no end date, no usage limit), even if scoped to specific products', () => {
    expect(isUnboundedExposure({ itemsAll: false, contextAll: true, endsAt: null, usageLimit: null })).toBe(true)
  })
  it('does not flag a scoped code with an end date', () => {
    expect(isUnboundedExposure({ itemsAll: false, contextAll: true, endsAt: '2026-12-01T00:00:00Z', usageLimit: null })).toBe(false)
  })
  it('does not flag a scoped code with a usage limit', () => {
    expect(isUnboundedExposure({ itemsAll: false, contextAll: true, endsAt: null, usageLimit: 250 })).toBe(false)
  })
  it('does not flag a catalog-wide code (items all) that is not also context all', () => {
    expect(isUnboundedExposure({ itemsAll: true, contextAll: false, endsAt: '2026-12-01T00:00:00Z', usageLimit: 100 })).toBe(false)
  })
})

const VARIANTS: CatalogVariant[] = [
  { sku: 'A1', vendor: 'Dame', price: 100, availableForSale: true },   // contractual brand, in stock
  { sku: 'A2', vendor: 'Generic Brand', price: 20, availableForSale: true },  // below cost at deep discount
  { sku: 'A3', vendor: 'Generic Brand', price: 50, availableForSale: false }, // would be below cost, but out of stock
  { sku: 'A4', vendor: 'Generic Brand', price: 80, availableForSale: true },  // no price-floor row at all
]

const FLOORS = new Map<string, PriceFloorRow>([
  ['A1', { wholesale: 60, msrp: 130, mapPrice: 100 }],
  ['A2', { wholesale: 18, msrp: 30, mapPrice: 30 }],   // MAP == MSRP
  ['A3', { wholesale: 45, msrp: 60, mapPrice: null }],
])

describe('computeExposureCounts', () => {
  it('counts in-stock variants pushed below wholesale cost at the given percentage', () => {
    // A2 at 25% off: 20 * 0.75 = 15, below its 18 wholesale, and in stock.
    // A3 would also go below its 45 wholesale (50 * 0.75 = 37.5) but is out of stock.
    const counts = computeExposureCounts(0.25, VARIANTS, FLOORS)
    expect(counts.belowCostCount).toBe(1)
  })
  it('counts products where MAP equals MSRP, independent of the discount depth', () => {
    const counts = computeExposureCounts(0.10, VARIANTS, FLOORS)
    expect(counts.mapEqualsMsrpCount).toBe(1) // A2 only
  })
  it('counts variants belonging to a Nalpac MAP-verified (contractual) brand', () => {
    const counts = computeExposureCounts(0.10, VARIANTS, FLOORS)
    expect(counts.contractualBrandVariantCount).toBe(1) // A1 (Dame)
  })
  it('never counts a variant with no price-floor row as below cost', () => {
    // A4 has no FLOORS entry at all. 40% off is deep enough to matter but
    // stays just short of also pushing A1 (wholesale 60) below cost, so this
    // isolates A4's "no floor row" exclusion from an unrelated threshold flip.
    const counts = computeExposureCounts(0.40, VARIANTS, FLOORS)
    expect(counts.belowCostCount).toBe(1) // still just A2
  })
})

describe('codeAppearsInPromoRows', () => {
  it('matches case-insensitively', () => {
    expect(codeAppearsInPromoRows('bf20', ['Code: BF20\nDepth: 20%'])).toBe(true)
    expect(codeAppearsInPromoRows('BF20', ['the code is bf20, scoped to...'])).toBe(true)
  })
  it('is false when no row mentions the code', () => {
    expect(codeAppearsInPromoRows('X25XPOFF', ['Code: BF20\nDepth: 20%'])).toBe(false)
    expect(codeAppearsInPromoRows('X25XPOFF', [])).toBe(false)
  })
})

function makeDeps(overrides: Partial<DiscountExposureDeps> = {}): DiscountExposureDeps {
  return {
    listExposedDiscounts: vi.fn(async () => []),
    listCatalogVariants: vi.fn(async () => VARIANTS),
    getPriceFloors: vi.fn(async () => FLOORS),
    isCoveredByOpenPromo: vi.fn(async () => false),
    fileBlocker: vi.fn(async () => ({ id: 1, created: true, reopened: false })),
    ...overrides,
  }
}

const X25XPOFF: ExposedDiscount = { code: 'X25XPOFF', discountId: 'gid://shopify/DiscountCodeNode/1', percentage: 0.25, endsAt: null, usageLimit: null }

describe('runDiscountExposureAudit', () => {
  it('does nothing when no ACTIVE code discount is unbounded', async () => {
    const deps = makeDeps()
    const res = await runDiscountExposureAudit(deps)
    expect(res).toEqual({ exposed: 0, findings: [] })
    expect(deps.listCatalogVariants).not.toHaveBeenCalled()
    expect(deps.fileBlocker).not.toHaveBeenCalled()
  })

  it('files a blocker with the computed exposure numbers when the code is not covered', async () => {
    const deps = makeDeps({
      listExposedDiscounts: vi.fn(async () => [X25XPOFF]),
      isCoveredByOpenPromo: vi.fn(async () => false),
    })
    const res = await runDiscountExposureAudit(deps)
    expect(res.exposed).toBe(1)
    expect(res.findings).toEqual([{
      code: 'X25XPOFF', belowCostCount: 1, mapEqualsMsrpCount: 1, contractualBrandVariantCount: 1,
      covered: false, blockerFiled: true,
    }])
    expect(deps.fileBlocker).toHaveBeenCalledOnce()
    const call = (deps.fileBlocker as any).mock.calls[0][0]
    expect(call.dedupeKey).toBe('discount-exposure:x25xpoff')
    expect(call.detail).toContain('1 in-stock variant(s) would sell below wholesale cost at 25% off')
    expect(call.detail).toContain('1 product(s) have MAP equal to MSRP')
    expect(call.detail).toContain('1 variant(s) belong to a Nalpac MAP-verified')
    expect(call.detail).toContain('no end date')
    expect(call.detail).toContain('no usage limit')
  })

  it('does not file a blocker when an open promo row already covers the code', async () => {
    const deps = makeDeps({
      listExposedDiscounts: vi.fn(async () => [X25XPOFF]),
      isCoveredByOpenPromo: vi.fn(async () => true),
    })
    const res = await runDiscountExposureAudit(deps)
    expect(res.findings[0]).toMatchObject({ covered: true, blockerFiled: false })
    expect(deps.fileBlocker).not.toHaveBeenCalled()
  })

  it('re-running files the same dedupeKey, never a second distinct one', async () => {
    const deps = makeDeps({
      listExposedDiscounts: vi.fn(async () => [X25XPOFF]),
      isCoveredByOpenPromo: vi.fn(async () => false),
    })
    await runDiscountExposureAudit(deps)
    await runDiscountExposureAudit(deps)
    expect(deps.fileBlocker).toHaveBeenCalledTimes(2)
    const [first, second] = (deps.fileBlocker as any).mock.calls
    expect(first[0].dedupeKey).toBe(second[0].dedupeKey)
  })

  it('fetches the catalog and price floors only once per run, not once per exposed code', async () => {
    const second: ExposedDiscount = { ...X25XPOFF, code: 'CURIOUS15' }
    const deps = makeDeps({ listExposedDiscounts: vi.fn(async () => [X25XPOFF, second]) })
    await runDiscountExposureAudit(deps)
    expect(deps.listCatalogVariants).toHaveBeenCalledOnce()
    expect(deps.getPriceFloors).toHaveBeenCalledOnce()
  })
})
