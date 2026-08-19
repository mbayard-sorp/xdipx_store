// Social asset provenance + filename convention (ticket #2734).
//
// The predicate is the deterministic gate that keeps a retired packshot off a
// live Instagram feed once posting stops being owner-reviewed, so the cases
// below are drawn from real rows rather than invented: the generated assets are
// the ones on live posts 24 and 25, and the packshots are the ones sitting on
// pending drafts 22, 26 and 30 right now.
import { describe, it, expect } from 'vitest'
import {
  buildSocialAssetFilename,
  isGeneratedSocialAsset,
  allMediaAreGeneratedSocialAssets,
  socialAssetAspect,
  socialAssetMatchesAspect,
  socialAspectFromImageSize,
  PRODUCT_SCALES,
  isProductScale,
  withProductScale,
  scaleCueFromLengthInches,
  lengthInchesFromSpecifications,
} from './social-media.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'

describe('isGeneratedSocialAsset', () => {
  it('accepts generated social art that shipped on live posts', () => {
    // Post 24's hero and post 25's carousel slides, both live and compliant.
    expect(isGeneratedSocialAsset(`${CDN}/ig-pom-aloe-nightstand-drawer-v2.jpg?v=1786291942`)).toBe(true)
    expect(isGeneratedSocialAsset(
      `${CDN}/social-essential-vibing-p-spot-plug-carousel-final-1-20260809.jpg?v=1786293941`,
    )).toBe(true)
  })

  it('refuses the bare Nalpac packshots on the current pending drafts', () => {
    // These are the retired packshot-only stills the charter banned 2026-08-09.
    expect(isGeneratedSocialAsset(`${CDN}/77808A.jpg`)).toBe(false)
    expect(isGeneratedSocialAsset(`${CDN}/77292A.jpg?v=1775408527`)).toBe(false)
    expect(isGeneratedSocialAsset(`${CDN}/96177A.jpg?v=1775409277`)).toBe(false)
  })

  it('fails closed on anything it does not positively recognise', () => {
    expect(isGeneratedSocialAsset('')).toBe(false)
    expect(isGeneratedSocialAsset(`${CDN}/`)).toBe(false)
    expect(isGeneratedSocialAsset(`${CDN}/hero-banner.jpg`)).toBe(false)
    expect(isGeneratedSocialAsset('not a url at all')).toBe(false)
    // A malformed value must not throw — drafts carry whatever was written.
    expect(isGeneratedSocialAsset('://///')).toBe(false)
  })

  it('accepts a video pipeline final, and only the final (ticket #3733)', () => {
    const BLOB = 'https://abc123.public.blob.vercel-storage.com/video/6f9c2f1e-2b7d-4a83-9b1a-000000000000'
    // Blob appends a random suffix before the extension; both shapes are real.
    expect(isGeneratedSocialAsset(`${BLOB}/final.mp4`)).toBe(true)
    expect(isGeneratedSocialAsset(`${BLOB}/final-Ab12Cd.mp4`)).toBe(true)
    // Intermediates under the same job path never ship by URL alone.
    expect(isGeneratedSocialAsset(`${BLOB}/clip-Xy34Zw.mp4`)).toBe(false)
    expect(isGeneratedSocialAsset(`${BLOB}/clip-vo.mp4`)).toBe(false)
    expect(isGeneratedSocialAsset(`${BLOB}/9x16.mp4`)).toBe(false)
    expect(isGeneratedSocialAsset(`${BLOB}/frame-0.jpg`)).toBe(false)
    expect(isGeneratedSocialAsset(`${BLOB}/poster.jpg`)).toBe(false)
    // A `final.mp4` outside a video/ path is not a pipeline artifact.
    expect(isGeneratedSocialAsset(`${CDN}/final.mp4`)).toBe(false)
  })

  it('matches on the basename, not anywhere in the path', () => {
    // A directory called "social-" must not launder a packshot.
    expect(isGeneratedSocialAsset('https://cdn.example.com/social-assets/77292A.jpg')).toBe(false)
    expect(isGeneratedSocialAsset('https://cdn.example.com/ig-stuff/plain.jpg')).toBe(false)
  })

  it('ignores case and query strings', () => {
    expect(isGeneratedSocialAsset(`${CDN}/SOCIAL-Wand-scene-noon-20260812.JPG`)).toBe(true)
    expect(isGeneratedSocialAsset(`${CDN}/social-wand-scene-noon-20260812.jpg?v=1&width=1080`)).toBe(true)
  })
})

describe('allMediaAreGeneratedSocialAssets', () => {
  it('requires every slide, since a carousel is only as publishable as its worst', () => {
    expect(allMediaAreGeneratedSocialAssets([
      `${CDN}/social-a-scene-noon-20260812-1.jpg`,
      `${CDN}/social-a-cast-noon-20260812-2.jpg`,
    ])).toBe(true)

    expect(allMediaAreGeneratedSocialAssets([
      `${CDN}/social-a-scene-noon-20260812-1.jpg`,
      `${CDN}/77292A.jpg`,
    ])).toBe(false)
  })

  it('treats no media as not publishable rather than vacuously true', () => {
    expect(allMediaAreGeneratedSocialAssets([])).toBe(false)
    expect(allMediaAreGeneratedSocialAssets(null)).toBe(false)
    expect(allMediaAreGeneratedSocialAssets(undefined)).toBe(false)
  })
})

