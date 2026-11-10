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
    // ticket #20260: Hott Products novelty line, hand-rejected at tier B with
    // no [crude-title] gap_reason.
    ['Quick Dick Hit It Vibrating Flexible Dildo'],
    ['Wet Dreams Dream Boy Flutter Butter Jelly Cock&Ball Sling 10 Freq Bullet'],
    ['Wet Dreams Dream Boy Flutter Butter Jelly Cock & Ball Sling 10 Freq Bullet'],
    // ticket #20832 (fourth widening): the 10 titles product-manager
    // hand-rejected since 2026-10-30, 6 of which the list missed.
    ['The Super Sucker Cum Dumpster Female Ass ULTRASKYN Masturbator Vanilla'],
    ['GoodHead Booty Licker Spray Mint 1 oz.'],
    ['GoodHead Booty Licker Spray Cherry 1 oz.'],
    ['Barely Legal Leilani Stroker Tan'],
    ['Quick Dick Hit It Vibrating Flexible Dildo'],
    ['Wet Dreams Dream Boy Flutter Butter Jelly Cock&Ball Sling'],
    ['PDX Freshman Fuckslut Anal Stroker Beige'],
    ['The Super Sucker Cum Guzzler Male Mouth ULTRASKYN Masturbator Vanilla'],
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
    // ticket #20260: "cock & ball" / "cock&ball" is the ordinary category name
    // for c-rings and cock-and-ball slings, not a crude token — confirmed as a
    // false positive against two already-imported real catalog rows before
    // being dropped from CRUDE_TITLE_PATTERNS.
    'Tantus Stirrup C-Ring Cock and Ball Sling Onyx',
    'LEVELZ Vibrating Silicone Cock & Ball Ring with Shaft Loop Black',
    // ticket #20832: the exact negative cases named in the ticket, including
    // the brand-name case the fix deliberately does NOT tokenize (Creature
    // Cocks has 14 imported and 14 rejected SKUs, so a brand-name token would
    // be a false-positive class, not a precision gain).
    'Tantus Stirrup C-Ring Cock and Ball Sling',
    'LEVELZ Vibrating Silicone Cock & Ball Ring',
    'Creature Cocks Venom Loop Silicone Cock Ring',
  ]

  it.each(legitCases)('does not flag %s', (title) => {
    expect(isCrudeTitle(master(title))).toBe(false)
  })
})
