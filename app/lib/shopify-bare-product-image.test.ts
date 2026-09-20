/**
 * pickBareProductImage (ticket #10341). instagram-campaigns.md section 3.2c:
 * brief only from a bare-product reference, because Shopify featuredMedia is
 * sometimes the retail carton (SKU 96203: box is image A, product is image B).
 */
import { describe, expect, it } from 'vitest'
import { looksLikePackaging, pickBareProductImage } from './shopify.server'

const CARTON = { url: 'https://cdn.shopify.com/files/96203-box-front.jpg', altText: 'Retail box, front' }
const BARE = { url: 'https://cdn.shopify.com/files/96203-product.jpg', altText: 'Chorus, bare product' }

describe('looksLikePackaging', () => {
  it('flags packaging words in the alt text', () => {
    for (const altText of ['Retail box', 'in packaging', 'Carton shot', 'blister pack', 'label detail']) {
      expect(looksLikePackaging({ url: 'https://cdn/a.jpg', altText })).toBe(true)
    }
  })

  it('flags packaging words in the url filename', () => {
    expect(looksLikePackaging({ url: 'https://cdn/96203-box.jpg', altText: '' })).toBe(true)
    expect(looksLikePackaging({ url: 'https://cdn/96203_retail_package.png?v=3', altText: null })).toBe(true)
  })

  it('does not flag an ordinary packshot', () => {
    expect(looksLikePackaging(BARE)).toBe(false)
    expect(looksLikePackaging({ url: 'https://cdn/boxer-brief.jpg', altText: 'Boxer brief' })).toBe(false)
  })

  it('ignores the cdn path, only the filename and alt text', () => {
    expect(looksLikePackaging({ url: 'https://cdn.shopify.com/boxes/store/chorus.jpg', altText: '' })).toBe(false)
  })
})

describe('pickBareProductImage', () => {
  it('returns the bare product when the first entry is a carton', () => {
    const pick = pickBareProductImage([CARTON, BARE])
    expect(pick.url).toBe(BARE.url)
    expect(pick.index).toBe(1)
    expect(pick.fellBack).toBe(false)
  })

  it('returns the featured image untouched when it is already bare', () => {
    const pick = pickBareProductImage([BARE, CARTON])
    expect(pick.url).toBe(BARE.url)
    expect(pick.index).toBe(0)
    expect(pick.fellBack).toBe(false)
  })

  it('falls back to the featured frame and says so when everything looks like packaging', () => {
    const pick = pickBareProductImage([CARTON, { url: 'https://cdn/96203-packaging.jpg', altText: '' }])
    expect(pick.url).toBe(CARTON.url)
    expect(pick.fellBack).toBe(true)
  })

  it('returns nothing usable for an empty or missing list', () => {
    for (const input of [[], null, undefined]) {
      const pick = pickBareProductImage(input)
      expect(pick.url).toBeNull()
      expect(pick.fellBack).toBe(true)
    }
  })

  it('respects card_art_blocked, falling back to the reviewed mood image', () => {
    const pick = pickBareProductImage([BARE], { cardArtBlocked: true, moodImageUrl: 'https://cdn/mood.jpg' })
    expect(pick.url).toBe('https://cdn/mood.jpg')
    expect(pick.fellBack).toBe(true)
  })

  it('returns no image at all when card art is blocked and no mood image exists', () => {
    expect(pickBareProductImage([BARE], { cardArtBlocked: true }).url).toBeNull()
  })
})
