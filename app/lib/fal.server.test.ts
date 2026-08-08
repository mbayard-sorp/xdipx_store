// Unit tests for kontextResolutionMode() — the FLUX Kontext (ref-image) endpoint
// has no image_size param, so a caller's imageSize must resolve to a string
// aspect. A {width,height} object used to fall through to a hardcoded '16:9',
// silently generating the wrong aspect (ticket #152). These lock in the mapping.
import { describe, it, expect } from 'vitest'
import { kontextResolutionMode } from './fal.server'

describe('kontextResolutionMode', () => {
  it('maps the string image_size enums to their aspect', () => {
    expect(kontextResolutionMode('square_hd')).toBe('1:1')
    expect(kontextResolutionMode('square')).toBe('1:1')
    expect(kontextResolutionMode('portrait_4_3')).toBe('3:4')
    expect(kontextResolutionMode('portrait_16_9')).toBe('9:16')
    expect(kontextResolutionMode('landscape_4_3')).toBe('4:3')
    expect(kontextResolutionMode('landscape_16_9')).toBe('16:9')
  })

  it('maps a {width,height} object to the nearest aspect instead of defaulting to 16:9', () => {
    // The exact bug from #152: a 4:3 brief (1200x900) came back 16:9.
    expect(kontextResolutionMode({ width: 1200, height: 900 })).toBe('4:3')
    expect(kontextResolutionMode({ width: 1024, height: 1024 })).toBe('1:1')
    expect(kontextResolutionMode({ width: 1200, height: 1500 })).toBe('3:4')
    expect(kontextResolutionMode({ width: 1920, height: 1080 })).toBe('16:9')
    expect(kontextResolutionMode({ width: 1080, height: 1920 })).toBe('9:16')
  })

  it('snaps a near-but-not-exact ratio to the closest supported aspect', () => {
    // 1392x752 (~1.85) is the frame #152 flagged: nearest supported is 16:9.
    expect(kontextResolutionMode({ width: 1392, height: 752 })).toBe('16:9')
    // 4:5 (0.8) has no exact match; nearest is 3:4 (0.75), not 9:16 (0.5625).
    expect(kontextResolutionMode({ width: 800, height: 1000 })).toBe('3:4')
  })

  it('throws on an unmapped string rather than silently defaulting', () => {
    expect(() => kontextResolutionMode('cinematic_21_9')).toThrow(/unmapped image_size/)
  })

  it('throws on a degenerate object', () => {
    expect(() => kontextResolutionMode({ width: 0, height: 900 })).toThrow(/invalid image_size/)
    expect(() => kontextResolutionMode({ width: 1200, height: -1 })).toThrow(/invalid image_size/)
  })
})