describe('buildSocialAssetFilename', () => {
  it('builds the canonical name, and its output passes the predicate', () => {
    const name = buildSocialAssetFilename({
      handle: 'we-vibe-chorus',
      archetype: 'scene',
      mood: 'nightstand',
      date: '2026-08-12',
    })
    expect(name).toBe('social-we-vibe-chorus-scene-nightstand-20260812.jpg')
    // The round trip is the point: anything this builder makes must be publishable.
    expect(isGeneratedSocialAsset(`${CDN}/${name}`)).toBe(true)
  })

  it('numbers carousel slides and omits the suffix for singles', () => {
    const base = { handle: 'pom', archetype: 'cast' as const, mood: 'warm', date: '2026-08-12' }
    expect(buildSocialAssetFilename({ ...base, slide: 3 }))
      .toBe('social-pom-cast-warm-20260812-3.jpg')
    expect(buildSocialAssetFilename(base)).toBe('social-pom-cast-warm-20260812.jpg')
    // Slide 0 is not a slide.
    expect(buildSocialAssetFilename({ ...base, slide: 0 })).toBe('social-pom-cast-warm-20260812.jpg')
  })

  it('slugs messy fragments instead of emitting an unusable filename', () => {
    expect(buildSocialAssetFilename({
      handle: "Emma's  Pick! (v2)",
      archetype: 'metaphor',
      mood: 'Warm Daylight',
      date: '2026-08-12',
    })).toBe('social-emma-s-pick-v2-metaphor-warm-daylight-20260812.jpg')
  })

  it('never emits an empty fragment when a caller passes junk', () => {
    const name = buildSocialAssetFilename({
      handle: '!!!', archetype: 'plate', mood: '---', date: '2026-08-12',
    })
    expect(name).toBe('social-untitled-plate-editorial-20260812.jpg')
    expect(isGeneratedSocialAsset(`${CDN}/${name}`)).toBe(true)
  })

  it('4:5 stays token-less so pre-#4205 names are unchanged', () => {
    const base = { handle: 'pom', archetype: 'cast' as const, mood: 'warm', date: '2026-08-12' }
    expect(buildSocialAssetFilename({ ...base, aspect: '4:5' }))
      .toBe('social-pom-cast-warm-20260812.jpg')
    // Absent aspect is 4:5 too — identical name.
    expect(buildSocialAssetFilename(base)).toBe('social-pom-cast-warm-20260812.jpg')
  })

  it('stamps a non-4:5 aspect into the name, before the slide suffix (#4205)', () => {
    const base = { handle: 'pom', archetype: 'cast' as const, mood: 'warm', date: '2026-08-12' }
    expect(buildSocialAssetFilename({ ...base, aspect: '16:9' }))
      .toBe('social-pom-cast-warm-20260812-16x9.jpg')
    expect(buildSocialAssetFilename({ ...base, aspect: '16:9', slide: 3 }))
      .toBe('social-pom-cast-warm-20260812-16x9-3.jpg')
    expect(buildSocialAssetFilename({ ...base, aspect: '9:16' }))
      .toBe('social-pom-cast-warm-20260812-9x16.jpg')
    // Still a recognised generated asset with the token present.
    expect(isGeneratedSocialAsset(`${CDN}/${buildSocialAssetFilename({ ...base, aspect: '16:9' })}`))
      .toBe(true)
  })
})

