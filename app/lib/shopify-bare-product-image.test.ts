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

/**
 * Ticket #11028. Nalpac images are named `<sku><letter>.jpg` with no altText,
 * so `looksLikePackaging` (a pure text-signal check) never flags image A even
 * when it is the retail carton — a manual check of 8 in-stock SKUs found A
 * was the carton on 7 of them. The fix does not claim to know A is a carton;
 * it only stops treating an unlabeled A as CONFIRMED bare when a labeled-or-
 * differently-named sibling exists to prefer instead.
 */
describe('pickBareProductImage: unlabeled Nalpac first frame (#11028)', () => {
  // The 7 real carton-first SKUs from the incident writeup, each modeled as
  // its Nalpac `<sku>A.jpg` (no alt) plus a `<sku>B.jpg` (no alt) sibling —
  // the shape every one of them actually has in Shopify.
  const CARTON_FIRST_SKUS: Record<string, string> = {
    'lelo-mia-3-personal-vibrator': '92268',
    'lelo-sona-cruise': '77237',
    'zola-rechargeable-silicone-mini-wand': '81516',
    'femmefunn-ultra-wand-mini': '83572',
    'lelo-gigi-3': '93079',
    'aluna-dark-purple': '97349',
    'romp-presto-wand-vibrator': '93551',
  }

  it('no longer returns the unlabeled carton-suspect frame A with fellBack:false, for all 7 SKUs', () => {
    for (const [handle, sku] of Object.entries(CARTON_FIRST_SKUS)) {
      const media = [
        { url: `https://cdn.shopify.com/files/${sku}A.jpg`, altText: null },
        { url: `https://cdn.shopify.com/files/${sku}B.jpg`, altText: null },
      ]
      const pick = pickBareProductImage(media)
      expect(pick, handle).not.toMatchObject({ url: media[0]!.url, fellBack: false })
    }
  })

  it('prefers the B sibling over the unlabeled A frame for lelo-mia-3-personal-vibrator', () => {
    const pick = pickBareProductImage([
      { url: 'https://cdn.shopify.com/files/92268A.jpg', altText: null },
      { url: 'https://cdn.shopify.com/files/92268B.jpg', altText: null },
    ])
    expect(pick.url).toBe('https://cdn.shopify.com/files/92268B.jpg')
    expect(pick.index).toBe(1)
    expect(pick.fellBack).toBe(false)
  })

  it('falls back with fellBack:true for a SKU whose only image is the unlabeled A frame', () => {
    const pick = pickBareProductImage([{ url: 'https://cdn.shopify.com/files/93551A.jpg', altText: null }])
    expect(pick.url).toBe('https://cdn.shopify.com/files/93551A.jpg')
    expect(pick.fellBack).toBe(true)
  })

  it('still trusts an unlabeled non-A filename (an ordinary bare shot) at index 0', () => {
    const pick = pickBareProductImage([
      { url: 'https://cdn.shopify.com/files/chorus-bare.jpg', altText: null },
      { url: 'https://cdn.shopify.com/files/chorus-alt.jpg', altText: null },
    ])
    expect(pick.url).toBe('https://cdn.shopify.com/files/chorus-bare.jpg')
    expect(pick.fellBack).toBe(false)
  })

  it('trusts an A frame that carries real altText, since the absence of alt text is the actual signal', () => {
    const pick = pickBareProductImage([
      { url: 'https://cdn.shopify.com/files/92268A.jpg', altText: 'Mia 3, bare product' },
    ])
    expect(pick.url).toBe('https://cdn.shopify.com/files/92268A.jpg')
    expect(pick.fellBack).toBe(false)
  })

  it('prefers a labeled bare B frame over an unlabeled A frame even when a labeled carton sits between them', () => {
    const pick = pickBareProductImage([
      { url: 'https://cdn.shopify.com/files/92268A.jpg', altText: null },
      { url: 'https://cdn.shopify.com/files/92268-box.jpg', altText: 'Retail box' },
      { url: 'https://cdn.shopify.com/files/92268C.jpg', altText: 'Mia 3, bare product' },
    ])
    expect(pick.url).toBe('https://cdn.shopify.com/files/92268C.jpg')
    expect(pick.index).toBe(2)
    expect(pick.fellBack).toBe(false)
  })
})
