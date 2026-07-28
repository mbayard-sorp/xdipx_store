// Unit tests for the render-truth gate's pure logic.
//
// The regression under test is the 2026-07-24 to 07-26 incident: one malformed
// Sanity rail document made every homepage content block fall back to the
// hardcoded shell defaults, three days of published merchandising reached
// nobody, and every existing check (HTTP 200, hero renders, valid JSON-LD)
// passed the whole time because fallback content is still a valid page.
//
// homepage-healthcheck.server.ts pulls in Sanity, KV, Neon, and Sentry at
// module scope, so those are mocked out. Nothing here touches a database.
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/sentry.server', () => ({ Sentry: { captureException: vi.fn(), captureMessage: vi.fn() } }))
vi.mock('~/lib/kv.server', () => ({ kvGet: vi.fn(), kvSet: vi.fn() }))
vi.mock('~/lib/sanity.server', () => ({
  getHomepageDocRaw: vi.fn(),
  restoreHomepageDoc: vi.fn(),
  getHomeConfig: vi.fn(),
  invalidateCmsCache: vi.fn(),
}))
vi.mock('~/lib/homepage-payload.server', () => ({
  warmHomepagePayloadA: vi.fn(),
  invalidateHomepagePayloadA: vi.fn(),
  invalidateHomepagePayloadB: vi.fn(),
  readHomepagePayloadB: vi.fn(),
}))
vi.mock('~/lib/detection-tickets.server', () => ({
  fileDetectionTicket: vi.fn(async () => 1),
  makeDedupeKey: (...p: string[]) => p.join(':'),
}))

import {
  FALLBACK_MARKERS,
  assertSlateRendered,
  compareFingerprints,
  extractPublishedSlate,
  fingerprintSlate,
  normalizeMarker,
  normalizeRenderedText,
  sanityAssetId,
  utcDay,
  type PublishedSlate,
} from './homepage-healthcheck.server'

const SLATE: PublishedSlate = {
  heroHandle: 'wet-original-gel-lubricant',
  heroHandleRequested: 'wet-original-gel-lubricant',
  railTitles: ['Water-based, and honest about it'],
  wayfinderHeading: 'Pick the glide your toy actually wants',
  tileHeadlines: ['Water-based', 'Silicone'],
  couplesHeading: 'Wetter, longer, together.',
  tileImageIds: ['image-aaa', 'image-bbb'],
  couplesImageId: 'image-ccc',
  publishedBlockCount: 3,
}

/** A page rendering the whole published slate. */
const GOOD_HTML = `
<html><body>
  <a href="/products/wet-original-gel-lubricant">Take a peek</a>
  <h2>Water-based, and honest about it</h2>
  <h2>Pick the <em class="em">glide</em> your toy actually wants</h2>
  <span>Water-based</span><span>Silicone</span>
  <h2>Wetter, longer, <em class="em">together</em>.</h2>
</body></html>`

/** The incident: valid page, every slot showing the hardcoded shell default. */
const FALLBACK_HTML = `
<html><body>
  <a href="/products/some-rotating-product">Take a peek</a>
  <p>Emma&#x27;s edit</p>
  <h2>Find your <em class="em">way</em> in.</h2>
  <h2>Better <em class="em">together</em>.</h2>
</body></html>`

describe('normalizeRenderedText', () => {
  it('ignores <script> content so an embedded loader payload cannot fake a pass', () => {
    // This is the single most important assertion in the file. A React Router
    // document serialises the whole loader payload into inline JS, so every
    // published rail title is in the bytes whether or not one pixel rendered.
    const html = `<html><body><script>window.__d = {"heading":"Water-based, and honest about it"}</script><p>nothing rendered</p></body></html>`
    const text = normalizeRenderedText(html)
    expect(text).not.toContain(normalizeMarker('Water-based, and honest about it'))
    expect(text).toContain('nothingrendered')
  })

  it('sees through the <em> emphasis split React renders headings with', () => {
    const text = normalizeRenderedText('<h2>Wetter, longer, <em class="em">together</em>.</h2>')
    expect(text).toContain(normalizeMarker('Wetter, longer, together.'))
  })

  it('decodes the entities React escapes apostrophes into', () => {
    expect(normalizeRenderedText('<p>Emma&#x27;s edit</p>')).toContain(normalizeMarker("Emma's edit"))
  })

  it('treats curly and straight quotes as the same character', () => {
    expect(normalizeRenderedText('<p>Emma’s edit</p>')).toContain(normalizeMarker("Emma's edit"))
  })

  it('strips <style> blocks and HTML comments', () => {
    const text = normalizeRenderedText('<style>.a{content:"ghost"}</style><!-- ghost --><p>real</p>')
    expect(text).toBe('real')
  })
})

