import { describe, expect, it } from 'vitest'
import { altTextFor, chunk, isApparelTitle } from './shop-image-hygiene'

describe('isApparelTitle', () => {
  it('flags worn garments', () => {
    expect(isApparelTitle('Prowler Fishnet Assless Trunk')).toBe(true)
    expect(isApparelTitle('Lace Bralette and Panty Set')).toBe(true)
    expect(isApparelTitle('Bend Over Beginner Strap-On Harness Kit Lavender')).toBe(true)
  })

  it('leaves toys and consumables alone', () => {
    expect(isApparelTitle('The Gentleman Rechargeable Prostate Massager')).toBe(false)
    expect(isApparelTitle('JO Blo Strawberry Oral Pleasure Gel 1 oz')).toBe(false)
    expect(isApparelTitle('Kinky Land Game')).toBe(false)
    // "brief" inside another word must not match
    expect(isApparelTitle('Briefcase Toy Organizer')).toBe(false)
  })
})

describe('altTextFor', () => {
  it('adds the brand when the title lacks it', () => {
    expect(altTextFor('Power + Delay Cream 2 oz.', 'Doc Johnson', 0)).toBe('Power + Delay Cream 2 oz. by Doc Johnson')
  })

  it('does not repeat a brand already in the title', () => {
    expect(altTextFor('JO H2O Original Lubricant 4 oz', 'jo', 0)).toBe('JO H2O Original Lubricant 4 oz')
  })

  it('numbers later views from 2', () => {
    expect(altTextFor('Magic Wand Plus', null, 2)).toBe('Magic Wand Plus, view 3')
  })

  it('never emits an em-dash', () => {
    expect(altTextFor('Wand — Black', '', 0)).not.toContain('—')
  })

  it('caps length at 512', () => {
    expect(altTextFor('x'.repeat(600), '', 0)).toHaveLength(512)
  })
})

describe('chunk', () => {
  it('splits evenly and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
