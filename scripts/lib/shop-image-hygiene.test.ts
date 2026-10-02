import { describe, expect, it } from 'vitest'
import {
  altTextFor,
  chunk,
  isApparelTitle,
  nalpacImageOneUrl,
  hexToRgb,
  computeGroundPlacement,
  contactShadowSvg,
} from './shop-image-hygiene'

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

describe('nalpacImageOneUrl', () => {
  it('reads the Image 1 column off a main feed row', () => {
    expect(nalpacImageOneUrl({ SKU: 'ABC', 'Image 1': 'https://img.example/1.jpg' }))
      .toBe('https://img.example/1.jpg')
  })

  it('is null for a missing, empty, or blank value', () => {
    expect(nalpacImageOneUrl({ SKU: 'ABC' })).toBeNull()
    expect(nalpacImageOneUrl({ SKU: 'ABC', 'Image 1': '' })).toBeNull()
    expect(nalpacImageOneUrl({ SKU: 'ABC', 'Image 1': '   ' })).toBeNull()
    expect(nalpacImageOneUrl(undefined)).toBeNull()
  })
})

describe('hexToRgb', () => {
  it('parses a 6-digit hex with or without the leading #', () => {
    expect(hexToRgb('#FFE6DD')).toEqual({ r: 255, g: 230, b: 221 })
    expect(hexToRgb('FFE6DD')).toEqual({ r: 255, g: 230, b: 221 })
  })

  it('expands a 3-digit hex', () => {
    expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('throws on an unparseable value', () => {
    expect(() => hexToRgb('not-a-color')).toThrow(/invalid hex color/)
  })
})

describe('computeGroundPlacement', () => {
  it('scales a square product to the target fraction of the canvas, centered', () => {
    expect(computeGroundPlacement(100, 100, 1200, 0.78)).toEqual({
      width: 936, height: 936, left: 132, top: 132,
    })
  })

  it('preserves aspect ratio for a tall product', () => {
    const p = computeGroundPlacement(100, 200, 1200, 0.78)
    expect(p.height).toBe(936) // the longer edge hits the scale target
    expect(p.width).toBe(468) // half the height, same aspect as 100:200
    expect(p.left).toBe(Math.round((1200 - 468) / 2))
    expect(p.top).toBe(Math.round((1200 - 936) / 2))
  })

  it('preserves aspect ratio for a wide product', () => {
    const p = computeGroundPlacement(200, 100, 1200, 0.78)
    expect(p.width).toBe(936)
    expect(p.height).toBe(468)
  })

  it('rejects non-positive dimensions', () => {
    expect(() => computeGroundPlacement(0, 100, 1200, 0.78)).toThrow()
    expect(() => computeGroundPlacement(100, -1, 1200, 0.78)).toThrow()
  })
})

describe('contactShadowSvg', () => {
  it('centers the shadow under the placed product and stays inside the canvas', () => {
    const placement = computeGroundPlacement(100, 100, 1200, 0.78)
    const svg = contactShadowSvg(1200, placement)
    expect(svg).toContain('<svg width="1200" height="1200"')
    expect(svg).toContain('cx="600"')
    expect(svg).toMatch(/fill-opacity="0\.22"/)
  })
})
