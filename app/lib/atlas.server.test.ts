// Unit tests for the Atlas Cloud size mapper. Seedream rejects any request
// under 3,686,400 pixels (verified live 2026-08-15: "image size must be at
// least 3686400 pixels"), so every mapping and every scaled explicit size must
// clear that floor while preserving the caller's aspect.
import { describe, it, expect } from 'vitest'
import { atlasSize } from './atlas.server'

const MIN_AREA = 3_686_400

function area(size: string): number {
  const [w, h] = size.split('*').map(Number)
  return w! * h!
}

describe('atlasSize', () => {
  it('maps every fal image_size enum at or above the provider pixel floor', () => {
    for (const key of ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9']) {
      expect(area(atlasSize(key)), key).toBeGreaterThanOrEqual(MIN_AREA)
    }
  })

  it('passes an already-large explicit size through unscaled', () => {
    expect(atlasSize({ width: 1728, height: 2160 })).toBe('1728*2160')
  })

  it('scales a small explicit size up to the pixel floor, preserving aspect', () => {
    const out = atlasSize({ width: 1080, height: 1350 })
    const [w, h] = out.split('*').map(Number)
    expect(w! * h!).toBeGreaterThanOrEqual(MIN_AREA)
    expect(w! / h!).toBeCloseTo(1080 / 1350, 2)
    expect(w! % 2).toBe(0)
    expect(h! % 2).toBe(0)
  })

  it('throws on an unmapped enum rather than silently changing aspect', () => {
    expect(() => atlasSize('portrait_21_9')).toThrow(/unmapped/)
  })

  it('throws on invalid explicit dimensions', () => {
    expect(() => atlasSize({ width: 0, height: 1080 })).toThrow(/invalid/)
  })
})
