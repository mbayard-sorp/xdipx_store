import { describe, expect, it } from 'vitest'
import { classifyMapRow, priceVsMap } from './map-restricted-sweep'

describe('priceVsMap', () => {
  it('treats equal prices as at MAP, within a cent', () => {
    expect(priceVsMap(119, 119)).toBe('at')
    expect(priceVsMap(118.996, 119)).toBe('at')
  })
  it('detects below and above', () => {
    expect(priceVsMap(99.99, 119)).toBe('below')
    expect(priceVsMap(129, 119)).toBe('above')
  })
  it('returns unknown for null, zero, or NaN MAP', () => {
    expect(priceVsMap(10, null)).toBe('unknown')
    expect(priceVsMap(10, 0)).toBe('unknown')
    expect(priceVsMap(10, NaN)).toBe('unknown')
  })
})

describe('classifyMapRow', () => {
  it('flags an unflagged product priced at MAP (Lovense Calor case)', () => {
    expect(classifyMapRow({ price: 119, mapPrice: 119, flagged: false })).toBe('flag')
  })
  it('flags an unflagged product above MAP', () => {
    expect(classifyMapRow({ price: 129, mapPrice: 119, flagged: false })).toBe('flag')
  })
  it('leaves flagged products alone', () => {
    expect(classifyMapRow({ price: 119, mapPrice: 119, flagged: true })).toBe('already flagged')
    expect(classifyMapRow({ price: 119, mapPrice: null, flagged: true })).toBe('already flagged')
  })
  it('reports below-MAP products and never flags them, flagged or not', () => {
    expect(classifyMapRow({ price: 100, mapPrice: 119, flagged: false })).toBe('below MAP, report only')
    expect(classifyMapRow({ price: 100, mapPrice: 119, flagged: true })).toBe('below MAP, report only')
  })
  it('does not flag when MAP is unknown', () => {
    expect(classifyMapRow({ price: 50, mapPrice: null, flagged: false })).toBe('no MAP known')
    expect(classifyMapRow({ price: 50, mapPrice: 0, flagged: false })).toBe('no MAP known')
  })
})
