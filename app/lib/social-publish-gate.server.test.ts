// Deterministic pre-publish checks (ticket #2739).
//
// These run in place of the owner's approval click, so the cases below are the
// ones that actually happened or that the charter names, not invented ones: the
// packshots on the current pending drafts, the out-of-stock product that had to
// be deleted from the feed on 2026-08-09, and the sale-attempt forms Meta's
// Restricted Goods standard removes.
import { describe, it, expect } from 'vitest'
import {
  runDeterministicPublishChecks,
  findRepeatedRun,
  shingles,
  REPETITION_SHINGLE,
  isProductSellable,
} from './social-publish-gate.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'
const GOOD_MEDIA = [`${CDN}/social-rosales-cast-maya-20260812-1.jpg`]
const inStock = async () => true
const outOfStock = async () => false
const notMember = async () => false

/** A caption with nothing wrong with it. */
const CLEAN = 'ok, a detail about silicone nobody mentions: not all of it is the same grade.'

function checks(r: { findings: { check: string }[] }): string[] {
  return r.findings.map(f => f.check).sort()
}

describe('a clean post', () => {
  it('passes with no findings', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'rosales' },
      { getAvailability: inStock },
    )
    expect(r.findings).toEqual([])
    expect(r.blocked).toBe(false)
    expect(r.held).toBe(false)
  })
})

describe('imagery provenance', () => {
  it('blocks a bare Nalpac packshot, which is what the pending drafts carry', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/77292A.jpg?v=1775408527`] },
      { isLibraryMember: notMember },
    )
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })

  it('blocks a carousel where only one slide is a packshot', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: [...GOOD_MEDIA, `${CDN}/96177A.jpg`] },
      { isLibraryMember: notMember },
    )
    expect(r.blocked).toBe(true)
  })

  // Library membership burn-in (#4937): prefix OR membership passes.
  it('passes a prefix-named url without consulting the library', async () => {
    let asked = 0
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA },
      { isLibraryMember: async () => { asked++; return false } },
    )
    expect(checks(r)).not.toContain('image-provenance')
    expect(asked).toBe(0)
  })

  it('passes a non-prefix url that is a library member (an owner upload)', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/owner-shot-0822.jpg?v=1`] },
      { isLibraryMember: async (u) => u.includes('owner-shot-0822') },
    )
    expect(checks(r)).not.toContain('image-provenance')
    expect(r.blocked).toBe(false)
  })

  it('blocks a non-prefix url that is not a library member, naming both tests', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/owner-shot-0822.jpg`] },
      { isLibraryMember: notMember },
    )
    const f = r.findings.find(x => x.check === 'image-provenance')
    expect(f?.detail).toContain('library')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when the membership lookup throws', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/owner-shot-0822.jpg`] },
      { isLibraryMember: async () => { throw new Error('neon down') } },
    )
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })

  it('blocks a post with no media rather than treating it as nothing to check', async () => {
    const r = await runDeterministicPublishChecks({ caption: CLEAN, mediaUrls: [] })
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })
})

describe('stock, re-checked at publish time', () => {
  it('blocks an out-of-stock product (the 2026-08-09 deleted post)', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'gone' },
      { getAvailability: outOfStock },
    )
    expect(checks(r)).toContain('stock-out')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when stock cannot be resolved', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'unknown' },
      { getAvailability: async () => null },
    )
    expect(checks(r)).toContain('stock-unverifiable')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when the stock lookup throws, rather than publishing anyway', async () => {
    const r = await runDeterministicPublishChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'boom' },
      { getAvailability: async () => { throw new Error('shopify down') } },
    )
    expect(checks(r)).toContain('stock-unverifiable')
    expect(r.blocked).toBe(true)
  })

  it('does not invent a stock finding for a product-free education post', async () => {
    // License D posts legitimately feature no product.
    const r = await runDeterministicPublishChecks({ caption: CLEAN, mediaUrls: GOOD_MEDIA })
    expect(r.findings).toEqual([])
  })
})

