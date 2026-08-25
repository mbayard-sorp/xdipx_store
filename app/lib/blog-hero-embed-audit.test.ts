import { describe, expect, it } from 'vitest'
import {
  distinctiveTokens,
  findHeroEmbedMismatches,
  heroNamesAnyProduct,
  type AuditBlogPost,
  type CatalogProduct,
} from '~/lib/blog-hero-embed-audit'

// ticket #886: detect published Notebook posts whose hero image names a product
// the article never embeds. The matcher is heuristic (the hero carries no
// structured product ref, only free-text alt/prompt), so these tests pin both
// the real run-155 case and the false-positive guardrails that keep it quiet.

const CATALOG: CatalogProduct[] = [
  { handle: 'wanda-lust-rechargeable-wand', title: 'Wanda Lust Rechargeable Wand' },
  { handle: 'femmefunn-ultra-bullet', title: 'Femmefunn Ultra Bullet' },
  { handle: 'magic-wand-mini', title: 'Magic Wand Mini' },
  { handle: 'magic-wand-rechargeable', title: 'Magic Wand Rechargeable' },
  { handle: 'satisfyer-pro-2', title: 'Satisfyer Pro 2' },
]

describe('distinctiveTokens', () => {
  it('strips generic category/size/material words, keeping brand/model tokens', () => {
    expect(distinctiveTokens('Wanda Lust Rechargeable Silicone Wand')).toEqual(['wanda', 'lust'])
    expect(distinctiveTokens('Magic Wand Mini')).toEqual(['magic'])
    expect(distinctiveTokens('Rechargeable Silicone Wand')).toEqual([])
  })
})

describe('findHeroEmbedMismatches — the run-155 case', () => {
  it('flags the Wanda Lust hero on a post that only embeds bullet + two magic wands', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'mini-vs-full-size-vibrator-does-size-matter',
        heroImageAlt: 'A Wanda Lust wand resting in soft coral daylight on white',
        imagePrompt: null,
        embedHandles: ['femmefunn-ultra-bullet', 'magic-wand-mini', 'magic-wand-rechargeable'],
      },
    ]
    const hits = findHeroEmbedMismatches(posts, CATALOG)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      slug: 'mini-vs-full-size-vibrator-does-size-matter',
      matchedHandle: 'wanda-lust-rechargeable-wand',
      matchedOn: ['wanda', 'lust'],
    })
  })

  it('also reads the imagePrompt, not just the alt', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'p',
        heroImageAlt: 'a wand on a white background',
        imagePrompt: 'editorial still life of the Wanda Lust wand',
        embedHandles: ['magic-wand-mini'],
      },
    ]
    const hits = findHeroEmbedMismatches(posts, CATALOG)
    expect(hits.map((h) => h.matchedHandle)).toContain('wanda-lust-rechargeable-wand')
  })
})

describe('findHeroEmbedMismatches — precision guardrails', () => {
  it('does not flag when the hero names a product the post DOES embed', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'p',
        heroImageAlt: 'A Femmefunn Ultra Bullet in coral daylight',
        imagePrompt: null,
        embedHandles: ['femmefunn-ultra-bullet'],
      },
    ]
    expect(findHeroEmbedMismatches(posts, CATALOG)).toHaveLength(0)
  })

  it('does not flag a generic hero that names no distinctive product', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'p',
        heroImageAlt: 'a single approachable wellness product resting in soft daylight',
        imagePrompt: null,
        embedHandles: ['magic-wand-mini'],
      },
    ]
    expect(findHeroEmbedMismatches(posts, CATALOG)).toHaveLength(0)
  })

  it('suppresses a non-embedded sibling SKU indistinguishable from an embedded one', () => {
    // "magic wand" alt with magic-wand-mini embedded must not flag
    // magic-wand-rechargeable just because both share the distinctive token.
    const posts: AuditBlogPost[] = [
      {
        slug: 'p',
        heroImageAlt: 'the Magic Wand resting on white',
        imagePrompt: null,
        embedHandles: ['magic-wand-mini'],
      },
    ]
    expect(findHeroEmbedMismatches(posts, CATALOG)).toHaveLength(0)
  })

  it('flags a long single-distinctive-token brand (satisfyer) when named off-embed', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'p',
        heroImageAlt: 'a Satisfyer air-pulse toy in plum daylight',
        imagePrompt: null,
        embedHandles: ['magic-wand-mini'],
      },
    ]
    const hits = findHeroEmbedMismatches(posts, CATALOG)
    expect(hits.map((h) => h.matchedHandle)).toContain('satisfyer-pro-2')
  })

  it('returns nothing for an empty hero copy', () => {
    const posts: AuditBlogPost[] = [
      { slug: 'p', heroImageAlt: null, imagePrompt: null, embedHandles: ['magic-wand-mini'] },
    ]
    expect(findHeroEmbedMismatches(posts, CATALOG)).toEqual([])
  })
})

