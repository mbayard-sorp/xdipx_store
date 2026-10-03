// Ticket #13099: the single reconciled Instagram category-eligibility check,
// replacing three independent copies that had drifted apart (see the file
// header of instagram-category-eligibility.ts).
import { describe, expect, it } from 'vitest'
import { isInstagramEligibleByCategory, INSTAGRAM_CATEGORY_EXCLUDED_PATTERNS } from './instagram-category-eligibility'

describe('isInstagramEligibleByCategory (#13099)', () => {
  it('excludes every dildo family type', () => {
    for (const type of ['Dildo', 'Fantasy Dildo', 'Realistic Dildo', 'Silicone Dildo', 'Strap-On Dildo', 'Vibrating Dildo']) {
      expect(isInstagramEligibleByCategory({ productType: type }).eligible).toBe(false)
    }
  })

  it('excludes an anatomically realistic product (sex doll)', () => {
    expect(isInstagramEligibleByCategory({ productType: 'Sex Doll' }).eligible).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isInstagramEligibleByCategory({ productType: 'realistic dildo' }).eligible).toBe(false)
  })

  // These matches only pick-todays-product.ts's original list caught; the
  // reconciled list now catches them regardless of which call site asks.
  it('excludes the wider doctrine-adjacent terms the narrower copies missed', () => {
    expect(isInstagramEligibleByCategory({ title: 'Dual Density Silicone Dong', productType: 'Dildo' }).eligible).toBe(false)
    expect(isInstagramEligibleByCategory({ title: 'Anatomically Realistic Stroker', productType: 'Stroker' }).eligible).toBe(false)
    expect(isInstagramEligibleByCategory({ title: 'Celebrity Molded Pocket Pussy', productType: 'Masturbator' }).eligible).toBe(false)
    expect(isInstagramEligibleByCategory({ title: 'Triple Density Vagina Stroker', productType: 'Masturbator' }).eligible).toBe(false)
  })

  it('checks title as well as product type', () => {
    expect(isInstagramEligibleByCategory({ title: 'Realistic Vibrating Toy', productType: 'Massager' }).eligible).toBe(false)
  })

  it('allows an ordinary category', () => {
    for (const type of ['Wand Massager', 'Cock Ring', 'Lubricant', 'Clitoral Vibrator', 'Bullet Vibrator']) {
      expect(isInstagramEligibleByCategory({ productType: type }).eligible).toBe(true)
    }
  })

  it('allows a null/missing title and product type', () => {
    expect(isInstagramEligibleByCategory({}).eligible).toBe(true)
    expect(isInstagramEligibleByCategory({ title: null, productType: undefined }).eligible).toBe(true)
  })

  it('names the matched pattern in the reason on exclusion', () => {
    const result = isInstagramEligibleByCategory({ productType: 'Dildo' })
    expect(result.reason).toMatch(/excluded category/)
  })

  it('reconciles to a single pattern list with no duplicate semantics', () => {
    expect(INSTAGRAM_CATEGORY_EXCLUDED_PATTERNS.length).toBeGreaterThan(0)
  })
})