describe('social asset aspect — reuse-first shape guard (#4205)', () => {
  it('reads the aspect back out of a filename, defaulting to 4:5 by absence', () => {
    expect(socialAssetAspect('social-pom-cast-warm-20260812.jpg')).toBe('4:5')
    expect(socialAssetAspect('social-pom-cast-warm-20260812-16x9.jpg')).toBe('16:9')
    expect(socialAssetAspect('social-pom-cast-warm-20260812-16x9-3.jpg')).toBe('16:9')
    expect(socialAssetAspect('social-pom-cast-warm-20260812-9x16.jpg')).toBe('9:16')
    // Grandfathered ig- names have no date and are all 4:5.
    expect(socialAssetAspect('ig-pom-aloe-nightstand-drawer-v2.jpg')).toBe('4:5')
    // Works off a full CDN URL with a ?v= cache buster too.
    expect(socialAssetAspect(`${CDN}/social-pom-cast-warm-20260812-16x9.jpg?v=1786293941`)).toBe('16:9')
  })

  it('does not misread a token-shaped handle or mood before the date as an aspect', () => {
    // The date anchors the scan; anything before it is handle/archetype/mood.
    expect(socialAssetAspect('social-16x9-scene-16x9-20260812.jpg')).toBe('4:5')
  })

  it('an Instagram (4:5) reuse lookup cannot return an X (16:9) frame — the DONE WHEN', () => {
    const igFrame = 'social-pom-cast-warm-20260812.jpg'          // 4:5, token-less
    const xFrame = 'social-pom-cast-warm-20260812-16x9.jpg'      // 16:9
    const pool = [igFrame, xFrame]
    const forInstagram = pool.filter(f => socialAssetMatchesAspect(f, '4:5'))
    expect(forInstagram).toEqual([igFrame])
    expect(forInstagram).not.toContain(xFrame)
    // And the reverse: an X slot cannot pick up the Instagram 4:5 frame.
    const forX = pool.filter(f => socialAssetMatchesAspect(f, '16:9'))
    expect(forX).toEqual([xFrame])
  })

  it('classifies fal image sizes into an aspect (the name-it source of truth)', () => {
    expect(socialAspectFromImageSize({ width: 1080, height: 1350 })).toBe('4:5')  // Instagram feed
    expect(socialAspectFromImageSize({ width: 1920, height: 1080 })).toBe('16:9') // X landscape
    expect(socialAspectFromImageSize({ width: 1080, height: 1920 })).toBe('9:16') // TikTok
    expect(socialAspectFromImageSize({ width: 1080, height: 1080 })).toBe('1:1')
    expect(socialAspectFromImageSize('landscape_16_9')).toBe('16:9')
    expect(socialAspectFromImageSize('portrait_16_9')).toBe('9:16')
    // Absent or unusable size falls back to the historical 4:5 default.
    expect(socialAspectFromImageSize(undefined)).toBe('4:5')
    expect(socialAspectFromImageSize({ width: 0, height: 0 })).toBe('4:5')
  })
})

describe('product scale cues (ticket #2761)', () => {
  it('expresses scale relative to the hand, never in units', () => {
    // The model has no unit sense but does understand a hand it is drawing.
    for (const clause of Object.values(PRODUCT_SCALES)) {
      expect(clause).toMatch(/\bhand\b|\bpalm\b|\bfingers\b|\bwrist\b/)
      expect(clause).not.toMatch(/\b\d+\s?(cm|mm|in|inch|inches)\b/)
    }
  })

  it('appends a known preset to the prompt', () => {
    const out = withProductScale('A bright scene.', 'palm')
    expect(out.startsWith('A bright scene.')).toBe(true)
    expect(out).toContain(PRODUCT_SCALES.palm)
  })

  it('passes free text through for a product no preset fits', () => {
    const out = withProductScale('A bright scene.', 'about as wide as her two hands together')
    expect(out).toBe('A bright scene. about as wide as her two hands together')
  })

  it('leaves the prompt alone when the cue is empty', () => {
    expect(withProductScale('A bright scene.', '   ')).toBe('A bright scene.')
  })

  it('validates presets', () => {
    expect(isProductScale('palm')).toBe(true)
    expect(isProductScale('forearm')).toBe(true)
    expect(isProductScale('enormous')).toBe(false)
    expect(isProductScale(undefined)).toBe(false)
    // Must not be fooled by inherited Object properties.
    expect(isProductScale('toString')).toBe(false)
    expect(isProductScale('constructor')).toBe(false)
  })
})

describe('scale from real dimensions (ticket #2761)', () => {
  it('parses the length out of the specifications metafield', () => {
    expect(lengthInchesFromSpecifications([
      'Length: 4.7 inches', 'Width: 0.91 inches', 'Material: Body-safe silicone',
    ])).toBe(4.7)
  })

  it('returns null rather than inventing a number when there is no length', () => {
    expect(lengthInchesFromSpecifications(['Material: Silicone'])).toBeNull()
    expect(lengthInchesFromSpecifications([])).toBeNull()
    expect(lengthInchesFromSpecifications(null)).toBeNull()
    expect(lengthInchesFromSpecifications(['Length: not stated'])).toBeNull()
  })

  it('does not mistake a width line for a length', () => {
    expect(lengthInchesFromSpecifications(['Width: 0.91 inches'])).toBeNull()
  })

  it('describes a 4.7in bullet as shorter than a hand, which the palm preset got wrong', () => {
    const cue = scaleCueFromLengthInches(4.7)
    expect(cue).toContain('4.7 inches')
    expect(cue).toContain('two thirds')
    // The defect: `palm` claimed it was no taller than a palm is wide (~3.5in).
    expect(cue).not.toContain('within her hand')
  })

  it('states both a measurement and a hand-relative anchor at every size', () => {
    for (const L of [1.5, 3.5, 4.7, 7.5, 12]) {
      const cue = scaleCueFromLengthInches(L)
      expect(cue).toContain(`${L} inches`)
      expect(cue).toMatch(/hand|palm|wrist|finger|elbow/)
    }
  })
})
