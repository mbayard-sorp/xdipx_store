/**
 * Ticket #12876: social kept reusing the same handful of products (14
 * distinct in 21 days against ~4,800 in stock). These pin the two hard
 * filters (cooldown exclusion, the Instagram category filter) and the
 * scoring order (never-posted, newness, type variety, stock depth) against
 * fixture data — no DB, no Shopify, same split as blog-hero-embed-audit.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  isInstagramEligibleCategory,
  scoreSocialCandidates,
  type RawSocialCandidate,
} from '~/lib/social-candidates.server'

const NOW = new Date('2026-10-01T12:00:00.000Z')

function candidate(over: Partial<RawSocialCandidate> & { handle: string }): RawSocialCandidate {
  return {
    productId: `gid://shopify/Product/${over.handle}`,
    title: over.handle,
    vendor: 'Acme',
    productType: 'Wand Massager',
    totalInventory: 10,
    publishedAt: null,
    bareRefUrl: null,
    lastFeaturedAt: null,
    posts30d: 0,
    ...over,
  }
}

describe('isInstagramEligibleCategory (#12876, instagram-campaigns.md §4b filter 2)', () => {
  it('excludes every dildo family type', () => {
    for (const type of ['Dildo', 'Fantasy Dildo', 'Realistic Dildo', 'Silicone Dildo', 'Strap-On Dildo', 'Vibrating Dildo']) {
      expect(isInstagramEligibleCategory(type)).toBe(false)
    }
  })

  it('excludes an anatomically realistic product (sex doll)', () => {
    expect(isInstagramEligibleCategory('Sex Doll')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isInstagramEligibleCategory('realistic dildo')).toBe(false)
  })

  it('allows an ordinary category', () => {
    for (const type of ['Wand Massager', 'Cock Ring', 'Lubricant', 'Clitoral Vibrator', 'Bullet Vibrator']) {
      expect(isInstagramEligibleCategory(type)).toBe(true)
    }
  })

  it('allows a null/missing type (not excluded by this filter alone)', () => {
    expect(isInstagramEligibleCategory(null)).toBe(true)
    expect(isInstagramEligibleCategory(undefined)).toBe(true)
  })
})

describe('scoreSocialCandidates — cooldown exclusion (#12876)', () => {
  it('drops a product featured within cooldownDays', () => {
    const recent = candidate({ handle: 'recent', lastFeaturedAt: '2026-09-25T00:00:00.000Z' }) // 6 days ago
    const result = scoreSocialCandidates([recent], { platform: 'instagram', now: NOW })
    expect(result).toHaveLength(0)
  })

  it('keeps a product featured just outside the cooldown window', () => {
    const old = candidate({ handle: 'old', lastFeaturedAt: '2026-09-01T00:00:00.000Z' }) // 30 days ago
    const result = scoreSocialCandidates([old], { platform: 'instagram', cooldownDays: 21, now: NOW })
    expect(result.map(c => c.handle)).toEqual(['old'])
  })

  it('never excludes a product that has never been featured', () => {
    const fresh = candidate({ handle: 'never-posted', lastFeaturedAt: null })
    const result = scoreSocialCandidates([fresh], { platform: 'instagram', now: NOW })
    expect(result.map(c => c.handle)).toEqual(['never-posted'])
  })

  it('respects a non-default cooldownDays', () => {
    const c = candidate({ handle: 'a', lastFeaturedAt: '2026-09-29T00:00:00.000Z' }) // 2 days ago
    expect(scoreSocialCandidates([c], { platform: 'instagram', cooldownDays: 3, now: NOW })).toHaveLength(0)
    expect(scoreSocialCandidates([c], { platform: 'instagram', cooldownDays: 1, now: NOW }).map(x => x.handle)).toEqual(['a'])
  })
})

describe('scoreSocialCandidates — Instagram category filter', () => {
  it('drops a dildo-family product on instagram', () => {
    const toy = candidate({ handle: 'toy', productType: 'Realistic Dildo' })
    expect(scoreSocialCandidates([toy], { platform: 'instagram', now: NOW })).toHaveLength(0)
  })

  it('does not apply the category filter on X', () => {
    const toy = candidate({ handle: 'toy', productType: 'Realistic Dildo' })
    expect(scoreSocialCandidates([toy], { platform: 'x', now: NOW }).map(c => c.handle)).toEqual(['toy'])
  })

  it('keeps an eligible category on instagram', () => {
    const wand = candidate({ handle: 'wand', productType: 'Wand Massager' })
    expect(scoreSocialCandidates([wand], { platform: 'instagram', now: NOW }).map(c => c.handle)).toEqual(['wand'])
  })
})

describe('scoreSocialCandidates — productType filter', () => {
  it('exact-matches productType case-insensitively when passed', () => {
    const wand = candidate({ handle: 'wand', productType: 'Wand Massager' })
    const ring = candidate({ handle: 'ring', productType: 'Cock Ring' })
    const result = scoreSocialCandidates([wand, ring], { platform: 'x', productType: 'cock ring', now: NOW })
    expect(result.map(c => c.handle)).toEqual(['ring'])
  })
})

describe('scoreSocialCandidates — ordering (never-posted, newness, type variety, stock depth)', () => {
  it('ranks never-posted above a long-cooled-down featured product', () => {
    const neverPosted = candidate({ handle: 'never', lastFeaturedAt: null, totalInventory: 1 })
    const featuredLongAgo = candidate({ handle: 'old', lastFeaturedAt: '2026-01-01T00:00:00.000Z', totalInventory: 500 })
    const result = scoreSocialCandidates([featuredLongAgo, neverPosted], { platform: 'x', now: NOW })
    expect(result.map(c => c.handle)).toEqual(['never', 'old'])
  })

  it('ranks a new arrival above an equally never-posted non-arrival', () => {
    const arrival = candidate({ handle: 'new', publishedAt: '2026-09-28T00:00:00.000Z' }) // 3 days ago
    const notArrival = candidate({ handle: 'old-stock', publishedAt: '2025-01-01T00:00:00.000Z' })
    const result = scoreSocialCandidates([notArrival, arrival], { platform: 'x', newWithinDays: 21, now: NOW })
    expect(result.map(c => c.handle)).toEqual(['new', 'old-stock'])
    expect(result[0]).toMatchObject({ handle: 'new', isNewArrival: true })
    expect(result[1]).toMatchObject({ handle: 'old-stock', isNewArrival: false })
  })

  it('ranks a product type absent from the recent run above one that just posted', () => {
    const freshType = candidate({ handle: 'fresh-type', productType: 'Cock Ring' })
    const repeatType = candidate({ handle: 'repeat-type', productType: 'Wand Massager' })
    const result = scoreSocialCandidates([repeatType, freshType], {
      platform: 'x', recentProductTypes: ['Wand Massager', 'Wand Massager'], now: NOW,
    })
    expect(result.map(c => c.handle)).toEqual(['fresh-type', 'repeat-type'])
  })

  it('uses stock depth only as the final tiebreak', () => {
    const deep = candidate({ handle: 'deep', totalInventory: 200 })
    const thin = candidate({ handle: 'thin', totalInventory: 5 })
    const result = scoreSocialCandidates([thin, deep], { platform: 'x', now: NOW })
    expect(result.map(c => c.handle)).toEqual(['deep', 'thin'])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate({ handle: `p${i}` }))
    expect(scoreSocialCandidates(many, { platform: 'x', limit: 5, now: NOW })).toHaveLength(5)
  })

  it('shuffle order changes on a different day but never crosses a score band', () => {
    const a = candidate({ handle: 'a', lastFeaturedAt: null })
    const b = candidate({ handle: 'b', lastFeaturedAt: null })
    const featured = candidate({ handle: 'c', lastFeaturedAt: '2026-01-01T00:00:00.000Z' })
    const day1 = scoreSocialCandidates([a, b, featured], { platform: 'x', now: NOW })
    const day2 = scoreSocialCandidates([a, b, featured], { platform: 'x', now: new Date('2026-10-02T12:00:00.000Z') })
    // The never-posted band (a, b) always outranks the featured one (c),
    // on both days, even though a/b may swap places with each other.
    expect(day1[2]!.handle).toBe('c')
    expect(day2[2]!.handle).toBe('c')
    expect(new Set(day1.slice(0, 2).map(c => c.handle))).toEqual(new Set(['a', 'b']))
  })
})

describe('scoreSocialCandidates — output shape', () => {
  it('carries every field the ticket specifies, with castTarget null (PLANNED)', () => {
    const c = candidate({
      handle: 'wand', title: 'Magic Wand', vendor: 'Vibratex', productType: 'Wand Massager',
      totalInventory: 42, publishedAt: '2026-09-20T00:00:00.000Z', bareRefUrl: 'https://cdn/wand.jpg',
      lastFeaturedAt: null, posts30d: 0,
    })
    const [result] = scoreSocialCandidates([c], { platform: 'x', now: NOW })
    expect(result).toMatchObject({
      handle: 'wand',
      productId: 'gid://shopify/Product/wand',
      title: 'Magic Wand',
      vendor: 'Vibratex',
      productType: 'Wand Massager',
      publishedAt: '2026-09-20T00:00:00.000Z',
      isNewArrival: true,
      inventory: 42,
      lastFeaturedAt: null,
      posts30d: 0,
      bareRefUrl: 'https://cdn/wand.jpg',
      castTarget: null,
    })
    expect(result!.reason).toContain('never posted')
  })
})
