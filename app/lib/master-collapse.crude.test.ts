import { describe, it, expect } from 'vitest'
import { isCrudeTitle, CRUDE_TITLE_PATTERNS, type MasterRecord } from './master-collapse.server'
import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

// Minimal MasterRecord factory — only brand + displayTitle drive the flag.
function master(displayTitle: string, brand = 'Brand'): MasterRecord {
  const snap: NalpacPriceSnapshot = {
    sku: '1',
    vendor: brand,
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
    masterKey: `${brand}|${displayTitle}`,
    brand,
    displayTitle,
    baseTitle: displayTitle,
    category: 'Novelties',
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

describe('isCrudeTitle — soft-holds crude-named SKUs (#18014)', () => {
  // The recurring real-world cases cited in the ticket: rows phase2-auto
  // imported unattended that the product-manager agent rejects by hand.
  const crudeCases: Array<[string, string?]> = [
    ['Dick Boy 7in'],
    ['Pussy Licker: Strawberry'],
    ['GoodHead Pussy Licker Spray'],
    ['Cum Guzzler'],
    ['Fuckslut'],
    ['Dickalicious Vibrator'],
    ['Jizz Blaster Squirt Gun'],
    ['Cock Oil', 'Cock Oil Co'],
    ['Classic Massager', 'Dirty Whore Novelties'],
  ]

  it.each(crudeCases)('flags %s (%s)', (title, brand) => {
    expect(isCrudeTitle(master(title, brand))).toBe(true)
    // Either field alone should be enough to trip it.
    expect(
      CRUDE_TITLE_PATTERNS.test(title) || CRUDE_TITLE_PATTERNS.test(brand ?? 'Brand'),
    ).toBe(true)
  })

  // Legitimate wellness SKUs that must NOT be held, including the exact
  // benign case the ticket's DONE WHEN names.
  const legitCases: string[] = [
    'Pussy Willow',
    'Screaming O Silicone Cock Ring',
    'Bathmate Penis Pump',
    'Doxy Original Wand Massager',
    'Sportsheets Ball Gag',
    'Pjur Original Silicone Lube',
  ]

  it.each(legitCases)('does not flag %s', (title) => {
    expect(isCrudeTitle(master(title))).toBe(false)
  })
})
