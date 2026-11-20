import { describe, it, expect } from 'vitest'
import { addOnHandles, bulkUnitPrice, nextAddOnStep, normalizeBulkOffers, normalizeFreeGift, normalizeSalesPage, normalizeSection, parseAddOnStep, salesCtaAttr, screenAvailability } from './sales-page'

const base = {
  slug: 'quiet-pulse',
  productHandle: 'quiet-pulse-wand',
  headline: 'Quiet enough to *forget* the walls',
  subhead: 'Deep, rumbly, and hushed.',
}

describe('normalizeSalesPage', () => {
  it('maps a minimal page and fills defaults', () => {
    const p = normalizeSalesPage(base)!
    expect(p.slug).toBe('quiet-pulse')
    expect(p.live).toBe(false)
    expect(p.buttonLabel).toBe("I'll take it ♥")
    expect(p.closer).toBe(base.headline)
    expect(p.sections).toEqual([])
  })

  it('refuses a bad slug, a bad handle, or a missing headline', () => {
    expect(normalizeSalesPage({ ...base, slug: 'Bad Slug' })).toBeNull()
    expect(normalizeSalesPage({ ...base, productHandle: '/products/x' })).toBeNull()
    expect(normalizeSalesPage({ ...base, headline: '  ' })).toBeNull()
    expect(normalizeSalesPage(null)).toBeNull()
  })

  it('only accepts whitelisted button labels', () => {
    expect(normalizeSalesPage({ ...base, buttonLabel: 'Buy now' })!.buttonLabel).toBe("I'll take it ♥")
    expect(normalizeSalesPage({ ...base, buttonLabel: 'Show me' })!.buttonLabel).toBe('Show me')
  })

  it('turns em and en dashes into commas', () => {
    expect(normalizeSalesPage({ ...base, subhead: 'Deep — and hushed – always' })!.subhead).toBe('Deep, and hushed, always')
  })

  it('keeps live only when it is exactly true', () => {
    expect(normalizeSalesPage({ ...base, live: 'yes' })!.live).toBe(false)
    expect(normalizeSalesPage({ ...base, live: true })!.live).toBe(true)
  })

  it('drops unknown and empty sections, keeps the rest in order', () => {
    const p = normalizeSalesPage({
      ...base,
      sections: [
        { _type: 'spFaq', _key: 'a', heading: 'Questions', items: [{ q: 'Loud?', a: 'No.' }] },
        { _type: 'spMystery', _key: 'b', heading: 'x' },
        { _type: 'spFeatures', _key: 'c', heading: 'Specs', items: [] },
        { _type: 'spBuyBand', _key: 'd', heading: 'Yours *tonight*' },
      ],
    })!
    expect(p.sections.map(s => s.type)).toEqual(['faq', 'buyBand'])
  })
})

describe('normalizeSection', () => {
  it('never carries a review source to the page', () => {
    const s = normalizeSection({ _type: 'spProof', heading: 'Said by buyers', reviews: [{ quote: 'Love it', name: 'J.', source: 'judge.me/123' }] }, 0)
    expect(s).toEqual({ key: 's0', kicker: '', heading: 'Said by buyers', tone: 'paper', type: 'proof', reviews: [{ quote: 'Love it', name: 'J.' }] })
  })

  it('falls back to paper for an unknown tone', () => {
    expect(normalizeSection({ _type: 'spStory', heading: 'Hi', tone: 'neon' }, 1)!.tone).toBe('paper')
  })

  it('requires an image on an image section', () => {
    expect(normalizeSection({ _type: 'spImage', caption: 'x' }, 0)).toBeNull()
    expect(normalizeSection({ _type: 'spImage', image: { url: 'https://cdn.sanity.io/a.jpg', alt: 'A' } }, 0)).toMatchObject({ type: 'image' })
  })
})

