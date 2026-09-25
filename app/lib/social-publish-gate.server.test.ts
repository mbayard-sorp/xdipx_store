// Deterministic pre-publish checks (ticket #2739).
//
// These run in place of the owner's approval click, so the cases below are the
// ones that actually happened or that the charter names, not invented ones: the
// packshots on the current pending drafts, the out-of-stock product that had to
// be deleted from the feed on 2026-08-09, and the sale-attempt forms Meta's
// Restricted Goods standard removes.
import { describe, it, expect } from 'vitest'
import {
  runDeterministicPublishChecks as runChecksRaw,
  findRepeatedRun,
  shingles,
  REPETITION_SHINGLE,
  isProductSellable,
  classifyLegibleText,
  missingVisionChecks,
} from './social-publish-gate.server'
import { VISION_CHECK_NAMES, type VisionVerdict } from './social-vision-gate.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'
const GOOD_MEDIA = [`${CDN}/social-rosales-cast-maya-20260812-1.jpg`]
const inStock = async () => true
const outOfStock = async () => false
const notMember = async () => false
/** Stub for tests unrelated to the pairing rule (#6745): no dial resolved, so it never fires. */
const noPairingDial = async () => null

/** Passing vision-gate verdict for tests unrelated to that check (#6763). */
const PASSING_VERDICT: VisionVerdict = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'test fixture: clean',
  checkedAt: '2026-08-31T00:00:00.000Z',
  checkCompleted: true,
  legibleText: '',
}

/**
 * Wraps `runDeterministicPublishChecks` with a passing vision-gate verdict by
 * default, so the call sites below that predate the vision-gate check
 * (ticket #6763) keep testing exactly what they always tested instead of
 * making a real database round trip through the unmocked default lookup.
 * The `describe('vision-gate verdict', ...)` block overrides `getVisionVerdict`
 * directly to exercise the check itself.
 *
 * `postCreatedAt` became required on the real input in ticket #10476, and is
 * deliberately NOT required here: these cases predate it, none of them is
 * about the age carve-out, and threading a date through all of them would say
 * something none of them means. The default is `null`, the honest "this test
 * has no row", and the carve-out tests below call `runChecksRaw` directly.
 */
function runChecks(
  input: Omit<Parameters<typeof runChecksRaw>[0], 'postCreatedAt'> & { postCreatedAt?: string | Date | null },
  deps?: Parameters<typeof runChecksRaw>[1],
): ReturnType<typeof runChecksRaw> {
  return runChecksRaw(
    { ...input, postCreatedAt: input.postCreatedAt ?? null },
    {
      getVisionVerdict: async () => PASSING_VERDICT,
      // ADR-015 / ticket #10730: default every call site that predates the
      // cast-target gate to 'universal' (always passes, no cast required),
      // the same way getProductTypeDial defaults every call site that
      // predates the pairing rule to "no dial resolved". The dedicated
      // describe block below overrides these directly.
      getCastTarget: async () => 'universal',
      getCastPresentations: async () => new Map(),
      ...(deps ?? {}),
    },
  )
}

/** A caption with nothing wrong with it. */
const CLEAN = 'ok, a detail about silicone nobody mentions: not all of it is the same grade.'

function checks(r: { findings: { check: string }[] }): string[] {
  return r.findings.map(f => f.check).sort()
}

describe('a clean post', () => {
  it('passes with no findings', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'rosales' },
      { getAvailability: inStock, getProductTypeDial: noPairingDial },
    )
    expect(r.findings).toEqual([])
    expect(r.blocked).toBe(false)
    expect(r.held).toBe(false)
  })
})

