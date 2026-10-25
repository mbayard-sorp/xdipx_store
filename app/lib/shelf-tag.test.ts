import { describe, expect, it } from 'vitest'
import { SHELF_TAG_PREFIX, isRealShelfType, shelfTagForProductType, shelfTagSlug } from './shelf-tag'

describe('shelfTagSlug', () => {
  it('lowercases and joins words with a single hyphen', () => {
    expect(shelfTagSlug("Men's Underwear")).toBe('mens-underwear')
  })

  it('collapses a slash-separated run into one hyphen', () => {
    expect(shelfTagSlug('Babydoll / Chemise')).toBe('babydoll-chemise')
  })

  it('maps "&" to "and"', () => {
    expect(shelfTagSlug('Bath & Body')).toBe('bath-and-body')
  })

  it('drops apostrophes without leaving a stray hyphen', () => {
    expect(shelfTagSlug("Fifty Shades of Grey's Pleasure Collection")).toBe('fifty-shades-of-greys-pleasure-collection')
  })

  it('trims leading/trailing separators', () => {
    expect(shelfTagSlug('  Vibrator!! ')).toBe('vibrator')
  })

  it('handles a plain single word', () => {
    expect(shelfTagSlug('Dildo')).toBe('dildo')
  })
})

describe('shelfTagForProductType', () => {
  it('prefixes the slug with shelf:', () => {
    expect(shelfTagForProductType("Men's Underwear")).toBe(`${SHELF_TAG_PREFIX}mens-underwear`)
    expect(shelfTagForProductType('Bath & Body')).toBe('shelf:bath-and-body')
    expect(shelfTagForProductType('Babydoll / Chemise')).toBe('shelf:babydoll-chemise')
  })
})

describe('isRealShelfType', () => {
  it('accepts an ordinary product type', () => {
    expect(isRealShelfType('Vibrator')).toBe(true)
  })

  it('rejects "Discontinued" — the pricing-group value Nalpac writes, never a shelf', () => {
    expect(isRealShelfType('Discontinued')).toBe(false)
  })

  it('rejects blank, whitespace-only, null and undefined', () => {
    expect(isRealShelfType('')).toBe(false)
    expect(isRealShelfType('   ')).toBe(false)
    expect(isRealShelfType(null)).toBe(false)
    expect(isRealShelfType(undefined)).toBe(false)
  })
})
