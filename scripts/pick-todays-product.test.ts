import { describe, expect, it } from 'vitest'
import { mapAllowsAdvertisedDiscount } from '../app/lib/gmc-metafields.server'
import {
  computeDiscountPct,
  isInstagramEligible,
  isInScope,
  mapVerdict,
  pickTodaysProduct,
  wasFeaturedRecently,
  type CampaignScope,
  type PickerProduct,
} from './pick-todays-product'

function product(overrides: Partial<PickerProduct> = {}): PickerProduct {
  return {
    handle: 'femmefunn-ultra-bullet',
    title: 'Femme Funn Ultra Bullet Massager',
    productType: 'Bullet Vibrator',
    productTypeDial: 'vibrator',
    vendor: 'Femme Funn',
    status: 'ACTIVE',
    availableForSale: true,
    price: 49.99,
    compareAtPrice: 89.99,
    mapPrice: null,
    originalPrice: 89.99,
    mapRestricted: false,
    imageUrl: 'https://cdn.shopify.com/packshot.jpg',
    ...overrides,
  }
}

const FIELD_GUIDE: CampaignScope = {
  slug: 'vibrator-field-guide',
  name: 'The Vibrator Field Guide',
  dials: ['vibrator', 'air-pulsation', 'wand'],
}

describe('MAP filter (ticket #3677 DONE WHEN)', () => {
  it('rejects a product whose map_price equals original_price (no discount framing anywhere)', () => {
    const p = product({ mapPrice: 89.99, originalPrice: 89.99, price: 49.99 })
    const v = mapVerdict(p, mapAllowsAdvertisedDiscount)
    expect(v.allowed).toBe(false)
    expect(v.verdict).toContain('map_price == original_price')

    const result = pickTodaysProduct([p], FIELD_GUIDE, '', mapAllowsAdvertisedDiscount)
    expect(result.pick).toBeNull()
    expect(result.rejections[0]?.filter).toBe('map')
  })

  it('rejects a map_restricted product regardless of prices', () => {
    const p = product({ mapRestricted: true })
    expect(mapVerdict(p, mapAllowsAdvertisedDiscount).allowed).toBe(false)
  })

  it('allows a product with no MAP on file', () => {
    const p = product({ mapPrice: null })
    expect(mapVerdict(p, mapAllowsAdvertisedDiscount).allowed).toBe(true)
  })

  it('allows a product whose MAP sits below our price', () => {
    const p = product({ mapPrice: 39.99, price: 49.99 })
    expect(mapVerdict(p, mapAllowsAdvertisedDiscount).allowed).toBe(true)
  })
})

describe('Instagram category filter (ticket #3677 DONE WHEN)', () => {
  it('rejects a realistic-dildo SKU at selection', () => {
    const p = product({
      handle: 'realistic-8-inch',
      title: 'Realistic 8 Inch Dildo with Suction Cup',
      productType: 'Realistic Dildo',
      productTypeDial: null,
    })
    const check = isInstagramEligible(p)
    expect(check.eligible).toBe(false)

    // Even in a live-better campaign (unrestricted scope) the category filter
    // still rejects it before any image could be generated.
    const liveBetter: CampaignScope = { slug: 'talk-yourself-into-it', name: 'Talk Yourself Into It' }
    const result = pickTodaysProduct([p], liveBetter, '', mapAllowsAdvertisedDiscount)
    expect(result.pick).toBeNull()
    expect(result.rejections[0]?.filter).toBe('category')
  })

  it('rejects dual-density and anatomically-realistic phrasing too', () => {
    expect(isInstagramEligible({ title: 'Dual Density Silicone Dong', productType: 'Dildo' }).eligible).toBe(false)
    expect(isInstagramEligible({ title: 'Anatomically Realistic Stroker', productType: 'Stroker' }).eligible).toBe(false)
  })

  it('passes a plain vibrator', () => {
    expect(isInstagramEligible(product()).eligible).toBe(true)
  })
})

describe('scope, stock, and recency filters', () => {
  it('rejects a lube in the middle of the Vibrator Field Guide', () => {
    const lube = product({ handle: 'water-based-lube', title: 'Water Based Lubricant', productType: 'Lubricant', productTypeDial: 'lube' })
    expect(isInScope(lube, FIELD_GUIDE).inScope).toBe(false)
  })

  it('rejects out-of-stock and non-ACTIVE products', () => {
    const oos = product({ availableForSale: false })
    const result = pickTodaysProduct([oos], FIELD_GUIDE, '', mapAllowsAdvertisedDiscount)
    expect(result.pick).toBeNull()
    expect(result.rejections[0]?.filter).toBe('stock')
  })

  it('rejects a product featured in the last 30 days of posts', () => {
    const p = product()
    const haystack = 'https://cdn.shopify.com/files/social-femmefunn-ultra-bullet-cast-priya-1.jpg'
    expect(wasFeaturedRecently(p.handle, haystack)).toBe(true)
    const result = pickTodaysProduct([p], FIELD_GUIDE, haystack, mapAllowsAdvertisedDiscount)
    expect(result.pick).toBeNull()
    expect(result.rejections[0]?.filter).toBe('recency')
  })
})

describe('pick ordering and evidence', () => {
  it('prefers the highest percentage off among passing candidates and returns evidence', () => {
    const small = product({ handle: 'small-discount', price: 80, compareAtPrice: 100 })
    const big = product({ handle: 'big-discount', price: 40, compareAtPrice: 100 })
    const result = pickTodaysProduct([small, big], FIELD_GUIDE, '', mapAllowsAdvertisedDiscount)
    expect(result.pick?.handle).toBe('big-discount')
    expect(result.discountPct).toBe(60)
    expect(result.evidence?.map).toBeTruthy()
    expect(result.evidence?.scope).toContain('vibrator')
  })

  it('computeDiscountPct returns null when there is no real markdown', () => {
    expect(computeDiscountPct(50, null)).toBeNull()
    expect(computeDiscountPct(50, 50)).toBeNull()
    expect(computeDiscountPct(50, 100)).toBe(50)
  })
})
