import { describe, it, expect } from 'vitest'
import {
  slugify,
  normalizeCategoryId,
  matchAllowedValues,
  buildColorPatternEntries,
  planAttributeWrites,
  resolveCategoryToSet,
  defaultCategoryId,
  allowedByName,
  type AllowedAttribute,
} from './shopify-category.server'

const v = (id: string, name: string) => ({ id, name })
const COLOR: AllowedAttribute = {
  id: '1', name: 'Color',
  values: [v('1', 'Black'), v('2', 'Pink'), v('3', 'Multicolor'), v('4', 'Rose gold')],
}
const PATTERN: AllowedAttribute = {
  id: '3', name: 'Pattern',
  values: [v('10', 'Solid'), v('11', 'Leopard')],
}
const POWER: AllowedAttribute = {
  id: '9', name: 'Power source',
  values: [v('20', 'Rechargeable'), v('21', 'Battery-powered')],
}
const ALLOWED = allowedByName({ attributes: [COLOR, PATTERN, POWER] })

describe('slugify', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(slugify('Power source')).toBe('power-source')
    expect(slugify("Men's  Thong!")).toBe('men-s-thong')
    expect(slugify('Rose gold')).toBe('rose-gold')
  })
})

describe('normalizeCategoryId', () => {
  it('accepts bare ids and gids, rejects junk', () => {
    expect(normalizeCategoryId('ma-1-4')).toBe('ma-1-4')
    expect(normalizeCategoryId('gid://shopify/TaxonomyCategory/hb-3-13')).toBe('hb-3-13')
    expect(normalizeCategoryId('  aa-1-6-2-4 ')).toBe('aa-1-6-2-4')
    expect(normalizeCategoryId('Mature > Erotic')).toBeNull()
    expect(normalizeCategoryId('')).toBeNull()
    expect(normalizeCategoryId(undefined)).toBeNull()
  })
})

describe('matchAllowedValues', () => {
  it('matches case-insensitively, dedupes, and reports rejects', () => {
    const r = matchAllowedValues(COLOR, ['black', 'BLACK', 'Teal', 'Pink'])
    expect(r.ok.map(x => x.name)).toEqual(['Black', 'Pink'])
    expect(r.rejected).toEqual(['Teal'])
  })
})

describe('buildColorPatternEntries', () => {
  it('shapes solid entries with label, color reference and hex', () => {
    const [e] = buildColorPatternEntries([COLOR.values[0]!], PATTERN.values[0]!)
    expect(e!.handle).toBe('black')
    expect(e!.fields).toEqual([
      { key: 'label', value: 'Black' },
      { key: 'color_taxonomy_reference', value: '["gid://shopify/TaxonomyValue/1"]' },
      { key: 'pattern_taxonomy_reference', value: 'gid://shopify/TaxonomyValue/10' },
      { key: 'color', value: '#000000' },
    ])
  })

  it('names printed entries by color plus pattern and omits the hex', () => {
    const [e] = buildColorPatternEntries([COLOR.values[1]!], PATTERN.values[1]!)
    expect(e!.handle).toBe('pink-leopard')
    expect(e!.fields.find(f => f.key === 'label')!.value).toBe('Pink leopard')
    expect(e!.fields.some(f => f.key === 'color')).toBe(false)
  })

  it('names a Multicolor print by the pattern alone', () => {
    const [e] = buildColorPatternEntries([COLOR.values[2]!], PATTERN.values[1]!)
    expect(e!.handle).toBe('leopard')
    expect(e!.fields.find(f => f.key === 'label')!.value).toBe('Leopard')
  })

  it('omits the pattern reference when there is no pattern', () => {
    const [e] = buildColorPatternEntries([COLOR.values[3]!], null)
    expect(e!.handle).toBe('rose-gold')
    expect(e!.fields.some(f => f.key === 'pattern_taxonomy_reference')).toBe(false)
  })
})

