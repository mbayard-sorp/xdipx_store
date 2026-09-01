import { describe, expect, it } from 'vitest'

import {
  VIDEO_MODELS,
  isVideoModelId,
  submitVideoRequest,
  assertSceneFrameContract,
  classifyAudioPath,
  compositeProductClauses,
  PRODUCT_SCALE_RATIO_ANCHOR,
  PRODUCT_SCALE_RATIO_ANCHOR_LARGE,
  SCENE_FRAME_MIN_WIDTH,
  SCENE_FRAME_MIN_HEIGHT,
} from './fal-video.server'

// Ticket #3991: Grok Imagine video tier + the 9:16 full-resolution scene-frame
// contract its image-to-video submit depends on.
// Ticket #4536 (split from #3997): the ratio-anchored scale clause must be
// emitted on every composited-product frame, on both compose paths, so a
// packshot with no scale cue can no longer render the product oversized.
describe('compositeProductClauses (scale-anchor clause)', () => {
  it('emits the face-fraction + hand ratio anchor on both paths', () => {
    expect(compositeProductClauses('fal')).toContain(PRODUCT_SCALE_RATIO_ANCHOR)
    expect(compositeProductClauses('atlas')).toContain(PRODUCT_SCALE_RATIO_ANCHOR)
  })

  it('anchors to two things visible in frame: one third of the face, smaller than the hand', () => {
    expect(PRODUCT_SCALE_RATIO_ANCHOR).toContain('one third the width')
    expect(PRODUCT_SCALE_RATIO_ANCHOR).toContain('smaller than their hand')
  })

  it('keeps the clause presenter-neutral (cast can be any gender)', () => {
    expect(PRODUCT_SCALE_RATIO_ANCHOR).not.toMatch(/\b(her|hers|she|his|him|he)\b/i)
  })

  it('keeps the general real-world-size cue alongside the ratio anchor', () => {
    expect(compositeProductClauses('fal')).toContain('true real-world size')
    expect(compositeProductClauses('atlas')).toContain('true real-world size')
  })

  it('carries the no-carton clause only on the Atlas one-stage path', () => {
    // The fal two-stage path strips the carton in its stage-1 plate, so the
    // carton clause belongs only to Atlas, which has no plate pre-pass.
    expect(compositeProductClauses('atlas')).toContain('Do not show any')
    expect(compositeProductClauses('fal')).not.toContain('Do not show any')
  })

  // Ticket #4648: a genuinely large product (wand, larger toy) is legitimately
  // wider than one third a face and comparable to a hand, so the fixed default
  // cap under-sizes it. A 'large' size-class hint relaxes the anchor.
  it("relaxes the anchor for a 'large' product on both paths", () => {
    for (const path of ['fal', 'atlas'] as const) {
      const large = compositeProductClauses(path, 'large')
      // The relaxed anchor is used and the small-product cap is dropped.
      expect(large).toContain(PRODUCT_SCALE_RATIO_ANCHOR_LARGE)
      expect(large).not.toContain(PRODUCT_SCALE_RATIO_ANCHOR)
      expect(large).not.toContain('one third the width')
      // Still anchored to in-frame references and still true-to-life size.
      expect(large).toContain("the presenter's face")
      expect(large).toContain('true real-world size')
    }
  })

  it("keeps the relaxed anchor presenter-neutral, same as the default", () => {
    expect(PRODUCT_SCALE_RATIO_ANCHOR_LARGE).not.toMatch(/\b(her|hers|she|his|him|he)\b/i)
  })

  it("'small', 'medium', and an omitted size class keep the default anchor unchanged", () => {
    // The prior behavior for every caller that does not know the size class.
    const base = compositeProductClauses('fal')
    expect(compositeProductClauses('fal', 'small')).toBe(base)
    expect(compositeProductClauses('fal', 'medium')).toBe(base)
    expect(compositeProductClauses('fal', undefined)).toBe(base)
    expect(compositeProductClauses('atlas', 'small')).toBe(compositeProductClauses('atlas'))
  })
})

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

