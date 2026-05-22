import { describe, it, expect } from 'vitest'
import { isOperationalTag, editorialTagsOnly, normalizeTagList } from './tag-normalize'

describe('isOperationalTag', () => {
  it('flags prefixed operational tags', () => {
    for (const t of ['cat:restraints', 'brand:dame', 'price:25-50', 'nalpac-sku-12345', 'deal-status-pending']) {
      expect(isOperationalTag(t)).toBe(true)
    }
  })

  it('flags audience tags', () => {
    for (const t of ['for-him', 'for-her', 'for-couples']) {
      expect(isOperationalTag(t)).toBe(true)
    }
  })

  it('treats editorial sub-category labels as non-operational', () => {
    for (const t of ['Restraints', 'Top 100 Items', 'Plugs and Probes']) {
      expect(isOperationalTag(t)).toBe(false)
    }
  })

  it('is case-insensitive', () => {
    expect(isOperationalTag('CAT:Restraints')).toBe(true)
    expect(isOperationalTag('FOR-HER')).toBe(true)
  })
})

describe('editorialTagsOnly', () => {
  it('keeps only editorial labels from a mixed Shopify tag set', () => {
    const shopifyTags = [
      'cat:restraints', 'brand:dame', 'for-her', 'price:25-50',
      'nalpac-sku-99', 'deal-status-pending', 'Restraints', 'Top 100 Items',
    ]
    expect(editorialTagsOnly(shopifyTags)).toEqual(['Restraints', 'Top 100 Items'])
  })

  it('drops empty strings and handles nullish input', () => {
    expect(editorialTagsOnly(['', '  ', 'Restraints'])).toEqual(['Restraints'])
    expect(editorialTagsOnly(null)).toEqual([])
    expect(editorialTagsOnly(undefined)).toEqual([])
  })
})

describe('normalizeTagList still derives slugs from operational cat: tags', () => {
  it('matches editorial label slug to its cat: counterpart', () => {
    expect(normalizeTagList(['cat:plugs-and-probes', 'Plugs and Probes']))
      .toEqual(['plugs-and-probes'])
  })
})