describe('add-ons', () => {
  it('keeps at most two valid add-ons and drops the page product itself', () => {
    const p = normalizeSalesPage({
      ...base,
      addOns: [
        { productHandle: 'quiet-pulse-wand', pitch: 'Itself' },
        { productHandle: 'silk-lube', headline: 'The *lube*', pitch: 'Glides.' },
        { productHandle: 'bad handle', pitch: 'x' },
        { productHandle: 'toy-cleaner', pitch: 'Clean.' },
        { productHandle: 'charger', pitch: 'Spare.' },
      ],
    })!
    expect(p.addOns.map(a => a.productHandle)).toEqual(['silk-lube', 'toy-cleaner'])
  })

  it('drops an add-on with no pitch', () => {
    expect(normalizeSalesPage({ ...base, addOns: [{ productHandle: 'silk-lube', pitch: '' }] })!.addOns).toEqual([])
  })

  it('finds the next buyable step, or null for checkout', () => {
    expect(nextAddOnStep([true, true], 0)).toBe(1)
    expect(nextAddOnStep([false, true], 0)).toBe(2)
    expect(nextAddOnStep([true, true], 1)).toBe(2)
    expect(nextAddOnStep([true, false], 1)).toBeNull()
    expect(nextAddOnStep([], 0)).toBeNull()
  })

  it('parses only in-range single-digit steps', () => {
    expect(parseAddOnStep('1', 2)).toBe(1)
    expect(parseAddOnStep('2', 2)).toBe(2)
    expect(parseAddOnStep('3', 2)).toBeNull()
    expect(parseAddOnStep('0', 2)).toBeNull()
    expect(parseAddOnStep('1', 0)).toBeNull()
    expect(parseAddOnStep('1x', 2)).toBeNull()
    expect(parseAddOnStep(null, 2)).toBeNull()
  })
})

describe('add-on tiers', () => {
  const addOn = {
    productHandle: 'jo-4oz',
    headline: 'Add the *glide*',
    pitch: 'It wants lube.',
    tiers: [
      { productHandle: 'jelly', label: 'Good', blurb: 'Thick.' },
      { productHandle: 'jo-4oz', label: 'Better', blurb: 'Silky.' },
      { productHandle: 'jo-8oz', label: 'Best', blurb: 'Twice the bottle.' },
      { productHandle: 'extra', label: 'Fourth', blurb: 'Too many.' },
      { productHandle: 'quiet-pulse-wand', label: 'Itself', blurb: 'No.' },
    ],
  }

  it('keeps three valid tiers in order', () => {
    const [a] = normalizeSalesPage({ ...base, addOns: [addOn] })!.addOns
    expect(addOnHandles(a!)).toEqual(['jelly', 'jo-4oz', 'jo-8oz'])
    expect(a!.tiers[1]).toEqual({ productHandle: 'jo-4oz', label: 'Better', blurb: 'Silky.' })
  })

  it('drops a tier with no label or a bad handle, and the page product', () => {
    const [a] = normalizeSalesPage({
      ...base,
      addOns: [{ ...addOn, tiers: [{ productHandle: 'ok', label: '' }, { productHandle: 'bad handle', label: 'X' }, { productHandle: 'quiet-pulse-wand', label: 'Y' }, { productHandle: 'keep', label: 'Z' }] }],
    })!.addOns
    expect(a!.tiers.map(t => t.productHandle)).toEqual(['keep'])
  })

  it('falls back to the single product with no tiers', () => {
    const [a] = normalizeSalesPage({ ...base, addOns: [{ productHandle: 'solo', pitch: 'Yes.' }] })!.addOns
    expect(a!.tiers).toEqual([])
    expect(addOnHandles(a!)).toEqual(['solo'])
  })
})

describe('bulk offers', () => {
  it('keeps valid offers, smallest quantity first', () => {
    expect(normalizeBulkOffers([{ quantity: 3, percent: 15, code: 'GLIDE15' }, { quantity: 2, percent: 10, code: 'GLIDE10' }])).toEqual([
      { quantity: 2, percent: 10, code: 'GLIDE10' },
      { quantity: 3, percent: 15, code: 'GLIDE15' },
    ])
  })

  it('refuses an offer where buying more does not save more', () => {
    expect(normalizeBulkOffers([{ quantity: 2, percent: 15, code: 'AAA' }, { quantity: 3, percent: 10, code: 'BBB' }])).toEqual([{ quantity: 2, percent: 15, code: 'AAA' }])
  })

  it('refuses bad quantities, depths and codes', () => {
    expect(normalizeBulkOffers([{ quantity: 1, percent: 10, code: 'AAA' }, { quantity: 2, percent: 80, code: 'AAA' }, { quantity: 2, percent: 10, code: 'no spaces' }, { quantity: 2.5, percent: 10, code: 'AAA' }])).toEqual([])
    expect(normalizeBulkOffers(undefined)).toEqual([])
  })

  it('reaches the page through the normalizer', () => {
    const [a] = normalizeSalesPage({ ...base, addOns: [{ productHandle: 'solo', pitch: 'Yes.', bulkOffers: [{ quantity: 2, percent: 10, code: 'GLIDE10' }] }] })!.addOns
    expect(a!.bulkOffers).toEqual([{ quantity: 2, percent: 10, code: 'GLIDE10' }])
  })

  it('prices a unit the way Shopify checkout does', () => {
    expect(bulkUnitPrice(21.99, 10)).toBe(19.8)
    expect(bulkUnitPrice(32.99, 15)).toBe(28.05)
    expect(bulkUnitPrice(41.49, 15)).toBe(35.27)
    expect(bulkUnitPrice(21.99, 0)).toBe(21.99)
  })
})

