import { describe, expect, it } from 'vitest'

import {
  VIDEO_MODELS,
  isVideoModelId,
  assertSceneFrameContract,
  SCENE_FRAME_MIN_WIDTH,
  SCENE_FRAME_MIN_HEIGHT,
} from './fal-video.server'

// Ticket #3991: Grok Imagine video tier + the 9:16 full-resolution scene-frame
// contract its image-to-video submit depends on.
describe('VIDEO_MODELS.grok', () => {
  it('registers the grok tier with the bake-off rate and unconstrained durations', () => {
    const spec = VIDEO_MODELS.grok
    expect(spec.falModel).toBe('xai/grok-imagine-video/v1.5/image-to-video')
    expect(spec.costKey).toBe('fal/grok-imagine-1.5')
    expect(spec.ratePerSecondUsd).toBe(0.14)
    expect(spec.tier).toBe('standard')
    expect(spec.nativeAudio).toBe(true)
    // The fal schema accepts any integer 1-15, unlike the Veo/Kling enums.
    expect(spec.allowedDurations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(spec.audioDriven).toBeUndefined()
    expect(spec.lipsync).toBeUndefined()
  })

  it('is a recognized video model id', () => {
    expect(isVideoModelId('grok')).toBe(true)
  })
})

describe('assertSceneFrameContract', () => {
  it('accepts the composed full-resolution 9:16 frame and larger', () => {
    expect(() => assertSceneFrameContract(1080, 1920)).not.toThrow() // composed target
    expect(() => assertSceneFrameContract(SCENE_FRAME_MIN_WIDTH, SCENE_FRAME_MIN_HEIGHT)).not.toThrow() // the floor
    expect(() => assertSceneFrameContract(1584, 2816)).not.toThrow() // the clean bake-off frame
  })

  it('rejects a below-full-resolution frame (the 464x688 frame that lost the product)', () => {
    expect(() => assertSceneFrameContract(464, 688)).toThrow(/below full resolution/i)
  })

  it('rejects a wrong-aspect frame that still clears the resolution floor', () => {
    // Both dims >= the 1080x1920 floor, but the ratio is not 9:16.
    expect(() => assertSceneFrameContract(1920, 1920)).toThrow(/not 9:16/i) // square
    expect(() => assertSceneFrameContract(1200, 1920)).toThrow(/not 9:16/i) // too wide
  })

  it('rejects unknown / zero dimensions rather than submitting an unverifiable frame', () => {
    expect(() => assertSceneFrameContract(null, null)).toThrow(/unknown dimensions/i)
    expect(() => assertSceneFrameContract(0, 0)).toThrow(/unknown dimensions/i)
    expect(() => assertSceneFrameContract(1080, undefined)).toThrow(/unknown dimensions/i)
  })

  it('tolerates ~1% compositor drift on an otherwise-valid full-res frame', () => {
    // 1069x1901 is ~1% under the composed 1080x1920, within both the resolution
    // floor and the 2% aspect tolerance.
    expect(() => assertSceneFrameContract(1069, 1901)).not.toThrow()
  })
})