// Ticket #3996: split nativeAudio into authored vs invented so model-invented
// dialogue is overdubbed or stripped instead of shipped.
describe('inventsDialogue registry', () => {
  it('flags exactly the generative tiers that write their own dialogue', () => {
    expect(VIDEO_MODELS.veo31.inventsDialogue).toBe(true)
    expect(VIDEO_MODELS['veo31-fast'].inventsDialogue).toBe(true)
    expect(VIDEO_MODELS.seedance2.inventsDialogue).toBe(true)
    expect(VIDEO_MODELS.grok.inventsDialogue).toBe(true)
  })

  it('never flags an authored-audio tier as inventing dialogue', () => {
    // OmniHuman performs OUR ElevenLabs track and sync-lipsync performs the
    // presenterLine; their audio is authored, not invented. Kling is silent.
    expect(VIDEO_MODELS.omnihuman.inventsDialogue).toBeFalsy()
    expect(VIDEO_MODELS['sync-lipsync'].inventsDialogue).toBeFalsy()
    expect(VIDEO_MODELS['kling25-pro'].inventsDialogue).toBeFalsy()
  })

  it('never sets inventsDialogue and audioDriven together (they are opposites)', () => {
    for (const spec of Object.values(VIDEO_MODELS)) {
      expect(spec.inventsDialogue && spec.audioDriven).toBeFalsy()
    }
  })
})

describe('classifyAudioPath', () => {
  it('keeps authored audio: an audio-driven avatar is never re-muxed', () => {
    // DONE WHEN #3996(c): OmniHuman is byte-for-byte unaffected. With or without
    // a voiceover value present, its performance is authored and stays.
    expect(classifyAudioPath(VIDEO_MODELS.omnihuman, false)).toBe('authored')
    expect(classifyAudioPath(VIDEO_MODELS.omnihuman, true)).toBe('authored')
  })

  it('keeps authored audio for the lipsync compound tier', () => {
    expect(classifyAudioPath(VIDEO_MODELS['sync-lipsync'], true)).toBe('authored')
  })

  it('overdubs an invented tier when a voiceover exists', () => {
    // DONE WHEN #3996(a): veo/seedance/grok carrying a voiceover get Emma's
    // track, which replaces the invented one.
    expect(classifyAudioPath(VIDEO_MODELS.veo31, true)).toBe('overdubbed')
    expect(classifyAudioPath(VIDEO_MODELS.seedance2, true)).toBe('overdubbed')
    expect(classifyAudioPath(VIDEO_MODELS.grok, true)).toBe('overdubbed')
  })

  it('strips an invented tier when there is no voiceover', () => {
    // DONE WHEN #3996(b): no voiceover, so the invented track is silenced rather
    // than shipped.
    expect(classifyAudioPath(VIDEO_MODELS.veo31, false)).toBe('stripped')
    expect(classifyAudioPath(VIDEO_MODELS.grok, false)).toBe('stripped')
  })

  it('overdubs a genuinely silent tier that carries a voiceover (unchanged Kling path)', () => {
    expect(classifyAudioPath(VIDEO_MODELS['kling25-pro'], true)).toBe('overdubbed')
  })

  it('passes a silent tier through untouched when there is no voiceover', () => {
    expect(classifyAudioPath(VIDEO_MODELS['kling25-pro'], false)).toBe('native-silent')
  })
})