describe('extractPublishedSlate', () => {
  it('reads the hero pin, rail titles, wayfinder copy, and couples heading off payload B', () => {
    const slate = extractPublishedSlate({
      pinnedProduct: { handle: 'wet-original-gel-lubricant' },
      emmaHero: { featuredProductHandle: 'wet-original-gel-lubricant' },
      contentBlocks: {
        sections: [
          { _type: 'emmaCuratedRail', heading: 'Water-based, and honest about it' },
          {
            _type: 'wayfinderMosaic',
            heading: 'Pick the glide your toy actually wants',
            wayfinderTiles: [
              { label: 'Water-based', image: { url: 'https://cdn.sanity.io/images/p/d/image-aaa-1600x900.jpg' } },
              { label: 'Silicone' },
            ],
          },
          { _type: 'playTogetherBanner', heading: 'Wetter, longer, together.' },
          { _type: 'trustBar' },
        ] as never,
      },
    })
    expect(slate.heroHandle).toBe('wet-original-gel-lubricant')
    expect(slate.railTitles).toEqual(['Water-based, and honest about it'])
    expect(slate.wayfinderHeading).toBe('Pick the glide your toy actually wants')
    expect(slate.tileHeadlines).toEqual(['Water-based', 'Silicone'])
    expect(slate.couplesHeading).toBe('Wetter, longer, together.')
    expect(slate.tileImageIds).toEqual(['image-aaa'])
    expect(slate.publishedBlockCount).toBe(4)
  })

  it('only counts the rails the storefront actually renders', () => {
    const slate = extractPublishedSlate({
      contentBlocks: {
        sections: Array.from({ length: 6 }, (_, i) => ({
          _type: 'emmaCuratedRail',
          heading: `Rail ${i}`,
        })) as never,
      },
    })
    expect(slate.railTitles).toEqual(['Rail 0', 'Rail 1', 'Rail 2', 'Rail 3'])
  })

  it('reports a hero pin that never resolved into a product', () => {
    const slate = extractPublishedSlate({
      pinnedProduct: null,
      emmaHero: { featuredProductHandle: '  ghost-handle  ' },
      contentBlocks: { sections: [] },
    })
    expect(slate.heroHandle).toBeNull()
    expect(slate.heroHandleRequested).toBe('ghost-handle')
  })

  it('degrades to an empty slate rather than throwing on an empty payload', () => {
    const slate = extractPublishedSlate({})
    expect(slate.publishedBlockCount).toBe(0)
    expect(slate.railTitles).toEqual([])
  })
})

