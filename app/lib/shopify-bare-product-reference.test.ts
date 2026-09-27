/**
 * resolveBareProductReference / looksAiGenerated (ticket #11474).
 * instagram-campaigns.md §3.2c: brief only from a bare, text-free product
 * reference. This resolver is meant to run ONCE (scripts/resolve-bare-product-references.ts)
 * and be stored on xdipx.bare_product_reference, so unlike `pickBareProductImage`
 * it never hands back a best-guess frame — a real ambiguity resolves to
 * `url: null`, a refusal signal for the social image path.
 */
import { describe, expect, it } from 'vitest'
import { looksAiGenerated, resolveBareProductReference } from './shopify.server'

const CARTON = { url: 'https://cdn.shopify.com/files/96203-box-front.jpg', altText: 'Retail box, front' }
const BARE = { url: 'https://cdn.shopify.com/files/96203-product.jpg', altText: 'Chorus, bare product' }

describe('looksAiGenerated', () => {
  it('flags the exact evidenced filenames', () => {
    expect(looksAiGenerated({ url: 'https://cdn/ai-generated-1234.png' })).toBe(true)
    expect(looksAiGenerated({ url: 'https://cdn/ai-generated-abcd.jpg' })).toBe(true)
  })

  it('is case-insensitive and ignores a query string', () => {
    expect(looksAiGenerated({ url: 'https://cdn/AI-Generated-xyz.PNG?v=3' })).toBe(true)
  })

  it('does not flag an ordinary product photo', () => {
    expect(looksAiGenerated(BARE)).toBe(false)
    expect(looksAiGenerated({ url: 'https://cdn/prowler-red-large.jpg' })).toBe(false)
  })
})

describe('resolveBareProductReference', () => {
  it('resolves the bare frame when the first entry is a carton', () => {
    const res = resolveBareProductReference([CARTON, BARE])
    expect(res.url).toBe(BARE.url)
    expect(res.index).toBe(1)
    expect(res.reason).toBe('confirmed bare frame')
  })

  it('resolves the featured frame untouched when it is already bare', () => {
    const res = resolveBareProductReference([BARE, CARTON])
    expect(res.url).toBe(BARE.url)
    expect(res.index).toBe(0)
  })

  it('excludes an AI-generated frame outright, even when nothing else looks like packaging', () => {
    const res = resolveBareProductReference([
      { url: 'https://cdn/ai-generated-9999.png', altText: '' },
      BARE,
    ])
    expect(res.url).toBe(BARE.url)
  })

  it('resolves to null when every frame is AI-generated', () => {
    const res = resolveBareProductReference([
      { url: 'https://cdn/ai-generated-1.png', altText: '' },
      { url: 'https://cdn/ai-generated-2.jpg', altText: '' },
    ])
    expect(res.url).toBeNull()
    expect(res.index).toBeNull()
    expect(res.reason).toBe('every media entry is AI-generated')
  })

  it('resolves to null, not a best guess, when everything looks like packaging', () => {
    const res = resolveBareProductReference([CARTON, { url: 'https://cdn/96203-packaging.jpg', altText: '' }])
    expect(res.url).toBeNull()
    expect(res.reason).toBe('every non-AI-generated frame looks like packaging')
  })

  it('resolves to null for an empty or missing media list', () => {
    for (const input of [[], null, undefined]) {
      const res = resolveBareProductReference(input)
      expect(res.url).toBeNull()
      expect(res.reason).toBe('product has no media')
    }
  })

  it('resolves to null for a SKU whose only image is an unconfirmed unlabeled Nalpac first frame (#11028 doubt)', () => {
    // femmefunn-ultra-bullet-massager: single carton media entry, no bare
    // frame anywhere in the catalog for this SKU (the ticket's own evidence).
    const res = resolveBareProductReference([
      { url: 'https://cdn.shopify.com/files/83572A.jpg', altText: null },
    ])
    expect(res.url).toBeNull()
  })

  it('resolves to null for a sole, alt-textless media entry with no letter suffix at all (live regression: femmefunn-ultra-bullet-massager-...-pink)', () => {
    // The real production shape that slipped past every other signal in this
    // file: one media entry, no altText, a plain numeric filename ("58939.jpg")
    // that matches neither `looksLikePackaging` nor the lettered-Nalpac doubt —
    // yet is the SKU's only image and IS the retail carton (ticket's own hand
    // check). With no sibling to prefer instead, this must not resolve bare.
    const res = resolveBareProductReference([
      { url: 'https://cdn.shopify.com/files/58939.jpg', altText: null },
    ])
    expect(res.url).toBeNull()
    expect(res.reason).toContain('no sibling to confirm')
  })

  it('still trusts a sole media entry that carries real altText', () => {
    const res = resolveBareProductReference([
      { url: 'https://cdn.shopify.com/files/58939.jpg', altText: 'Ultra Bullet, bare product' },
    ])
    expect(res.url).toBe('https://cdn.shopify.com/files/58939.jpg')
  })
})
