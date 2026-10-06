// Tickets #3422/#3535: Google Ads offline-conversion CSV shape. Pure
// formatting tests only — getUnexportedGoogleClickConversions and
// markGoogleClickConversionsExported hit the database and are exercised by
// the webhook insert they feed (attribution-gclid.server.test.ts covers the
// cart-attribute side of the same pipeline).
import { describe, it, expect } from 'vitest'
import { googleClickConversionToCSVRow, GOOGLE_ADS_CSV_HEADER, type GoogleClickConversionRow } from './google-ads-export.server'

function row(overrides: Partial<GoogleClickConversionRow> = {}): GoogleClickConversionRow {
  return {
    id: 1,
    orderId: '5551234567890',
    gclid: 'EAIaIQabc',
    gclidType: 'gclid',
    value: '29.99',
    currency: 'USD',
    clickTime: new Date('2026-10-01T12:00:00.000Z'),
    orderTime: new Date('2026-10-05T14:30:00.000Z'),
    ...overrides,
  }
}

describe('GOOGLE_ADS_CSV_HEADER', () => {
  it('has one column per value googleClickConversionToCSVRow emits', () => {
    expect(GOOGLE_ADS_CSV_HEADER.split(',')).toHaveLength(
      googleClickConversionToCSVRow(row(), 'xdipx Purchase').split(',').length,
    )
  })
})

describe('googleClickConversionToCSVRow', () => {
  it('puts a gclid in the Google Click ID column, leaving GBRAID/WBRAID empty', () => {
    const csv = googleClickConversionToCSVRow(row({ gclidType: 'gclid', gclid: 'EAIaIQabc' }), 'xdipx Purchase')
    const [gclidCol, gbraidCol, wbraidCol] = csv.split(',')
    expect(gclidCol).toBe('"EAIaIQabc"')
    expect(gbraidCol).toBe('""')
    expect(wbraidCol).toBe('""')
  })

  it('puts a gbraid in its own column, never the Google Click ID column', () => {
    const csv = googleClickConversionToCSVRow(row({ gclidType: 'gbraid', gclid: 'g1' }), 'xdipx Purchase')
    const [gclidCol, gbraidCol, wbraidCol] = csv.split(',')
    expect(gclidCol).toBe('""')
    expect(gbraidCol).toBe('"g1"')
    expect(wbraidCol).toBe('""')
  })

  it('puts a wbraid in its own column', () => {
    const csv = googleClickConversionToCSVRow(row({ gclidType: 'wbraid', gclid: 'w1' }), 'xdipx Purchase')
    const [, , wbraidCol] = csv.split(',')
    expect(wbraidCol).toBe('"w1"')
  })

  it('formats Conversion Time as Google\'s required "yyyy-MM-dd HH:mm:ss+00:00"', () => {
    const csv = googleClickConversionToCSVRow(row(), 'xdipx Purchase')
    expect(csv).toContain('"2026-10-05 14:30:00+00:00"')
  })

  it('carries the conversion value and currency through unescaped/escaped respectively', () => {
    const csv = googleClickConversionToCSVRow(row({ value: '44.50', currency: 'USD' }), 'xdipx Purchase')
    expect(csv.endsWith('44.50,"USD"')).toBe(true)
  })

  it('escapes a quote in the conversion name rather than breaking the row', () => {
    const csv = googleClickConversionToCSVRow(row(), 'xdipx "Purchase"')
    expect(csv).toContain('"xdipx ""Purchase"""')
  })
})
