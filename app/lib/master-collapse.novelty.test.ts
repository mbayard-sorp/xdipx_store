import { describe, it, expect } from 'vitest'
import { isNoveltyCategory, NOVELTY_PATTERNS, type MasterRecord } from './master-collapse.server'
import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

// Minimal MasterRecord factory — only category + displayTitle drive the flag.
function master(displayTitle: string, category: string): MasterRecord {
  const snap: NalpacPriceSnapshot = {
    sku: '1',
    vendor: 'Brand',
    productTitle: displayTitle,
    msrp: 40,
    wholesale: 16,
    mapPrice: null,
    qty: 30,
    inSaleFeed: false,
    inNewFeed: false,
    inTop100Feed: false,
    nalpacDiscountPct: null,
    raw: { mainRow: { Color: '', Size: '', 'Fluid Oz': '' } },
  }
  return {
    masterKey: `brand|${displayTitle}`,
    brand: 'Brand',
    displayTitle,
    baseTitle: displayTitle,
    category,
    variantCount: 1,
    inStockVariants: 1,
    colors: [],
    sizes: [],
    fluidOz: [],
    totalQty: 30,
    wholesale: 16,
    msrp: 40,
    map: 0,
    marginMsrpPct: 0.6,
    marginMapPct: 0,
    profitPerUnit: 24,
    skus: ['1'],
    sampleImage: 'https://img',
    upcs: [],
    inTop100Feed: false,
    inNewFeed: false,
    inSaleFeed: false,
    snapshots: [snap],
  }
}

describe('isNoveltyCategory — flags off-brand novelty / gag gifts (#3882)', () => {
  // The recurring real-world reject titles/categories cited in the weekly rollup.
  const noveltyCases: Array<[string, string]> = [
    ['Super Fun Penis Flashlight Keychain', 'Novelties'],
    ['Pecker Candy Sprinkles', 'Candy & Edibles'],
    ['Penis Gummies Party Pack', 'Party Supplies'],
    ['Bachelorette Party Sash', 'Bachelorette'],
    ['Dirty Minds Joke Book', 'Books'],
    ['World\'s Best Lover Gag Gift Mug', 'Gag Gifts'],
    ['Booby Straws 10-Pack', 'Party Supplies'],
    ['Plushie Penis Pillow Pal', 'Plush Toys'],
    ['Naughty Party Favors Assortment', 'Party Novelties'],
    ['Some Item', 'Novelties & Games'],
    ['Willy Soap Bar', 'Bachelorette'],
  ]

  it.each(noveltyCases)('flags %s (%s)', (title, category) => {
    expect(isNoveltyCategory(master(title, category))).toBe(true)
    // Either field alone should be enough to trip it.
    expect(
      NOVELTY_PATTERNS.test(title) || NOVELTY_PATTERNS.test(category),
    ).toBe(true)
  })

  // Legitimate wellness SKUs that share a substring with a novelty token but
  // must NOT be held. "ball gag" vs "gag gift"; "penis pump" vs "penis candy".
  const legitCases: Array<[string, string]> = [
    ['Sportsheets Ball Gag', 'Bondage'],
    ['Bathmate Penis Pump', 'Pumps & Enlargement'],
    ['Screaming O Silicone Cock Ring', 'Cock Rings'],
    ['Cotton Candy Flavored Lubricant 4 oz', 'Lubricants'],
    ['Foreplay Couples Card Game', 'Games'],
    ['Liberator Wedge Position Pillow', 'Furniture'],
    ['Doxy Original Wand Massager', 'Massagers'],
    ['We-Vibe Bullet Vibrator', 'Vibrators'],
    ['Edible Massage Oil Vanilla', 'Massage'],
    ['Pjur Original Silicone Lube', 'Lubricants'],
  ]

  it.each(legitCases)('does not flag %s (%s)', (title, category) => {
    expect(isNoveltyCategory(master(title, category))).toBe(false)
  })
})