describe('attempts to sell, the thing Meta actually removes', () => {
  const cases: [string, string][] = [
    ['sale-price', 'this one is $48.99 and worth every cent'],
    ['sale-discount', 'take 20% off this week only'],
    ['sale-promo-code', 'use code BLOOM15 at checkout'],
    ['sale-cta', 'shop now before it goes'],
    ['sale-pdp-link', 'grab it at xdipx.com/products/rosales'],
  ]
  for (const [check, caption] of cases) {
    it(`blocks ${check}`, async () => {
      const r = await runDeterministicPublishChecks({ caption, mediaUrls: GOOD_MEDIA })
      expect(checks(r)).toContain(check)
      expect(r.blocked).toBe(true)
    })
  }

  it('does not fire on ordinary editorial copy', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'the shape does the finding, so nobody has to go looking. link in bio if you want the full guide.',
      mediaUrls: GOOD_MEDIA,
    })
    expect(r.findings).toEqual([])
  })
})

describe('banned vocabulary', () => {
  it('blocks emoji anatomy, which is read as anatomy regardless of intent', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'a little something 🍑 for later',
      mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).toContain('emoji-anatomy')
  })

  it('blocks a lived-experience claim, which Emma can never make', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'I tried this one last week and honestly',
      mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).toContain('lived-experience')
  })

  it('leaves second-person copy alone', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'you will feel the difference in the grip, is the thing',
      mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).not.toContain('lived-experience')
  })
})

describe('repetition across the live feed', () => {
  it('blocks an eight-word run recycled from an earlier post', async () => {
    const prior = 'the nightstand drawer says a lot about a person, honestly'
    const r = await runDeterministicPublishChecks({
      caption: 'ok so the nightstand drawer says a lot about a person here',
      mediaUrls: GOOD_MEDIA,
      recentCaptions: [prior],
    })
    expect(checks(r)).toContain('repetition')
    expect(r.blocked).toBe(true)
  })

  it('tolerates short overlaps, which one brand voice cannot avoid', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'the thing most people miss about silicone grades',
      mediaUrls: GOOD_MEDIA,
      recentCaptions: ['the thing most people forget is how to store it'],
    })
    expect(checks(r)).not.toContain('repetition')
  })

  it('ignores punctuation and case when comparing', () => {
    const a = 'Not all of it is the same silicone, it turns out.'
    const b = 'not all of it is the same silicone it turns out!!'
    expect(findRepeatedRun(a, [b])).not.toBeNull()
  })

  it('returns no shingles for a caption shorter than the window', () => {
    expect(shingles('too short', REPETITION_SHINGLE).size).toBe(0)
    expect(findRepeatedRun('too short', ['too short'])).toBeNull()
  })

  it('does not collide two posts on their shared UTM tracking link', async () => {
    // Both carry the same standard utm_source/utm_medium/utm_campaign but the
    // prose is genuinely different, so neither is recycling. Before URLs were
    // stripped, the shared `?utm_...` link tokenized to an identical eight-word
    // shingle and 422-blocked both (run 438).
    const link = 'https://xdipx.com/products/wand?utm_source=x&utm_medium=social&utm_campaign=aug'
    const prior = `the quiet confidence of a wand that just knows what it is doing ${link}`
    const r = await runDeterministicPublishChecks({
      platform: 'x',
      caption: `a slow build is its own kind of luxury, and this one earns it ${link}`,
      mediaUrls: GOOD_MEDIA,
      recentCaptions: [prior],
    })
    expect(checks(r)).not.toContain('repetition')
  })

  it('strips the UTM link but still catches recycled prose around it', () => {
    // The eight-word prose run must still be caught even when both captions
    // also carry the same tracking link — stripping URLs must not blind the
    // check to real repetition.
    const link = 'https://xdipx.com/p?utm_source=x&utm_medium=social&utm_campaign=aug'
    const a = `the nightstand drawer says a lot about a person ${link}`
    const b = `honestly the nightstand drawer says a lot about a person too ${link}`
    expect(findRepeatedRun(a, [b])).not.toBeNull()
  })
})

