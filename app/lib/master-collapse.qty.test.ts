import { describe, it, expect } from 'vitest'
import { collapseMasters, isEligible } from './master-collapse.server'
import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

/**
 * Ticket #16275: `totalQty` used to sum `snap.qty` ('Total qty available'),
 * which can include Entrenue stock that never actually reaches Shopify.
 * Measured 2026-10-19: 38 of 105 published candidates went live at Shopify
 * qty 0, and every one had Nalpac-column qty 0 in the feed despite a
 * nonzero Total. These pin the fix at the one place it needs to hold:
 * `collapseMasters`'s qty aggregation, which every gate (`isEligible`,
 * `autoImportPhase2`, the Tier-C gate) and the admin queue's `qtyAvailable`
 * column all read as `master.totalQty`.
 */

function snap(over: Partial<NalpacPriceSnapshot> & { nalpacQtyAvailable?: string; totalQtyAvailable?: string }): NalpacPriceSnapshot {
  const { nalpacQtyAvailable, totalQtyAvailable, ...rest } = over
  return {
    sku: '1',
    vendor: 'Brand',
    productTitle: 'Widget',
    msrp: 40,
    wholesale: 16,
    mapPrice: null,
    qty: 0,
    inSaleFeed: false,
    inNewFeed: false,
    inTop100Feed: false,
    nalpacDiscountPct: null,
    raw: {
      mainRow: {
        Color: '', Size: '', 'Fluid Oz': '',
        ...(nalpacQtyAvailable !== undefined ? { 'Nalpac qty available': nalpacQtyAvailable } : {}),
        ...(totalQtyAvailable !== undefined ? { 'Total qty available': totalQtyAvailable } : {}),
      },
    },
    ...rest,
  }
}

describe('collapseMasters totalQty (#16275)', () => {
  it('sums the Nalpac-column quantity, not the combined Total', () => {
    const snapshots = new Map<string, NalpacPriceSnapshot>([
      ['1', snap({ sku: '1', qty: 21, nalpacQtyAvailable: '0', totalQtyAvailable: '21' })],
    ])
    const [master] = collapseMasters(snapshots)
    expect(master!.totalQty).toBe(0)
  })

  it('a row with Nalpac 0 and Total 21 is excluded from auto-import by isEligible (DONE WHEN 1)', () => {
    const snapshots = new Map<string, NalpacPriceSnapshot>([
      ['1', snap({ sku: '1', qty: 21, nalpacQtyAvailable: '0', totalQtyAvailable: '21' })],
    ])
    const [master] = collapseMasters(snapshots)
    expect(isEligible(master!)).toMatchObject({ ok: false, reason: 'qty_below_20' })
  })

  it('a row with real Nalpac stock is still eligible even when Total is identical', () => {
    const base = snap({
      sku: '1', qty: 59, nalpacQtyAvailable: '59', totalQtyAvailable: '59',
      vendor: 'Brand', productTitle: 'Widget', msrp: 40, wholesale: 16,
    })
    const snapshots = new Map<string, NalpacPriceSnapshot>([
      ['1', { ...base, raw: { mainRow: { ...base.raw.mainRow, 'Image 1': 'https://img' } } }],
    ])
    const [master] = collapseMasters(snapshots)
    expect(master!.totalQty).toBe(59)
    expect(isEligible(master!)).toMatchObject({ ok: true })
  })

  it('sums Nalpac quantity across every variant in a multi-variant master', () => {
    const snapshots = new Map<string, NalpacPriceSnapshot>([
      ['1', snap({ sku: '1', productTitle: 'Widget Red', nalpacQtyAvailable: '12' })],
      ['2', snap({ sku: '2', productTitle: 'Widget Blue', nalpacQtyAvailable: '8' })],
    ])
    const [master] = collapseMasters(snapshots)
    expect(master!.totalQty).toBe(20)
  })

  it('treats a missing or unparseable Nalpac column as zero, not the combined Total', () => {
    const snapshots = new Map<string, NalpacPriceSnapshot>([
      ['1', snap({ sku: '1', qty: 100, totalQtyAvailable: '100' })], // no 'Nalpac qty available' at all
    ])
    const [master] = collapseMasters(snapshots)
    expect(master!.totalQty).toBe(0)
  })
})