// ticket #2750: the inverse case the mismatch finder is blind to — a hero that
// names no catalog product at all on a post that does carry embeds.
describe('heroNamesAnyProduct', () => {
  it('is true when the hero copy names a catalog product', () => {
    const post: AuditBlogPost = {
      slug: 'p',
      heroImageAlt: 'the Wanda Lust wand resting on white',
      imagePrompt: null,
      embedHandles: [],
    }
    expect(heroNamesAnyProduct(post, CATALOG)).toBe(true)
  })

  it('reads the imagePrompt too, not just the alt', () => {
    const post: AuditBlogPost = {
      slug: 'p',
      heroImageAlt: 'a soft daylight scene',
      imagePrompt: 'editorial still of a Satisfyer air-pulse toy on plum-soft ground',
      embedHandles: [],
    }
    expect(heroNamesAnyProduct(post, CATALOG)).toBe(true)
  })

  it('is false for a generic editorial hero that names no product', () => {
    const post: AuditBlogPost = {
      slug: 'p',
      heroImageAlt: 'soft morning light across an unmade linen bed',
      imagePrompt: 'warm daylight, plum-soft ground, no product, no people',
      embedHandles: ['magic-wand-mini'],
    }
    expect(heroNamesAnyProduct(post, CATALOG)).toBe(false)
  })

  it('is false when the hero copy is empty', () => {
    const post: AuditBlogPost = { slug: 'p', heroImageAlt: null, imagePrompt: null, embedHandles: [] }
    expect(heroNamesAnyProduct(post, CATALOG)).toBe(false)
  })
})

// ticket #5397: a product whose distinctive tokens reduce to a single SHORT
// token (3-5 chars) — "Le Wand Mini Micro Rechargeable Wand Vibrator" -> ["micro"]
// — used to be permanently unpassable, because isNamedIn required a lone
// distinctive token to be >= 6 chars. The fix accepts a short single token when
// corroborated by another word from the product's own name, rather than lowering
// the length bar (which would have flagged bare incidental short tokens).
describe('single short distinctive token (#5397)', () => {
  const LEWAND: CatalogProduct[] = [
    { handle: 'le-wand-mini-micro-wand', title: 'Le Wand Mini Micro Rechargeable Wand Vibrator' },
    ...CATALOG,
  ]

  it('distinctive tokens reduce to a single 5-char token', () => {
    expect(distinctiveTokens('Le Wand Mini Micro Rechargeable Wand Vibrator')).toEqual(['micro'])
  })

  it('heroNamesAnyProduct is true when a hero faithfully depicts the micro wand', () => {
    const post: AuditBlogPost = {
      slug: 'le-wand-mini-micro-wand',
      heroImageAlt: 'the Le Wand Micro resting in soft coral daylight on white',
      imagePrompt: null,
      embedHandles: ['le-wand-mini-micro-wand'],
    }
    expect(heroNamesAnyProduct(post, LEWAND)).toBe(true)
  })

  it('a faithful micro-wand hero does not trip a mismatch on its own embed', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'le-wand-mini-micro-wand',
        heroImageAlt: 'the Le Wand Micro resting in soft coral daylight on white',
        imagePrompt: null,
        embedHandles: ['le-wand-mini-micro-wand'],
      },
    ]
    expect(findHeroEmbedMismatches(posts, LEWAND)).toHaveLength(0)
  })

  it('flags the micro wand when named off-embed (corroborated short token)', () => {
    const posts: AuditBlogPost[] = [
      {
        slug: 'p',
        heroImageAlt: 'the Le Wand Micro wand resting on white',
        imagePrompt: null,
        embedHandles: ['magic-wand-mini'],
      },
    ]
    const hits = findHeroEmbedMismatches(posts, LEWAND)
    expect(hits.map((h) => h.matchedHandle)).toContain('le-wand-mini-micro-wand')
  })

  it('does NOT match a bare, uncorroborated short token (precision guard)', () => {
    // "micro" appears incidentally with no other word from the product's name,
    // so it must not be read as naming the micro wand.
    const post: AuditBlogPost = {
      slug: 'p',
      heroImageAlt: 'a micro detail of dew on a coral petal in morning light',
      imagePrompt: null,
      embedHandles: [],
    }
    expect(heroNamesAnyProduct(post, LEWAND)).toBe(false)
    expect(findHeroEmbedMismatches([{ ...post, embedHandles: ['magic-wand-mini'] }], LEWAND)).toEqual(
      [],
    )
  })
})