describe('result shape', () => {
  it('reports every independent failure at once rather than stopping at the first', async () => {
    const r = await runDeterministicPublishChecks(
      {
        caption: 'I tried this, $48.99, shop now 🍑',
        mediaUrls: [`${CDN}/77292A.jpg`],
        productHandle: 'gone',
      },
      { getAvailability: outOfStock },
    )
    // One pass should tell the drafter everything that is wrong, not make it
    // rediscover the next problem on each retry.
    expect(checks(r)).toEqual([
      'emoji-anatomy', 'image-provenance', 'lived-experience',
      'sale-cta', 'sale-price', 'stock-out',
    ])
    expect(r.blocked).toBe(true)
    expect(r.held).toBe(false)
  })
})

describe('isProductSellable', () => {
  it('is sellable when any variant is, matching what the buy button asks', () => {
    expect(isProductSellable({ variants: [{ availableForSale: false }, { availableForSale: true }] })).toBe(true)
  })

  it('is not sellable when every variant is out', () => {
    expect(isProductSellable({ variants: [{ availableForSale: false }] })).toBe(false)
  })

  it('treats a product with no variants as not sellable rather than vacuously true', () => {
    expect(isProductSellable({ variants: [] })).toBe(false)
  })

  it('distinguishes gone-from-the-storefront from out-of-stock', () => {
    // An ARCHIVED or DRAFT product is dropped by the Storefront API entirely.
    // That is a different finding from "every variant is out", so it returns
    // null rather than false.
    expect(isProductSellable(null)).toBeNull()
    expect(isProductSellable(undefined)).toBeNull()
  })
})