describe('assertSlateRendered', () => {
  it('passes when every published string is on the page', () => {
    const assertions = assertSlateRendered(SLATE, GOOD_HTML)
    expect(assertions.every(a => a.ok)).toBe(true)
    expect(assertions.map(a => a.section)).toContain('hero')
  })

  it('hard-fails every slot and flags the fallbacks on the incident page', () => {
    const assertions = assertSlateRendered(SLATE, FALLBACK_HTML)
    const failed = assertions.filter(a => !a.ok)
    expect(failed.length).toBe(assertions.length)
    const fellBack = new Set(failed.filter(a => a.fallbackRendered).map(a => a.section))
    expect(fellBack).toEqual(new Set(['hero', 'rails', 'wayfinder', 'couples']))
  })

  it('reports missing content WITHOUT a fallback flag when no shell marker rendered', () => {
    // A slot that is simply absent is a different diagnosis from a slot showing
    // the shell default, and the ticket body says so.
    const html = '<html><body><p>a completely unrelated page</p></body></html>'
    const assertions = assertSlateRendered({ ...SLATE, heroHandle: null, heroHandleRequested: null }, html)
    expect(assertions.every(a => !a.ok)).toBe(true)
    expect(assertions.every(a => !a.fallbackRendered)).toBe(true)
  })

  it('does not accuse a slot the team never published into', () => {
    const empty: PublishedSlate = {
      heroHandle: null,
      heroHandleRequested: null,
      railTitles: [],
      wayfinderHeading: null,
      tileHeadlines: [],
      couplesHeading: null,
      tileImageIds: [],
      couplesImageId: null,
      publishedBlockCount: 0,
    }
    // The page is all fallbacks, but nothing was published, so that is correct.
    expect(assertSlateRendered(empty, FALLBACK_HTML)).toEqual([])
  })

  it('flags a pinned hero handle that never resolved into the payload', () => {
    const assertions = assertSlateRendered(
      { ...SLATE, heroHandle: null, railTitles: [], wayfinderHeading: null, tileHeadlines: [], couplesHeading: null },
      GOOD_HTML,
    )
    expect(assertions).toHaveLength(1)
    expect(assertions[0]?.section).toBe('hero')
    expect(assertions[0]?.ok).toBe(false)
  })

  it('does not accept a hero handle that only appears as a URL prefix of another product', () => {
    const html = '<html><body><a href="/products/wet-original-gel-lubricant-2oz">x</a></body></html>'
    const hero = assertSlateRendered({ ...SLATE, railTitles: [], wayfinderHeading: null, tileHeadlines: [], couplesHeading: null }, html)
    expect(hero[0]?.ok).toBe(false)
  })

  it('does not let the loader payload in a <script> satisfy an assertion', () => {
    const html = `<html><body><script>${JSON.stringify(SLATE)}</script><p>fallbacks only</p></body></html>`
    expect(assertSlateRendered(SLATE, html).every(a => !a.ok)).toBe(true)
  })

  it('keeps the shell fallback strings in sync with the storefront', () => {
    expect(FALLBACK_MARKERS.wayfinder).toBe('Find your way in.')
    expect(FALLBACK_MARKERS.couples).toBe('Better together.')
    expect(FALLBACK_MARKERS.rails).toBe("Emma's edit")
  })
})

describe('sanityAssetId', () => {
  it('extracts the asset id from a Sanity CDN URL, ignoring crop and format', () => {
    expect(sanityAssetId('https://cdn.sanity.io/images/abc/prod/image-deadbeef-1600x900.jpg?w=800'))
      .toBe('image-deadbeef')
    expect(sanityAssetId('https://cdn.sanity.io/images/abc/prod/image-deadbeef-800x600.webp'))
      .toBe('image-deadbeef')
  })

  it('falls back to the whole URL off Sanity, and to null when unset', () => {
    expect(sanityAssetId('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
    expect(sanityAssetId(null)).toBeNull()
    expect(sanityAssetId(undefined)).toBeNull()
  })
})

describe('fingerprintSlate / compareFingerprints', () => {
  it('fingerprints the designated fresh slots', () => {
    expect(fingerprintSlate(SLATE)).toEqual({
      hero: 'wet-original-gel-lubricant',
      rails: 'Water-based, and honest about it',
      tiles: 'image-aaa|image-bbb',
      couples: 'image-ccc',
    })
  })

  it('reports every slot identical to yesterday', () => {
    const fp = fingerprintSlate(SLATE)
    expect(compareFingerprints(fp, fp).sort()).toEqual(['couples', 'hero', 'rails', 'tiles'])
  })

  it('reports only the slots that did not move', () => {
    const today = fingerprintSlate(SLATE)
    const yesterday = fingerprintSlate({ ...SLATE, heroHandle: 'a-different-product', tileImageIds: ['image-zzz'] })
    expect(compareFingerprints(today, yesterday).sort()).toEqual(['couples', 'rails'])
  })

  it('never reports an empty slot, so "nothing published twice" is not a freshness ticket', () => {
    const empty = { hero: '', rails: '', tiles: '', couples: '' }
    expect(compareFingerprints(empty, empty)).toEqual([])
  })

  it('reports nothing on the first ever day (no prior snapshot)', () => {
    expect(compareFingerprints(fingerprintSlate(SLATE), null)).toEqual([])
  })
})

describe('utcDay', () => {
  it('buckets by UTC calendar day, matching the daily merchandise run', () => {
    expect(utcDay(Date.parse('2026-07-27T23:59:59Z'))).toBe('2026-07-27')
    expect(utcDay(Date.parse('2026-07-28T00:00:01Z'))).toBe('2026-07-28')
  })
})
