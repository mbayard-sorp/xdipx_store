import { describe, it, expect } from 'vitest'
import { detectAxes, type MasterRecord } from './master-collapse.server'
import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

function snap(sku: string, title: string, color: string, qty = 10): NalpacPriceSnapshot {
  return {
    sku,
    vendor: 'Brand',
    productTitle: title,
    msrp: 40,
    wholesale: 16,
    mapPrice: null,
    qty,
    inSaleFeed: false,
    inNewFeed: false,
    inTop100Feed: false,
    nalpacDiscountPct: null,
    raw: { mainRow: { Color: color, Size: '', 'Fluid Oz': '' } },
  }
}

function master(baseTitle: string, snaps: NalpacPriceSnapshot[]): MasterRecord {
  return {
    masterKey: `brand|${baseTitle}`,
    brand: 'Brand',
    displayTitle: snaps[0]?.productTitle ?? baseTitle,
    baseTitle,
    category: 'Massagers',
    variantCount: snaps.length,
    inStockVariants: snaps.length,
    colors: [],
    sizes: [],
    fluidOz: [],
    totalQty: snaps.reduce((s, x) => s + (x.qty ?? 0), 0),
    wholesale: 16,
    msrp: 40,
    map: 0,
    marginMsrpPct: 0,
    marginMapPct: 0,
    profitPerUnit: 24,
    skus: snaps.map(s => s.sku),
    sampleImage: '',
    upcs: [],
    inTop100Feed: false,
    inNewFeed: false,
    inSaleFeed: false,
    snapshots: snaps,
  }
}

describe('detectAxes color-axis repairs', () => {
  it('Twist A2: fills a blank Color cell from the title remnant (Doxy Go shape)', () => {
    const m = master('doxy go wand', [
      snap('1', 'Doxy Go Wand', 'Multi-Color'),
      snap('2', 'Doxy Go Wand Black', 'Black'),
      snap('3', 'Doxy Go Wand Pink', ''),
      snap('4', 'Doxy Go Wand Purple', 'Purple'),
    ])
    const { axes, variantRows } = detectAxes(m)
    expect(axes).toEqual([{ name: 'Color', values: ['Black', 'Multi-Color', 'Pink', 'Purple'] }])
    expect(variantRows.map(v => v.optionValues[0])).toEqual(['Multi-Color', 'Black', 'Pink', 'Purple'])
    expect(variantRows.every(v => v.optionValues[0] !== '')).toBe(true)
  })

  it('Twist B2: disambiguates a duplicate color with the title remnant (flogger shape)', () => {
    const m = master('flogger with bow', [
      snap('1', 'Flogger Black with Pink Bow', 'Black'),
      snap('2', 'Flogger Black with Purple Bow', 'Black'),
      snap('3', 'Flogger Pink with Black Bow', 'Light Pink'),
    ])
    const { variantRows } = detectAxes(m)
    const tuples = variantRows.map(v => v.optionValues.join('|'))
    expect(new Set(tuples).size).toBe(3)
    expect(tuples).toContain('Light Pink')
    expect(tuples).not.toContain('Black|Black')
  })

  it('last-resort guard: drops the lower-qty variant when tuples stay identical', () => {
    // Titles equal to the base title leave no remnant, so B2 cannot resolve.
    const m = master('twin pack', [
      snap('1', 'Twin Pack', 'Black', 5),
      snap('2', 'Twin Pack', 'Black', 9),
      snap('3', 'Twin Pack', 'Red', 3),
    ])
    const { variantRows } = detectAxes(m)
    const tuples = variantRows.map(v => v.optionValues.join('|'))
    expect(new Set(tuples).size).toBe(tuples.length)
    expect(variantRows.find(v => v.optionValues[0] === 'Black')?.sku).toBe('2')
    expect(variantRows.find(v => v.optionValues[0] === 'Red')?.sku).toBe('3')
  })

  it('leaves clean single-axis masters untouched', () => {
    const m = master('classic vibe', [
      snap('1', 'Classic Vibe Teal', 'Teal'),
      snap('2', 'Classic Vibe Coral', 'Coral'),
    ])
    const { axes, variantRows } = detectAxes(m)
    expect(axes).toEqual([{ name: 'Color', values: ['Coral', 'Teal'] }])
    expect(variantRows.map(v => v.optionValues[0])).toEqual(['Teal', 'Coral'])
  })
})