// ── Platform divergence (X, 2026-08-16) ──────────────────────────────────────
//
// The gate serves two platforms with genuinely different rules. These are the
// cases where treating them the same would break one of them: Instagram removes
// posts that attempt to sell and has no clickable caption link, while on X the
// link is the entire point of posting. Getting this backwards either exposes
// the Instagram account or makes X unable to drive a single click.
describe('platform divergence', () => {
  const PDP_CAPTION = `a detail worth knowing https://xdipx.com/products/rosales-maya`

  it('blocks a PDP link on Instagram', async () => {
    const r = await runDeterministicPublishChecks({
      caption: PDP_CAPTION, mediaUrls: GOOD_MEDIA, platform: 'instagram',
    })
    expect(checks(r)).toContain('sale-pdp-link')
    expect(r.blocked).toBe(true)
  })

  it('defaults to Instagram when no platform is given', async () => {
    // Every caller predating X omitted this. The default must stay Instagram or
    // those callers silently lose the check.
    const r = await runDeterministicPublishChecks({
      caption: PDP_CAPTION, mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).toContain('sale-pdp-link')
  })

  it('allows a PDP link on X', async () => {
    const r = await runDeterministicPublishChecks({
      caption: PDP_CAPTION, mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).not.toContain('sale-pdp-link')
    expect(r.blocked).toBe(false)
  })

  it('still blocks the other sale forms on X', async () => {
    // Only the PDP-link rule diverges. A price or a promo code is a charter
    // violation on any platform, and relaxing one rule must not relax the rest.
    const r = await runDeterministicPublishChecks({
      caption: 'just $19.99 today, code SAVE20', mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).toContain('sale-price')
    expect(checks(r)).toContain('sale-promo-code')
    expect(r.blocked).toBe(true)
  })

  it('blocks an over-length X post, counting links at t.co width', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'x'.repeat(281), mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).toContain('caption-too-long')
    expect(r.blocked).toBe(true)
  })

  it('allows an X post that only fits once its link is weighted', async () => {
    // 250 chars of text plus a 60-char URL is over 280 raw and under it as X
    // counts. A naive length check would reject a publishable post.
    const caption = `${'x'.repeat(250)} https://xdipx.com/products/some-quite-long-handle`
    expect(caption.length).toBeGreaterThan(280)
    const r = await runDeterministicPublishChecks({
      caption, mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).not.toContain('caption-too-long')
  })

  it('does not length-check Instagram, whose ceiling is far higher', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'x'.repeat(600), mediaUrls: GOOD_MEDIA, platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-too-long')
  })

  it('requires media on X as well as Instagram', async () => {
    // Owner decision 2026-08-16: X would accept a text-only post, but every
    // draft is built around a generated asset and silently dropping it is a
    // content change nothing reviewed.
    const r = await runDeterministicPublishChecks({
      caption: 'a clean caption with nothing wrong', mediaUrls: [], platform: 'x',
    })
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })
})

// ── Removal-tier caption lexicon (ticket #4062) ──────────────────────────────
//
// The gate blocked banned emoji and nothing else lexical, while the vocabulary
// that actually gets accounts in this category REMOVED — explicit anatomy and
// graphic acts, the class that suspended @bellesaco for the word "clitoris" —
// passed straight through on Instagram. This check closes that gap, and only on
// the rented, machine-moderated surfaces: X policy permits the vocabulary and
// the owned channels are where plain anatomy belongs.
describe('removal-tier caption lexicon', () => {
  it('blocks a removal-tier word in an Instagram caption', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'the anatomy nobody explains: your clitoris has more nerve endings than you think',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('lets the identical caption through on X, whose policy permits it', async () => {
    // DONE WHEN #2: the same text that blocks on Instagram must pass untouched
    // on X. Blocking it there gags the account for no safety gain.
    const r = await runDeterministicPublishChecks({
      caption: 'the anatomy nobody explains: your clitoris has more nerve endings than you think',
      mediaUrls: GOOD_MEDIA,
      platform: 'x',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
    expect(r.blocked).toBe(false)
  })

  it('scans on-image text, not only the caption', async () => {
    const r = await runDeterministicPublishChecks({
      caption: CLEAN,
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
      onImageText: 'HOW TO FIND YOUR G-SPOT AND MAKE HER SQUIRT',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('scans alt text, not only the caption', async () => {
    const r = await runDeterministicPublishChecks({
      caption: CLEAN,
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
      altText: 'a wand held against a vulva',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('does not fire on clinical mechanism copy, the rewrite target', async () => {
    // "arousal", "stimulation", "pleasure", "climax" sit in the RESTRICTED
    // (age-gate) tier, not removal, and are exactly what a blocked drafter should
    // rewrite toward. Blocking them would make the check unusable.
    const r = await runDeterministicPublishChecks({
      caption: 'external stimulation, blood flow, and pleasure are the whole mechanism here. arousal builds toward a climax.',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
  })

  it('respects word boundaries, so ordinary words never trip it', async () => {
    // "document" contains "cum", "peacock" contains "cock", "analysis" contains
    // "anal". None is the flagged word, and \b keeps them clear.
    const r = await runDeterministicPublishChecks({
      caption: 'a document, a peacock, and an honest analysis of what the shape does',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
  })
})

// Owner direction 2026-08-22: the accessibility description of the image was
// getting written INTO the caption because social_posts had no alt_text
// column and the Instagram publisher never sent one. This check catches the
// symptom directly rather than only the missing column.
describe('caption describes its own image', () => {
  it('blocks the real row-80 sentence', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'that is jade in the photo, sleeves pushed up at a sunny bathroom sink',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-describes-image')
    expect(r.blocked).toBe(true)
    const finding = r.findings.find(f => f.check === 'caption-describes-image')
    expect(finding?.severity).toBe('block')
    expect(finding?.detail).toMatch(/altText/)
  })

  it('does not fire on a clean caption', async () => {
    const r = await runDeterministicPublishChecks({
      caption: CLEAN,
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-describes-image')
  })

  it('catches "pictured" and "so you can see how" variants', async () => {
    const r1 = await runDeterministicPublishChecks({
      caption: 'the grip texture, pictured up close, is the whole point',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r1)).toContain('caption-describes-image')

    const r2 = await runDeterministicPublishChecks({
      caption: 'so you can see how the seam sits flush against the base',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r2)).toContain('caption-describes-image')
  })

  it('fires on X too, not only Instagram', async () => {
    const r = await runDeterministicPublishChecks({
      caption: 'that is jade in the photo, sleeves pushed up',
      mediaUrls: GOOD_MEDIA,
      platform: 'x',
    })
    expect(checks(r)).toContain('caption-describes-image')
  })
})