describe('salesCtaAttr', () => {
  it('names the button on the cart', () => {
    expect(salesCtaAttr('do-the-math')).toEqual([{ key: '_sales_cta', value: 'do-the-math' }])
  })

  it('drops anything that is not one of our labels', () => {
    expect(salesCtaAttr(null)).toEqual([])
    expect(salesCtaAttr('')).toEqual([])
    expect(salesCtaAttr('<script>')).toEqual([])
    expect(salesCtaAttr('x'.repeat(41))).toEqual([])
  })
})

describe('free gift', () => {
  it('parses a valid gift and trims the label', () => {
    expect(normalizeSalesPage({ ...base, freeGift: { productHandle: 'jo-4oz', label: '  Free lube  ' } })!.freeGift).toEqual({ productHandle: 'jo-4oz', label: 'Free lube' })
  })

  it('is null when missing, so a page without it behaves as before', () => {
    expect(normalizeSalesPage(base)!.freeGift).toBeNull()
    expect(normalizeSalesPage({ ...base, freeGift: null })!.freeGift).toBeNull()
    expect(normalizeSalesPage({ ...base, freeGift: 'jo-4oz' })!.freeGift).toBeNull()
  })

  it('defaults the label to empty', () => {
    expect(normalizeSalesPage({ ...base, freeGift: { productHandle: 'jo-4oz' } })!.freeGift).toEqual({ productHandle: 'jo-4oz', label: '' })
  })

  it('rejects a bad handle', () => {
    expect(normalizeFreeGift({ productHandle: 'Bad Handle' }, 'quiet-pulse-wand')).toBeNull()
    expect(normalizeFreeGift({ productHandle: '' }, 'quiet-pulse-wand')).toBeNull()
    expect(normalizeFreeGift({ productHandle: 42 }, 'quiet-pulse-wand')).toBeNull()
  })

  it('rejects the gift being the page product itself', () => {
    expect(normalizeSalesPage({ ...base, freeGift: { productHandle: 'quiet-pulse-wand' } })!.freeGift).toBeNull()
  })

  it('strips dashes from the label', () => {
    expect(normalizeFreeGift({ productHandle: 'jo-4oz', label: 'Free \u2014 lube' }, 'x')!.label).toBe('Free, lube')
  })
})

describe('screenAvailability', () => {
  const lube = { productHandle: 'jo-4oz', headline: '', pitch: 'p', tiers: [{ productHandle: 'jo-4oz', label: 'A', blurb: '' }, { productHandle: 'jo-8oz', label: 'B', blurb: '' }], bulkLine: '', bulkOffers: [] }
  const cleaner = { productHandle: 'cleaner', headline: '', pitch: 'p', tiers: [], bulkLine: '', bulkOffers: [] }

  it('matches plain stock when there is no gift', () => {
    expect(screenAvailability([lube, cleaner], [true, false], null)).toEqual([true, false])
  })

  it('skips the screen that sells the gift, wherever it sits in the tiers', () => {
    expect(screenAvailability([lube, cleaner], [true, true], 'jo-4oz')).toEqual([false, true])
    expect(screenAvailability([lube, cleaner], [true, true], 'jo-8oz')).toEqual([false, true])
  })

  it('leaves other screens alone when the gift is unrelated', () => {
    expect(screenAvailability([lube, cleaner], [true, true], 'something-else')).toEqual([true, true])
  })

  it('sends the Gawk page straight to checkout when the gift is the only add-on', () => {
    expect(nextAddOnStep(screenAvailability([lube], [true], 'jo-4oz'), 0)).toBeNull()
  })
})