describe('planAttributeWrites', () => {
  it('plans color-pattern plus simple attributes and drops unknowns', () => {
    const plan = planAttributeWrites(
      ALLOWED,
      { Color: ['Black'], 'Power source': ['Rechargeable', 'Nuclear'], Bogus: ['x'] },
      new Set(),
      'ma-1-4',
    )
    expect(plan.colorPattern?.map(e => e.handle)).toEqual(['black'])
    // No Pattern requested: Solid is filled in.
    expect(plan.colorPattern?.[0]?.fields.some(f => f.key === 'pattern_taxonomy_reference')).toBe(true)
    expect(plan.simple).toHaveLength(1)
    expect(plan.simple[0]!.key).toBe('power-source')
    expect(plan.simple[0]!.entries[0]!.fields).toEqual([
      { key: 'label', value: 'Rechargeable' },
      { key: 'taxonomy_reference', value: 'gid://shopify/TaxonomyValue/20' },
    ])
    expect(plan.dropped).toContain('value "Nuclear" not allowed for Power source')
    expect(plan.dropped).toContain('attribute Bogus not on category ma-1-4')
  })

  it('never overwrites existing shopify metafields (fill gaps only)', () => {
    const plan = planAttributeWrites(
      ALLOWED,
      { Color: ['Black'], 'Power source': ['Rechargeable'] },
      new Set(['color-pattern', 'power-source']),
      'ma-1-4',
    )
    expect(plan.colorPattern).toBeNull()
    expect(plan.simple).toEqual([])
  })

  it('falls back to Multicolor when only a pattern is given', () => {
    const plan = planAttributeWrites(ALLOWED, { Pattern: ['Leopard'] }, new Set(), 'ma-1-4')
    expect(plan.colorPattern?.map(e => e.handle)).toEqual(['leopard'])
  })

  it('writes nothing for an empty request', () => {
    const plan = planAttributeWrites(ALLOWED, {}, new Set(), 'ma-1-4')
    expect(plan).toEqual({ colorPattern: null, simple: [], dropped: [] })
  })
})

describe('resolveCategoryToSet', () => {
  it('sets when the product has no category', () => {
    expect(resolveCategoryToSet(null, 'ma-1-4', false)).toEqual({ effective: 'ma-1-4', set: 'ma-1-4', kept: null })
  })
  it('is a no-op when the category already matches', () => {
    expect(resolveCategoryToSet('ma-1-4', 'ma-1-4', false)).toEqual({ effective: 'ma-1-4', set: null, kept: null })
  })
  it('keeps a differing existing category unless a change is allowed', () => {
    expect(resolveCategoryToSet('hb-3', 'hb-3-13', false)).toEqual({ effective: 'hb-3', set: null, kept: 'hb-3' })
    expect(resolveCategoryToSet('hb-3', 'hb-3-13', true)).toEqual({ effective: 'hb-3-13', set: 'hb-3-13', kept: null })
  })
})

describe('defaultCategoryId', () => {
  it('maps the unambiguous Shopify product types', () => {
    expect(defaultCategoryId('Lubricant', 'lube')).toBe('hb-3-13')
    expect(defaultCategoryId('Condom', null)).toBe('hb-1-5')
    expect(defaultCategoryId('Massage Oil', 'massage')).toBe('hb-3-11-4')
    expect(defaultCategoryId('Erotic Books', 'book-media')).toBe('ma-1-6')
    expect(defaultCategoryId('Adult Game', 'novelty')).toBe('ma-1-4')
  })
  it('falls back to the product type dial for toys and gear', () => {
    for (const dial of ['vibrator', 'dildo', 'anal', 'bondage', 'cock-ring', 'stroker', 'couples', 'harness', 'extender', 'pump', 'sex-machine']) {
      expect(defaultCategoryId('Discontinued', dial)).toBe('ma-1-4')
    }
    expect(defaultCategoryId('', 'condom')).toBe('hb-1-5')
    expect(defaultCategoryId(null, 'novelty', 'game')).toBe('ma-1-4')
  })
  it('has no default for types that need judgment', () => {
    for (const dial of ['massage', 'enhancer', 'wear', 'wellness']) {
      expect(defaultCategoryId('Massage Candle', dial)).toBeNull()
    }
    expect(defaultCategoryId('Novelty Gift', 'novelty', 'candy-edible')).toBeNull()
    expect(defaultCategoryId(null, undefined)).toBeNull()
  })
})
