import { describe, expect, it } from 'vitest'
import {
  distinctiveTokens,
  findHeroEmbedMismatches,
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
