import { describe, expect, it } from 'vitest'

import {
  VIDEO_MODELS,
  DEFAULT_TIER_BY_MODE,
  modeTierMismatch,
  isVideoModelId,
  isRetiredVideoTierId,
  RETIRED_VIDEO_TIER_IDS,
  tierIneligibility,
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

describe('every fal model keeps provider fal-implicit (undefined)', () => {
  it('never sets provider on a fal-queue tier', () => {
    for (const [, spec] of Object.entries(VIDEO_MODELS)) {
      if (spec.provider === 'atlascloud') continue
      expect(spec.provider).toBeUndefined()
      expect(spec.legacy).toBe(true)
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

describe('legacy fal video tiers (owner direction 2026-08-26: fal is images only)', () => {
  it('flags every fal video tier legacy', () => {
    const legacy = Object.entries(VIDEO_MODELS).filter(([, s]) => s.legacy).map(([id]) => id).sort()
    expect(legacy).toEqual(['grok', 'kling25-pro', 'omnihuman', 'seedance2', 'sync-lipsync', 'veo31', 'veo31-fast'])
  })
})

// ADR-016 Phase 4 (2026-09-23): the RunPod tiers are deleted from the
// registry. Historical rows still name them and must resolve to a clean
// retired_provider refusal, never an unknown-tier error or an undefined spec.
describe('retired RunPod tiers (ADR-016 Phase 4)', () => {
  it('are no longer registered or selectable', () => {
    for (const id of RETIRED_VIDEO_TIER_IDS) {
      expect(isVideoModelId(id)).toBe(false)
      expect(id in VIDEO_MODELS).toBe(false)
    }
    for (const spec of Object.values(VIDEO_MODELS)) {
      expect(spec.costKey.startsWith('runpod/')).toBe(false)
    }
  })

  it('refuse a historical row as retired_provider, not unknown_tier', () => {
    for (const id of [...RETIRED_VIDEO_TIER_IDS, 'wan22-i2v-fast']) {
      expect(isRetiredVideoTierId(id)).toBe(true)
      const why = tierIneligibility(id)
      expect(why?.code).toBe('retired_provider')
      expect(why?.message).toMatch(/ADR-016/)
      expect(why?.message).toMatch(/italk-atlas/)
    }
  })

  it('do not swallow the live Atlas Wan tiers or a genuinely unknown id', () => {
    expect(isRetiredVideoTierId('wan22turbo-atlas')).toBe(false)
    expect(isRetiredVideoTierId('wan27-atlas')).toBe(false)
    expect(tierIneligibility('not-a-tier')?.code).toBe('unknown_tier')
  })
})

// ADR-016 (2026-09-23): the Atlas tiers, from the video bake-off capture.
describe('VIDEO_MODELS Atlas tiers (ADR-016)', () => {
  it('registers italk-atlas as the audio-driven talking tier with a 30 s render cap', () => {
    const spec = VIDEO_MODELS['italk-atlas']
    expect(spec.provider).toBe('atlascloud')
    expect(spec.providerModel).toBe('atlascloud/infinitetalk')
    expect(spec.costKey).toBe('atlascloud/infinitetalk')
    expect(spec.ratePerSecondUsd).toBe(0.06)
    expect(spec.tier).toBe('avatar')
    expect(spec.audioDriven).toBe(true)
    expect(spec.nativeAudio).toBe(true)
    expect(spec.inventsDialogue).toBeUndefined()
    // Output length = audio length, so no duration enum; the cap is per render.
    expect(spec.allowedDurations).toEqual([])
    expect(spec.maxRenderSeconds).toBe(30)
  })

  it('registers grok-atlas as native audio that invents its own voice, 1 to 15 s', () => {
    const spec = VIDEO_MODELS['grok-atlas']
    expect(spec.provider).toBe('atlascloud')
    expect(spec.providerModel).toBe('xai/grok-imagine-video-v1.5/image-to-video')
    expect(spec.costKey).toBe('atlascloud/grok-imagine-1.5')
    expect(spec.ratePerSecondUsd).toBe(0.141)
    expect(spec.nativeAudio).toBe(true)
    expect(spec.inventsDialogue).toBe(true)
    expect(spec.audioDriven).toBeUndefined()
    expect(spec.allowedDurations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('registers the two silent insert tiers at 5 s', () => {
    const w27 = VIDEO_MODELS['wan27-atlas']
    expect(w27.providerModel).toBe('alibaba/wan-2.7/image-to-video')
    expect(w27.costKey).toBe('atlascloud/wan-2.7-i2v')
    expect(w27.ratePerSecondUsd).toBe(0.10)
    expect(w27.nativeAudio).toBe(false)
    expect(w27.allowedDurations).toEqual([5])
    const w22 = VIDEO_MODELS['wan22turbo-atlas']
    expect(w22.providerModel).toBe('atlascloud/wan-2.2-turbo/image-to-video')
    expect(w22.costKey).toBe('atlascloud/wan-2.2-turbo-i2v')
    expect(w22.ratePerSecondUsd).toBe(0.02)
    expect(w22.nativeAudio).toBe(false)
    expect(w22.allowedDurations).toEqual([5])
  })

  it('is never legacy and never recognized as a fal-queue model', async () => {
    for (const id of ['italk-atlas', 'grok-atlas', 'wan27-atlas', 'wan22turbo-atlas'] as const) {
      expect(isVideoModelId(id)).toBe(true)
      expect(VIDEO_MODELS[id].legacy).toBeUndefined()
      await expect(submitVideoRequest(id, {
        prompt: 'p', imageUrl: 'https://example.com/f.jpg', durationSeconds: 5, audioUrl: 'https://example.com/a.mp3',
      })).rejects.toThrow(/atlascloud-provider model/)
    }
  })

  it('routes audio: InfiniteTalk authored, Grok stripped or overdubbed, Wan 2.7 noise track stripped', () => {
    expect(classifyAudioPath(VIDEO_MODELS['italk-atlas'], false)).toBe('authored')
    expect(classifyAudioPath(VIDEO_MODELS['grok-atlas'], false)).toBe('stripped')
    expect(classifyAudioPath(VIDEO_MODELS['grok-atlas'], true)).toBe('overdubbed')
    // Wan 2.7 returns a -69 dB near-silent track; loudness normalization must not lift it.
    expect(classifyAudioPath(VIDEO_MODELS['wan27-atlas'], false)).toBe('stripped')
    expect(classifyAudioPath(VIDEO_MODELS['wan27-atlas'], true)).toBe('overdubbed')
    expect(classifyAudioPath(VIDEO_MODELS['wan22turbo-atlas'], false)).toBe('native-silent')
  })
})

describe('tier ids fit the column', () => {
  it('every VideoModelId is at most 16 chars (video_jobs/video_episodes.model_tier are varchar(16))', () => {
    // infinitetalk-atlas (18) would have failed every enqueue in Postgres,
    // after the ceiling checks, where a db mock never sees it. Rename, never widen.
    for (const id of Object.keys(VIDEO_MODELS)) expect(id.length, id).toBeLessThanOrEqual(16)
  })
})

describe('production mode -> tier (owner ruling 2026-09-23)', () => {
  it('defaults talking to InfiniteTalk and voiceover to Wan 2.7', () => {
    expect(DEFAULT_TIER_BY_MODE).toEqual({ talking: 'italk-atlas', voiceover: 'wan27-atlas' })
  })

  it('refuses talking on a silent tier and voiceover on an on-camera performer', () => {
    expect(modeTierMismatch('talking', 'italk-atlas')).toBeNull()
    expect(modeTierMismatch('talking', 'wan27-atlas')).toMatch(/silent/)
    expect(modeTierMismatch('talking', 'wan22turbo-atlas')).toMatch(/silent/)
    expect(modeTierMismatch('voiceover', 'wan27-atlas')).toBeNull()
    expect(modeTierMismatch('voiceover', 'wan22turbo-atlas')).toBeNull()
    expect(modeTierMismatch('voiceover', 'italk-atlas')).toMatch(/performs the line on camera/)
  })

  it('keeps grok-atlas registered and eligible but owner-only', () => {
    expect(VIDEO_MODELS['grok-atlas'].ownerOnly).toBe(true)
    for (const id of ['italk-atlas', 'wan27-atlas', 'wan22turbo-atlas'] as const) expect(VIDEO_MODELS[id].ownerOnly).toBeUndefined()
  })
})