// RunPod provider, Phase 2 (Wan 2.2 14B): the clip stage in video-pipeline
// routes these through runpod-video.server.ts instead of this file's fal
// queue client, keyed off `provider`.
describe('VIDEO_MODELS wan22 (RunPod provider)', () => {
  it('registers both wan22 tiers with provider runpod and no native audio', () => {
    for (const id of ['wan22-i2v', 'wan22-t2v'] as const) {
      const spec = VIDEO_MODELS[id]
      expect(spec.provider).toBe('runpod')
      expect(spec.costKey).toBe('runpod/wan22')
      expect(spec.nativeAudio).toBe(false)
      expect(spec.inventsDialogue).toBeUndefined()
      expect(spec.audioDriven).toBeUndefined()
      expect(spec.lipsync).toBeUndefined()
      expect(spec.allowedDurations).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      expect(spec.ratePerSecondUsd).toBeGreaterThan(0)
    }
  })

  it('are recognized video model ids', () => {
    expect(isVideoModelId('wan22-i2v')).toBe(true)
    expect(isVideoModelId('wan22-t2v')).toBe(true)
  })

  it('take the same silent-tier lipsync path as kling25-pro (no invented dialogue to strip)', () => {
    expect(classifyAudioPath(VIDEO_MODELS['wan22-i2v'], true)).toBe('overdubbed')
    expect(classifyAudioPath(VIDEO_MODELS['wan22-i2v'], false)).toBe('native-silent')
    expect(classifyAudioPath(VIDEO_MODELS['wan22-t2v'], true)).toBe('overdubbed')
    expect(classifyAudioPath(VIDEO_MODELS['wan22-t2v'], false)).toBe('native-silent')
  })
})

describe('every non-runpod model keeps provider fal-implicit (undefined)', () => {
  it('never sets provider on a fal-queue tier', () => {
    for (const [id, spec] of Object.entries(VIDEO_MODELS)) {
      if (id === 'wan22-i2v' || id === 'wan22-t2v' || id === 'wan22-s2v') continue
      expect(spec.provider).toBeUndefined()
    }
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

describe('VIDEO_MODELS.wan22-s2v (own-worker talking tier, ticket #5714)', () => {
  it('is an audio-driven RunPod tier with derived duration', () => {
    const spec = VIDEO_MODELS['wan22-s2v']
    expect(spec.provider).toBe('runpod')
    expect(spec.audioDriven).toBe(true)
    expect(spec.nativeAudio).toBe(true)
    expect(spec.allowedDurations).toEqual([])
    expect(spec.costKey).toBe('runpod/wan22-s2v')
    expect(spec.legacy).toBeUndefined()
  })

  it('never routes through the fal queue', async () => {
    await expect(submitVideoRequest('wan22-s2v', {
      prompt: '', imageUrl: 'https://example.com/f.jpg', durationSeconds: 10,
    })).rejects.toThrow(/RunPod-provider/)
  })

  // #6834, follow-up to #6585: the advertised rate this spec surfaces (read
  // verbatim by the config op and the fal-video Labs route) must use the
  // s2v-specific render-multiplier estimate, not the shared i2v/t2v one --
  // sharing it under-priced s2v's advertised rate by ~1.8x while the
  // enforcement path (estimateVideoCostUsd via costKey) was already correct.
  it('advertises a rate distinct from the shared i2v/t2v estimate', () => {
    const s2vRate = VIDEO_MODELS['wan22-s2v'].ratePerSecondUsd
    const i2vRate = VIDEO_MODELS['wan22-i2v'].ratePerSecondUsd
    const t2vRate = VIDEO_MODELS['wan22-t2v'].ratePerSecondUsd
    expect(i2vRate).toBe(t2vRate) // i2v/t2v deliberately still share one estimator
    expect(s2vRate).not.toBe(i2vRate)
    expect(s2vRate).toBeGreaterThan(0)
  })
})

describe('legacy fal video tiers (owner direction 2026-08-26: fal is images only)', () => {
  it('flags every fal video tier legacy and no runpod tier', () => {
    const legacy = Object.entries(VIDEO_MODELS).filter(([, s]) => s.legacy).map(([id]) => id).sort()
    expect(legacy).toEqual(['grok', 'kling25-pro', 'omnihuman', 'seedance2', 'sync-lipsync', 'veo31', 'veo31-fast'])
    expect(VIDEO_MODELS['wan22-i2v'].legacy).toBeUndefined()
    expect(VIDEO_MODELS['wan22-t2v'].legacy).toBeUndefined()
  })
})
