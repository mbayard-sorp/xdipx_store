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
})
