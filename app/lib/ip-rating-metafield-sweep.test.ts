import { describe, expect, it } from 'vitest'
import {
  bulletNamesFlaggedIpCodeWithWaterLanguage,
  findIpRatingMetafieldHits,
} from './ip-rating-metafield-sweep'

describe('bulletNamesFlaggedIpCodeWithWaterLanguage', () => {
  it('does not flag the live le-wand-classique-petite care_instructions bullet in isolation: it names no IP code itself, the match is cross-field against the sibling specifications bullet (covered below in findIpRatingMetafieldHits)', () => {
    expect(
      bulletNamesFlaggedIpCodeWithWaterLanguage(
        'Fully waterproof — shower and bath play welcome, just avoid submerging the charging port',
      ),
    ).toBe(false)
  })

  it('flags an IPX7 code paired with shower language', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('Waterproof: IPX7 rating, safe in the shower')).toBe(true)
  })

  it('flags an IPX4 code paired with bath language', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('IPX4 splashproof design for bath time fun')).toBe(true)
  })

  it('flags an IPX7 code paired with running-water language', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('IPX7 rated, rinse clean under running water')).toBe(true)
  })

  it('flags an IPX4 code paired with tap/jet language', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('IPX4 handles jets from the tap just fine')).toBe(true)
  })

  it('does not flag an IPX5/IPX6 code even with water language (out of scope per the ticket)', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('IPX6 splashproof, safe in the shower')).toBe(false)
  })

  it('does not flag an IP code with no water language', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('Waterproof: IPX7 rating')).toBe(false)
  })

  it('does not flag water language with no flagged IP code', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('Fully waterproof, shower and bath play welcome')).toBe(false)
  })

  it('does not flag an empty or missing bullet', () => {
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage('')).toBe(false)
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage(null)).toBe(false)
    expect(bulletNamesFlaggedIpCodeWithWaterLanguage(undefined)).toBe(false)
  })
})

describe('findIpRatingMetafieldHits', () => {
  it('reports hits across both care_instructions and specifications surfaces', () => {
    const hits = findIpRatingMetafieldHits({
      handle: 'test-handle',
      careInstructions: ['IPX7 rated, shower and bath play welcome', 'Use water-based lube only'],
      specifications: ['Waterproof: IPX4 rating, jets from the tap are fine', 'Material: Silicone'],
    })
    expect(hits).toHaveLength(2)
    expect(hits.map(h => h.surface)).toEqual(['care_instructions', 'specifications'])
  })

  it('returns no hits when neither surface carries the co-occurrence', () => {
    const hits = findIpRatingMetafieldHits({
      handle: 'test-handle',
      careInstructions: ['Clean with mild soap and warm water', 'Charge with included USB-C cable'],
      specifications: ['Waterproof: IPX7 rating', 'Material: Body-safe silicone'],
    })
    expect(hits).toHaveLength(0)
  })

  it('returns no hits for empty bullet arrays', () => {
    expect(findIpRatingMetafieldHits({ handle: 'test-handle', careInstructions: [], specifications: [] })).toHaveLength(0)
  })

  it('flags the live le-wand-classique-petite shape: IP code in specifications, water language in a separate care_instructions bullet (ticket #24094 fix)', () => {
    const hits = findIpRatingMetafieldHits({
      handle: 'le-wand-classique-petite-wand-massager',
      careInstructions: [
        'Fully waterproof — shower and bath play welcome, just avoid submerging the charging port',
      ],
      specifications: ['Waterproof: IPX7 rating'],
    })
    expect(hits).toEqual([
      { surface: 'care_instructions', bullet: 'Fully waterproof — shower and bath play welcome, just avoid submerging the charging port' },
      { surface: 'specifications', bullet: 'Waterproof: IPX7 rating' },
    ])
  })

  it('does not flag a product that has an IP code in one field and unrelated bullets in the other, with no water language anywhere', () => {
    const hits = findIpRatingMetafieldHits({
      handle: 'test-handle',
      careInstructions: ['Charge with included USB-C cable', 'Store in the pouch provided'],
      specifications: ['Waterproof: IPX7 rating', 'Material: Body-safe silicone'],
    })
    expect(hits).toHaveLength(0)
  })

  it('does not flag a product that has water language in one field and no flagged IP code anywhere', () => {
    const hits = findIpRatingMetafieldHits({
      handle: 'test-handle',
      careInstructions: ['Fully waterproof, shower and bath play welcome'],
      specifications: ['Waterproof: IPX6 rating', 'Material: Body-safe silicone'],
    })
    expect(hits).toHaveLength(0)
  })
})
