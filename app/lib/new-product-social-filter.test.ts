import { describe, expect, it } from 'vitest'
import {
  NEW_PRODUCT_WEEKLY_CAP,
  newProductPostExcludeReason,
  restockPostExcludeReason,
} from './new-product-social-filter'

describe('newProductPostExcludeReason', () => {
  it('posts a genuine launch with a distinct mechanism', () => {
    expect(
      newProductPostExcludeReason({
        title: 'Aer Pulsating Suction Stimulator',
        productType: 'Air Pulsation',
        pricingRationales: ['sync -> in stock'],
        weeklyCount: 0,
      }),
    ).toBeNull()
  })

  // The exclude is scoped to the coconut-oil commodity form only. A real lube
  // category launch is postable (see the "Lube, Actually" campaign).
  it('posts a real lube-category launch (not a blanket lube exclude)', () => {
    expect(
      newProductPostExcludeReason({
        title: 'Silicone Personal Lubricant, 4 oz',
        productType: 'Lube',
        weeklyCount: 0,
      }),
    ).toBeNull()
  })

  describe('commodity consumables are excluded', () => {
    const cases: Array<[string, string]> = [
      ['Ultra Thin Latex Condoms 12pk', 'Condoms'],
      ['Foaming Toy Cleaner Spray', 'Cleaner'],
      ['Coconut Oil Massage Glide', 'Lube'],
      ['Climax Delay Wipes', 'Wipes'],
      ['Oral Pleasure Gel Mint', 'Oral'],
    ]
    it.each(cases)('excludes %s', (title, productType) => {
      const reason = newProductPostExcludeReason({ title, productType, weeklyCount: 0 })
      expect(reason).toMatch(/commodity consumable/)
    })
  })

  it('excludes off-theme novelty (the cannabis-leaf sticky-note pad)', () => {
    const reason = newProductPostExcludeReason({
      title: 'Cannabis Leaf Sticky Note Pad',
      productType: 'Novelty',
      weeklyCount: 0,
    })
    expect(reason).toMatch(/off-theme novelty/)
  })

  it('excludes a discontinued SKU from the pricing rationale', () => {
    const reason = newProductPostExcludeReason({
      title: 'Classic Bullet Vibrator',
      productType: 'Vibrator',
      pricingRationales: ['Discontinued in feed -> clearance sell price'],
      weeklyCount: 0,
    })
    expect(reason).toMatch(/discontinued/i)
  })

  it('excludes a dead-velocity SKU from the pricing rationale', () => {
    const reason = newProductPostExcludeReason({
      title: 'Slow Mover Wand',
      productType: 'Wand',
      pricingRationales: ['dead -> target margin'],
      weeklyCount: 0,
    })
    expect(reason).toMatch(/dead velocity/i)
  })

  it('enforces the weekly cap once reached', () => {
    const reason = newProductPostExcludeReason({
      title: 'Genuine New Launch',
      productType: 'Vibrator',
      weeklyCount: NEW_PRODUCT_WEEKLY_CAP,
    })
    expect(reason).toMatch(/weekly product-post cap/)
  })

  it('allows filing while under the weekly cap', () => {
    expect(
      newProductPostExcludeReason({
        title: 'Genuine New Launch',
        productType: 'Vibrator',
        weeklyCount: NEW_PRODUCT_WEEKLY_CAP - 1,
      }),
    ).toBeNull()
  })

  it('treats missing pricing/weekly signals as clean, not excluded', () => {
    expect(
      newProductPostExcludeReason({ title: 'Rose Air Pulse', productType: 'Air Pulsation' }),
    ).toBeNull()
  })
})

describe('restockPostExcludeReason', () => {
  it('posts a genuine restock crossing with no adverse pricing signal', () => {
    expect(restockPostExcludeReason({ pricingRationales: ['sync -> in stock'] })).toBeNull()
  })

  it('treats no pricing signal as clean, not excluded', () => {
    expect(restockPostExcludeReason({})).toBeNull()
    expect(restockPostExcludeReason({ pricingRationales: [] })).toBeNull()
  })

  // A product returning to stock on its way OUT of the catalogue is not news:
  // the discontinued/dead-velocity excludes match the new-product gate exactly
  // so the two triggers never drift apart (section 4c).
  it('excludes a discontinued SKU from the pricing rationale', () => {
    const reason = restockPostExcludeReason({
      pricingRationales: ['Discontinued in feed -> clearance sell price'],
    })
    expect(reason).toMatch(/discontinued/i)
  })

  it('excludes a dead-velocity SKU from the pricing rationale', () => {
    const reason = restockPostExcludeReason({ pricingRationales: ['dead -> target margin'] })
    expect(reason).toMatch(/dead velocity/i)
  })

  it('tolerates null/undefined rationale entries', () => {
    expect(
      restockPostExcludeReason({ pricingRationales: [null, undefined, 'sync -> in stock'] }),
    ).toBeNull()
  })

  // Unlike the new-product gate, restock has no title/commodity filter and no
  // weekly cap: a true crossing is rare enough to self-limit, so only the hard
  // pricing excludes apply.
  it('does not apply commodity or novelty title filters (crossing is self-limiting)', () => {
    expect(restockPostExcludeReason({ pricingRationales: ['sync -> in stock'] })).toBeNull()
  })
})