describe('imagery provenance', () => {
  it('blocks a bare Nalpac packshot, which is what the pending drafts carry', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/77292A.jpg?v=1775408527`] },
      { isLibraryMember: notMember },
    )
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })

  it('blocks a carousel where only one slide is a packshot', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: [...GOOD_MEDIA, `${CDN}/96177A.jpg`] },
      { isLibraryMember: notMember },
    )
    expect(r.blocked).toBe(true)
  })

  // Library membership burn-in (#4937): prefix OR membership passes.
  it('passes a prefix-named url without consulting the library', async () => {
    let asked = 0
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: null },
      { isLibraryMember: async () => { asked++; return false } },
    )
    expect(checks(r)).not.toContain('image-provenance')
    expect(asked).toBe(0)
  })

  it('passes a non-prefix url that is a library member (an owner upload)', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/owner-shot-0822.jpg?v=1`] },
      { isLibraryMember: async (u) => u.includes('owner-shot-0822') },
    )
    expect(checks(r)).not.toContain('image-provenance')
    expect(r.blocked).toBe(false)
  })

  it('blocks a non-prefix url that is not a library member, naming both tests', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/owner-shot-0822.jpg`] },
      { isLibraryMember: notMember },
    )
    const f = r.findings.find(x => x.check === 'image-provenance')
    expect(f?.detail).toContain('library')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when the membership lookup throws', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: [`${CDN}/owner-shot-0822.jpg`] },
      { isLibraryMember: async () => { throw new Error('neon down') } },
    )
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })

  it('blocks a post with no media rather than treating it as nothing to check', async () => {
    const r = await runChecks({ caption: CLEAN, mediaUrls: [] })
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })
})

describe('stock, re-checked at publish time', () => {
  it('blocks an out-of-stock product (the 2026-08-09 deleted post)', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'gone' },
      { getAvailability: outOfStock, getProductTypeDial: noPairingDial },
    )
    expect(checks(r)).toContain('stock-out')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when stock cannot be resolved', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'unknown' },
      { getAvailability: async () => null, getProductTypeDial: noPairingDial },
    )
    expect(checks(r)).toContain('stock-unverifiable')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when the stock lookup throws, rather than publishing anyway', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'boom' },
      { getAvailability: async () => { throw new Error('shopify down') }, getProductTypeDial: noPairingDial },
    )
    expect(checks(r)).toContain('stock-unverifiable')
    expect(r.blocked).toBe(true)
  })

  it('does not invent a stock finding for a product-free education post', async () => {
    // License D posts legitimately feature no product.
    const r = await runChecks({ caption: CLEAN, mediaUrls: GOOD_MEDIA })
    expect(r.findings).toEqual([])
  })
})

// Ticket #6745: the pairing-presence self-check in routine-social-daily.md
// ("a toy never travels alone") was instruction-only for three weeks and
// never moved the miss rate, because nothing verified it before a draft
// could reach the unattended hourly publish tick.
describe('pairing rule: a toy never travels alone (crossplatform strategy §3, ticket #6745)', () => {
  const vibratorDial = async () => 'vibrator'
  const wearDial = async () => 'wear'

  it('blocks a toy-featuring draft that names no lube and records no reason', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'le-wand-powerful-petite' },
      { getAvailability: inStock, getProductTypeDial: vibratorDial },
    )
    expect(checks(r)).toContain('pairing-missing')
    expect(r.blocked).toBe(true)
  })

  it('passes when the caption names a compatible lube', async () => {
    const r = await runChecks(
      {
        caption: 'this pairs beautifully with a water-based lube for effortless glide.',
        mediaUrls: GOOD_MEDIA,
        productHandle: 'le-wand-powerful-petite',
      },
      { getAvailability: inStock, getProductTypeDial: vibratorDial },
    )
    expect(checks(r)).not.toContain('pairing-missing')
    expect(r.blocked).toBe(false)
  })

  it('passes when the draft records an explicit reason none applies', async () => {
    const r = await runChecks(
      {
        caption: CLEAN,
        mediaUrls: GOOD_MEDIA,
        productHandle: 'le-wand-powerful-petite',
        pairingNoneReason: 'external-only feature post, no penetrative use implied here',
      },
      { getAvailability: inStock, getProductTypeDial: vibratorDial },
    )
    expect(checks(r)).not.toContain('pairing-missing')
  })

  it('does not fire for a non-toy product type dial (e.g. wear)', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'some-wear-item' },
      { getAvailability: inStock, getProductTypeDial: wearDial },
    )
    expect(checks(r)).not.toContain('pairing-missing')
  })

  it('does not fire when the type dial cannot be resolved (fails open, not closed)', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'unresolvable' },
      { getAvailability: inStock, getProductTypeDial: async () => { throw new Error('shopify down') } },
    )
    expect(checks(r)).not.toContain('pairing-missing')
  })
})

describe('cast/product casting gate (ADR-015, ticket #10730)', () => {
  const femaleTarget = async () => 'female'
  const maleTarget = async () => 'male'
  const marcusMasculine = async () => new Map([['marcus', 'masculine' as const]])
  const mayaFeminine = async () => new Map([['marcus', 'masculine' as const], ['maya', 'feminine' as const]])

  it('always passes a universal-classified product regardless of cast', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'jo-h2o-lube', castSlugs: ['marcus'] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: async () => 'universal', getCastPresentations: marcusMasculine },
    )
    expect(checks(r)).not.toContain('cast-target-mismatch')
    expect(r.blocked).toBe(false)
  })

  it('DONE WHEN: blocks a male-presenting solo cast member with a female-classified product', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'le-wand-powerful-petite', castSlugs: ['marcus'] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: femaleTarget, getCastPresentations: marcusMasculine },
    )
    expect(checks(r)).toContain('cast-target-mismatch')
    expect(r.blocked).toBe(true)
  })

  it('DONE WHEN: passes the same product in an other-held two-cast frame with a matching member', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'le-wand-powerful-petite', castSlugs: ['marcus', 'maya'] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: femaleTarget, getCastPresentations: mayaFeminine },
    )
    expect(checks(r)).not.toContain('cast-target-mismatch')
    expect(r.blocked).toBe(false)
  })

  it('passes a solo cast member whose presentation matches', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'stroker-x', castSlugs: ['marcus'] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: maleTarget, getCastPresentations: marcusMasculine },
    )
    expect(checks(r)).not.toContain('cast-target-mismatch')
  })

  it('fails closed when the product carries no cast_target classification', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'unclassified-product', castSlugs: ['marcus'] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: async () => null, getCastPresentations: marcusMasculine },
    )
    expect(checks(r)).toContain('cast-target-mismatch')
    expect(r.blocked).toBe(true)
  })

  it('fails closed when a non-universal product names no cast at all', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, productHandle: 'le-wand-powerful-petite', castSlugs: [] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: femaleTarget, getCastPresentations: async () => new Map() },
    )
    expect(checks(r)).toContain('cast-target-mismatch')
  })

  it('does not fire for a product-free post (no productHandle)', async () => {
    const r = await runChecks(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, castSlugs: ['marcus'] },
      { getAvailability: inStock, getProductTypeDial: noPairingDial, getCastTarget: femaleTarget, getCastPresentations: marcusMasculine },
    )
    expect(checks(r)).not.toContain('cast-target-mismatch')
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
      const r = await runChecks({ caption, mediaUrls: GOOD_MEDIA })
      expect(checks(r)).toContain(check)
      expect(r.blocked).toBe(true)
    })
  }

  it('does not fire on ordinary editorial copy', async () => {
    const r = await runChecks({
      caption: 'the shape does the finding, so nobody has to go looking. link in bio if you want the full guide.',
      mediaUrls: GOOD_MEDIA,
    })
    expect(r.findings).toEqual([])
  })
})

describe('banned vocabulary', () => {
  it('blocks emoji anatomy, which is read as anatomy regardless of intent', async () => {
    const r = await runChecks({
      caption: 'a little something 🍑 for later',
      mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).toContain('emoji-anatomy')
  })

  it('blocks a lived-experience claim, which Emma can never make', async () => {
    const r = await runChecks({
      caption: 'I tried this one last week and honestly',
      mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).toContain('lived-experience')
  })

  it('leaves second-person copy alone', async () => {
    const r = await runChecks({
      caption: 'you will feel the difference in the grip, is the thing',
      mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).not.toContain('lived-experience')
  })
})

describe('repetition across the live feed', () => {
  it('blocks an eight-word run recycled from an earlier post', async () => {
    const prior = 'the nightstand drawer says a lot about a person, honestly'
    const r = await runChecks({
      caption: 'ok so the nightstand drawer says a lot about a person here',
      mediaUrls: GOOD_MEDIA,
      recentCaptions: [prior],
    })
    expect(checks(r)).toContain('repetition')
    expect(r.blocked).toBe(true)
  })

  it('tolerates short overlaps, which one brand voice cannot avoid', async () => {
    const r = await runChecks({
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
    const r = await runChecks({
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
    const r = await runChecks(
      {
        caption: 'I tried this, $48.99, shop now 🍑',
        mediaUrls: [`${CDN}/77292A.jpg`],
        productHandle: 'gone',
      },
      { getAvailability: outOfStock, getProductTypeDial: noPairingDial },
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

// ── Platform divergence (X, 2026-08-16; extended ticket #9405) ───────────────
//
// The gate serves two platforms with genuinely different rules. These are the
// cases where treating them the same would break one of them: Instagram removes
// posts that attempt to sell and has no clickable caption link, while on X the
// link is the entire point of posting and a code/depth/link promo is the
// platform-permitted shape (ads-policy.md, routine-social-daily.md Step 2 item
// 5). Getting this backwards either exposes the Instagram account or makes X
// unable to drive a single click or cover an active promo.
describe('platform divergence', () => {
  const PDP_CAPTION = `a detail worth knowing https://xdipx.com/products/rosales-maya`

  it('blocks a PDP link on Instagram', async () => {
    const r = await runChecks({
      caption: PDP_CAPTION, mediaUrls: GOOD_MEDIA, platform: 'instagram',
    })
    expect(checks(r)).toContain('sale-pdp-link')
    expect(r.blocked).toBe(true)
  })

  it('defaults to Instagram when no platform is given', async () => {
    // Every caller predating X omitted this. The default must stay Instagram or
    // those callers silently lose the check.
    const r = await runChecks({
      caption: PDP_CAPTION, mediaUrls: GOOD_MEDIA,
    })
    expect(checks(r)).toContain('sale-pdp-link')
  })

  it('allows a PDP link on X', async () => {
    const r = await runChecks({
      caption: PDP_CAPTION, mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).not.toContain('sale-pdp-link')
    expect(r.blocked).toBe(false)
  })

  it('still blocks a price on X', async () => {
    // sale-price is not platform-scoped; only sale-pdp-link, sale-discount, and
    // sale-promo-code diverge (ticket #9405), and relaxing those must not
    // relax this one.
    const r = await runChecks({
      caption: 'just $19.99 today', mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).toContain('sale-price')
    expect(r.blocked).toBe(true)
  })

  it('blocks a discount and a promo code on Instagram', async () => {
    const r = await runChecks({
      caption: 'take 20% off with code SAVE20', mediaUrls: GOOD_MEDIA, platform: 'instagram',
    })
    expect(checks(r)).toContain('sale-discount')
    expect(checks(r)).toContain('sale-promo-code')
    expect(r.blocked).toBe(true)
  })

  it('allows a discount and a promo code on X (ticket #9405)', async () => {
    // The LUBE20 promo window produced zero code-carrying X posts because
    // these two checks fired on X despite X being the platform ads-policy.md
    // and the daily social routine say permits code/depth/link promo language.
    const r = await runChecks({
      caption: 'take 20% off with code LUBE20', mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).not.toContain('sale-discount')
    expect(checks(r)).not.toContain('sale-promo-code')
    expect(r.blocked).toBe(false)
  })

  it('blocks an over-length X post, counting links at t.co width', async () => {
    const r = await runChecks({
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
    const r = await runChecks({
      caption, mediaUrls: GOOD_MEDIA, platform: 'x',
    })
    expect(checks(r)).not.toContain('caption-too-long')
  })

  it('does not length-check Instagram, whose ceiling is far higher', async () => {
    const r = await runChecks({
      caption: 'x'.repeat(600), mediaUrls: GOOD_MEDIA, platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-too-long')
  })

  it('requires media on X as well as Instagram', async () => {
    // Owner decision 2026-08-16: X would accept a text-only post, but every
    // draft is built around a generated asset and silently dropping it is a
    // content change nothing reviewed.
    const r = await runChecks({
      caption: 'a clean caption with nothing wrong', mediaUrls: [], platform: 'x',
    })
    expect(checks(r)).toContain('image-provenance')
    expect(r.blocked).toBe(true)
  })
})

// ── Removal-tier caption lexicon (ticket #4062, narrowed by ticket #5482) ────
//
// The gate blocked banned emoji and nothing else lexical, while the vocabulary
// that actually gets accounts in this category REMOVED, crude slang and
// graphic acts, passed straight through on Instagram. This check closes that
// gap, and only on the rented, machine-moderated surfaces: X policy permits
// the vocabulary and the owned channels are where plain anatomy belongs.
//
// ticket #5482 narrowed this further: clinical anatomy nouns ("clitoris",
// "vulva", "vagina", "labia", "penis", "anus") are no longer blocking. They
// were anchored to the @bellesaco suspension, but the charter
// (docs/emma-voice.md, Instagram section, owner correction 2026-08-22
// evening) says plainly that removal was never a word ban: these are ordinary
// nouns in a fact or mechanism sentence. Crude slang, act-naming, arousal
// states, and the owner-held borderline-acts tier are unaffected and still
// block.
describe('removal-tier caption lexicon', () => {
  it('blocks a crude-slang word in an Instagram caption (tier: crude-slang)', async () => {
    const r = await runChecks({
      caption: 'stop overthinking it and just go grab the pussy pump already',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('lets the identical crude-slang caption through on X, whose policy permits it', async () => {
    // DONE WHEN #2: the same text that blocks on Instagram must pass untouched
    // on X. Blocking it there gags the account for no safety gain. The lexicon
    // does not run on X at all (CAPTION_LEXICON_PLATFORMS is instagram-only).
    const r = await runChecks({
      caption: 'stop overthinking it and just go grab the pussy pump already',
      mediaUrls: GOOD_MEDIA,
      platform: 'x',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
    expect(r.blocked).toBe(false)
  })

  it('scans on-image text, not only the caption', async () => {
    const r = await runChecks({
      caption: CLEAN,
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
      onImageText: 'HOW TO FIND YOUR G-SPOT AND MAKE HER SQUIRT',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('scans alt text, not only the caption', async () => {
    const r = await runChecks({
      caption: CLEAN,
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
      altText: 'a wand held against her pussy',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('does not fire on clinical mechanism copy, the rewrite target', async () => {
    // "arousal", "stimulation", "pleasure", "climax" sit in the RESTRICTED
    // (age-gate) tier, not removal, and are exactly what a blocked drafter should
    // rewrite toward. Blocking them would make the check unusable.
    const r = await runChecks({
      caption: 'external stimulation, blood flow, and pleasure are the whole mechanism here. arousal builds toward a climax.',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
  })

  it('respects word boundaries, so ordinary words never trip it', async () => {
    // "document" contains "cum", "peacock" contains "cock", "analysis" contains
    // "anal". None is the flagged word, and \b keeps them clear.
    const r = await runChecks({
      caption: 'a document, a peacock, and an honest analysis of what the shape does',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
  })
})

// ── Clinical-anatomy narrowing (ticket #5482, owner-approved 2026-08-25) ─────
//
// docs/emma-voice.md (Instagram section, owner correction 2026-08-22 evening,
// lines 310-323): "'Orgasm', 'the orgasm gap', 'clitoris', 'vulva', 'erection'
// are ordinary nouns in a sentence that states a fact or explains how a
// product works... 'air pulsation seals over the clitoris and pulses' is a
// mechanism." The gate must not refuse the charter's own worked example.
describe('clinical anatomy is no longer removal-tier (ticket #5482)', () => {
  it('passes the charter\'s own mechanism example verbatim (docs/emma-voice.md line 316)', async () => {
    const r = await runChecks({
      caption: 'air pulsation seals over the clitoris and pulses',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
    expect(r.blocked).toBe(false)
  })

  it('passes the real caption fragment from social_posts row 107, the live incident', async () => {
    // 2026-08-25: the owner clicked Post now on row 107 and the gate refused
    // this exact mechanism sentence. Textbook fact framing, not act narration.
    const r = await runChecks({
      caption: 'the vibrating part rests against the clitoris during sex, so both of you feel it',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
    expect(r.blocked).toBe(false)
  })

  it('tier 1 (clinical-anatomy) passes: "vagina" no longer blocks', async () => {
    const r = await runChecks({
      caption: 'the toy is designed to rest just inside the vagina during use',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
    expect(r.blocked).toBe(false)
  })

  it('tier 2 (crude-slang) still blocks: "dick"', async () => {
    const r = await runChecks({
      caption: 'this one is built for a dick of pretty much any size',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('tier 3 (act-naming) still blocks: "blowjob"', async () => {
    const r = await runChecks({
      caption: 'the sleeve is textured to mimic a blowjob',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('tier 4 (arousal-states) still blocks: "throbbing"', async () => {
    const r = await runChecks({
      caption: 'the pulses build until everything feels throbbing',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('tier 5 (borderline-acts) still blocks: "masturbation", owner direction 2026-08-25', async () => {
    const r = await runChecks({
      caption: 'this is a straightforward masturbation aid, nothing fancier than that',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('a tier-1 term does not launder a tier-2 term in the same caption', async () => {
    // Mixing an allowed clinical noun with a still-banned crude term must still
    // block on the crude term. The presence of the allowed word is not a pass.
    const r = await runChecks({
      caption: 'it rests against the clitoris, but honestly just call it what it is, a pussy toy',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).toContain('caption-lexicon')
    expect(r.blocked).toBe(true)
  })

  it('X is unaffected either way: the lexicon never runs there', async () => {
    const r = await runChecks({
      caption: 'the vibrating part rests against the clitoris during sex, so both of you feel it',
      mediaUrls: GOOD_MEDIA,
      platform: 'x',
    })
    expect(checks(r)).not.toContain('caption-lexicon')
    expect(r.blocked).toBe(false)
  })
})

// Owner direction 2026-08-22: the accessibility description of the image was
// getting written INTO the caption because social_posts had no alt_text
// column and the Instagram publisher never sent one. This check catches the
// symptom directly rather than only the missing column.
describe('caption describes its own image', () => {
  it('blocks the real row-80 sentence', async () => {
    const r = await runChecks({
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
    const r = await runChecks({
      caption: CLEAN,
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r)).not.toContain('caption-describes-image')
  })

  it('catches "pictured" and "so you can see how" variants', async () => {
    const r1 = await runChecks({
      caption: 'the grip texture, pictured up close, is the whole point',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r1)).toContain('caption-describes-image')

    const r2 = await runChecks({
      caption: 'so you can see how the seam sits flush against the base',
      mediaUrls: GOOD_MEDIA,
      platform: 'instagram',
    })
    expect(checks(r2)).toContain('caption-describes-image')
  })

  it('fires on X too, not only Instagram', async () => {
    const r = await runChecks({
      caption: 'that is jade in the photo, sleeves pushed up',
      mediaUrls: GOOD_MEDIA,
      platform: 'x',
    })
    expect(checks(r)).toContain('caption-describes-image')
  })
})

// ── Vision-gate verdict (ticket #6763) ───────────────────────────────────────
//
// This module is text-only (see the file header); it never opens the image
// itself. These cases exercise the block that consults the verdict recorded
// by the generation-time vision gate (app/lib/social-vision-gate.server.ts).
describe('vision-gate verdict', () => {
  const NON_PREFIX_MEDIA = [`${CDN}/owner-shot-0822.jpg?v=1`]
  // These cases test the vision-verdict check in isolation, so membership
  // always passes; the "not a library member" case is already covered under
  // 'imagery provenance' above.
  const isLibraryMember = async () => true

  it('passes media carrying a recorded passing verdict', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => PASSING_VERDICT, isLibraryMember },
    )
    expect(checks(r)).not.toContain('vision-verdict')
    expect(r.blocked).toBe(false)
  })

  it('blocks media carrying a recorded failing verdict', async () => {
    const failing: VisionVerdict = {
      pass: false,
      checks: {
        limbCount: 'fail',
        handAnatomy: 'fail',
        faceBodyIntegrity: 'pass',
        extraOrMergedLimbs: 'fail',
        nippleOccluded: 'pass',
        genitaliaAbsent: 'pass',
        anusNotVisible: 'pass',
        adultUnambiguous: 'pass',
      },
      notes: 'three arms visible on the cast member',
      checkedAt: '2026-08-30T00:00:00.000Z',
      checkCompleted: true,
      legibleText: '',
    }
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => failing, isLibraryMember },
    )
    expect(checks(r)).toContain('vision-verdict')
    expect(r.blocked).toBe(true)
    const finding = r.findings.find(f => f.check === 'vision-verdict')
    expect(finding?.detail).toContain('three arms')
  })

  it('blocks a non-prefix asset with no recorded verdict at all, not a silent skip', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => null, isLibraryMember },
    )
    expect(checks(r)).toContain('vision-verdict')
    expect(r.blocked).toBe(true)
    const finding = r.findings.find(f => f.check === 'vision-verdict')
    expect(finding?.detail).toContain('no recorded vision-gate verdict')
  })

  it('exempts a legacy prefix-named asset with no recorded verdict (predates the check)', async () => {
    // GOOD_MEDIA carries the `social-` prefix. Every NEW asset from
    // generateAndUploadSocialImage/generateCastComposite writes its verdict
    // synchronously at generation time, so a prefix-named url with no verdict
    // on file is legacy art from before this check existed, the same carve-out
    // the image-provenance burn-in already grants prefix-named urls above.
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => new Date('2026-08-12T00:00:00.000Z') },
    )
    expect(checks(r)).not.toContain('vision-verdict')
    expect(r.blocked).toBe(false)
  })

  // Ticket #10337. `recordVisionVerdict` swallows its database errors and
  // `tryIngestSocialAsset` can return null, so a prefix-named filename with no
  // verdict is not proof of age: it is equally the signature of a write that
  // failed on an image nothing ever looked at.
  it('blocks a prefix-named asset with no verdict whose library row postdates the cutoff', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => new Date('2026-09-15T00:00:00.000Z') },
    )
    expect(checks(r)).toContain('vision-verdict')
    expect(r.blocked).toBe(true)
    const finding = r.findings.find(f => f.check === 'vision-verdict')
    expect(finding?.detail).toContain(GOOD_MEDIA[0])
    expect(finding?.detail).toContain('no recorded vision-gate verdict')
  })

  it('falls back to the post created_at when the asset has no library row at all', async () => {
    const blockedResult = await runChecksRaw(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: '2026-09-19T00:00:00.000Z' },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => null },
    )
    expect(blockedResult.blocked).toBe(true)

    const legacy = await runChecksRaw(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: '2026-08-20T00:00:00.000Z' },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => null },
    )
    expect(checks(legacy)).not.toContain('vision-verdict')
    expect(legacy.blocked).toBe(false)
  })

  // Ticket #10476. This used to be "keeps the legacy skip when the age cannot
  // be determined at all", and that was the hole. These checks only run on a
  // row about to publish and a social_posts row always has a created_at, so
  // "no date" never meant "old art"; it meant nobody passed one, or the
  // lookup fell over. Either way nothing looked at the pixels.
  it('blocks when the age cannot be determined at all (unchecked, not legacy)', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => { throw new Error('neon down') } },
    )
    expect(checks(r)).toContain('vision-verdict')
    expect(r.blocked).toBe(true)
    const detail = r.findings.find(f => f.check === 'vision-verdict')?.detail ?? ''
    expect(detail).toContain('no date to age it by')
    expect(detail).toContain('Unchecked, not legacy')
  })

  it('blocks a prefix-named asset with no verdict and no date supplied', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => null },
    )
    expect(r.blocked).toBe(true)
    expect(r.findings.find(f => f.check === 'vision-verdict')?.detail).toContain('Unchecked, not legacy')
  })

  // The live exposure ticket #10476 names. `isGeneratedSocialAsset` returns
  // true for a video final (`video/<jobId>/final*.mp4`), but video finals live
  // in `video_assets`, never `social_media_assets`, and `runVisionGate` is
  // never called anywhere in the video pipeline. So a reel arrives with no
  // verdict and no library row. On the owner's Post now path, which did not
  // thread `postCreatedAt`, that used to fall into the bare continue and
  // publish an on-skin reel with zero pixel inspection.
  it('blocks a video final with no verdict and no library row (the Post now path)', async () => {
    const VIDEO_FINAL = ['https://blob.vercel-storage.com/video/job-8812/final-a7f3.mp4']
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: VIDEO_FINAL, postCreatedAt: null },
      { getVisionVerdict: async () => null, getAssetCreatedAt: async () => null },
    )
    expect(checks(r)).toContain('vision-verdict')
    expect(r.blocked).toBe(true)
    const detail = r.findings.find(f => f.check === 'vision-verdict')?.detail ?? ''
    expect(detail).toContain(VIDEO_FINAL[0])
    expect(detail).toContain('Unchecked, not legacy')
  })

  // Ticket #10476 part 4: the poster frame is a second blob, not in
  // mediaUrls, and it is the image the Instagram grid renders. Nothing walked
  // it before.
  describe('poster frame', () => {
    const VIDEO_FINAL = ['https://blob.vercel-storage.com/video/job-8812/final-a7f3.mp4']
    const POSTER = 'https://blob.vercel-storage.com/video/job-8812/poster.jpg'

    it('blocks when the poster has no verdict even though the video final does', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: VIDEO_FINAL, posterUrl: POSTER, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        {
          getVisionVerdict: async (url: string) => (url === POSTER ? null : PASSING_VERDICT),
          getAssetCreatedAt: async () => null,
          isLibraryMember,
        },
      )
      expect(checks(r)).toContain('vision-verdict')
      expect(r.blocked).toBe(true)
      expect(r.findings.find(f => f.check === 'vision-verdict')?.detail).toContain(POSTER)
    })

    it('blocks when the poster carries a failing verdict', async () => {
      const failing: VisionVerdict = { ...PASSING_VERDICT, pass: false, notes: 'anus visible at the base of the cleft' }
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: VIDEO_FINAL, posterUrl: POSTER, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        {
          getVisionVerdict: async (url: string) => (url === POSTER ? failing : PASSING_VERDICT),
          isLibraryMember,
        },
      )
      expect(r.blocked).toBe(true)
      expect(r.findings.find(f => f.check === 'vision-verdict')?.detail).toContain('anus visible')
    })

    it('passes when both the final and the poster carry passing verdicts', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: VIDEO_FINAL, posterUrl: POSTER, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        { getVisionVerdict: async () => PASSING_VERDICT, isLibraryMember },
      )
      expect(checks(r)).not.toContain('vision-verdict')
      expect(r.blocked).toBe(false)
    })

    it('is a no-op on a still post, which has no poster', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: GOOD_MEDIA, posterUrl: null, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        { getVisionVerdict: async () => PASSING_VERDICT, isLibraryMember },
      )
      expect(r.blocked).toBe(false)
    })
  })

  it('fails closed when the verdict lookup throws', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => { throw new Error('neon down') }, isLibraryMember },
    )
    expect(checks(r)).toContain('vision-verdict')
    expect(r.blocked).toBe(true)
  })

  // Ticket #10477 follow-up, the residual QA caught. getVisionVerdictByUrl
  // returns the stored jsonb with no shape validation and this gate used to
  // read only `pass`, so a verdict written when the gate asked seven
  // questions kept reading as a full pass after the eighth was added. The
  // fix is the same move as making postCreatedAt required: do not let an
  // unanswered question default to the safe-looking branch.
  describe('a verdict that answers fewer checks than the gate now has', () => {
    const sevenCheckVerdict = (): VisionVerdict => {
      const { anusNotVisible: _anusNotVisible, ...checks } = PASSING_VERDICT.checks!
      return { ...PASSING_VERDICT, checks: checks as VisionVerdict['checks'] }
    }

    it('blocks a stored pass:true verdict that predates anusNotVisible', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        { getVisionVerdict: async () => sevenCheckVerdict(), isLibraryMember },
      )
      expect(checks(r)).toContain('vision-verdict')
      expect(r.blocked).toBe(true)
    })

    it('names the unanswered checks, so the reason is legible', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        { getVisionVerdict: async () => sevenCheckVerdict(), isLibraryMember },
      )
      const detail = r.findings.find(f => f.check === 'vision-verdict')?.detail ?? ''
      expect(detail).toContain('anusNotVisible')
      expect(detail).toContain('does not answer every check')
    })

    it('counts a key present with an unreadable value as unanswered', async () => {
      const garbled = {
        ...PASSING_VERDICT,
        checks: { ...PASSING_VERDICT.checks, anusNotVisible: 'maybe' },
      } as unknown as VisionVerdict
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        { getVisionVerdict: async () => garbled, isLibraryMember },
      )
      expect(r.blocked).toBe(true)
      expect(r.findings.find(f => f.check === 'vision-verdict')?.detail).toContain('anusNotVisible')
    })

    // The legacy carve-out exists for art with NO verdict, on the premise
    // that the check did not exist when the art was made. A verdict that
    // exists disproves that premise, so an old date does not buy a partial
    // read a pass.
    it('does not let the legacy carve-out excuse a partial verdict on an old prefix-named asset', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: '2026-08-01T00:00:00.000Z' },
        {
          getVisionVerdict: async () => sevenCheckVerdict(),
          getAssetCreatedAt: async () => new Date('2026-08-01T00:00:00.000Z'),
        },
      )
      expect(checks(r)).toContain('vision-verdict')
      expect(r.blocked).toBe(true)
    })

    it('self-heals: a complete verdict passes, and completeness is read off VISION_CHECK_NAMES', async () => {
      const r = await runChecksRaw(
        { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: '2026-09-19T00:00:00.000Z' },
        { getVisionVerdict: async () => PASSING_VERDICT, isLibraryMember },
      )
      expect(checks(r)).not.toContain('vision-verdict')
      expect(r.blocked).toBe(false)
      // Every name the gate knows about is what completeness is measured
      // against, so a check added later is covered with no edit here.
      expect(missingVisionChecks(PASSING_VERDICT)).toEqual([])
      expect(VISION_CHECK_NAMES.every(n => n in PASSING_VERDICT.checks!)).toBe(true)
    })
  })

  // #10281 named seven; #10477 added anusNotVisible, so the message the
  // drafter reads has to name eight or it re-briefs the wrong thing.
  it('names the eight checks accurately in the no-verdict finding (#10281, #10477)', async () => {
    const r = await runChecksRaw(
      { caption: CLEAN, mediaUrls: NON_PREFIX_MEDIA, postCreatedAt: null },
      { getVisionVerdict: async () => null, isLibraryMember },
    )
    const detail = r.findings.find(f => f.check === 'vision-verdict')?.detail ?? ''
    expect(detail).toContain('eight')
    expect(detail).not.toContain('all seven')
    expect(detail).toContain('genitalia absent')
    expect(detail).toContain('no anus visible')
    expect(detail).toContain('nipples occluded')
    expect(detail).toContain('adult')
  })
})

// Ticket #10338: the vision gate transcribes legible text and leaves the
// policy call to its caller. This is that caller, applying the three cases in
// docs/design-doctrine.md section 4 item 4.
describe('legible text baked into the image', () => {
  const isLibraryMember = async () => true
  const withText = (legibleText: string | null): VisionVerdict => ({ ...PASSING_VERDICT, legibleText })
  const run = (legibleText: string | null) => runChecksRaw(
    { caption: CLEAN, mediaUrls: GOOD_MEDIA, postCreatedAt: null },
    { getVisionVerdict: async () => withText(legibleText), isLibraryMember },
  )

  it('passes a brand mark on a product we stock', async () => {
    const r = await run('LELO')
    expect(checks(r)).not.toContain('vision-legible-text')
    expect(r.blocked).toBe(false)
  })

  it('passes a short product name', async () => {
    const r = await run('Satisfyer Pro 2')
    expect(r.blocked).toBe(false)
  })

  it('passes when the frame carries no text at all', async () => {
    const r = await run('')
    expect(r.blocked).toBe(false)
  })

  it('blocks packaging junk and quotes the transcription', async () => {
    const r = await run('barcode 8 712345 678905, NET WT 3.4 FL OZ')
    expect(checks(r)).toContain('vision-legible-text')
    expect(r.blocked).toBe(true)
    expect(r.findings.find(f => f.check === 'vision-legible-text')?.detail).toContain('8 712345 678905')
  })

  it('blocks an ingredient panel', async () => {
    const r = await run('Ingredients: water, glycerin')
    expect(r.blocked).toBe(true)
  })

  it('blocks a baked-in caption or watermark', async () => {
    const r = await run('SHOP NOW at xdipx.com')
    expect(checks(r)).toContain('vision-legible-text')
    expect(r.blocked).toBe(true)
  })

  it('blocks text it cannot read as a brand mark, conservatively', async () => {
    const r = await run('a soft evening, whatever you want it to be, in your hands')
    expect(r.blocked).toBe(true)
  })

  it('classifies directly', () => {
    expect(classifyLegibleText(null)).toBe('none')
    expect(classifyLegibleText('  ')).toBe('none')
    expect(classifyLegibleText('Womanizer')).toBe('brand-mark')
    expect(classifyLegibleText('UPC 012345678905')).toBe('packaging')
    expect(classifyLegibleText('@xdipx')).toBe('caption-or-watermark')
  })
})
