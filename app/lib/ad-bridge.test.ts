import { describe, it, expect } from 'vitest'
import {
  buildBridgeDestination,
  isValidSlug,
  normalizeBridgePage,
  normalizeButtonLabel,
  pickBridgePackshot,
  plainHeadline,
  splitHeadline,
} from './ad-bridge.server'
import { bridgeHostSupportPath, bridgeSlugFromPath, isBridgeHost, isBridgeHostRequest, requestHost } from './bridge-host.server'
import { normalizeLaneEntries } from './ad-lane-subset.server'

describe('splitHeadline', () => {
  it('splits on the single emphasis marker', () => {
    expect(splitHeadline('Comfort for a *second* spring.')).toEqual({
      before: 'Comfort for a ',
      em: 'second',
      after: ' spring.',
    })
  })
  it('returns plain text when there is no marker', () => {
    expect(splitHeadline('Billing reads XDIPX')).toEqual({ before: 'Billing reads XDIPX', em: '', after: '' })
  })
  it('only the first marker emphasizes; stray asterisks vanish', () => {
    const r = splitHeadline('One *two* three *four*')
    expect(r.em).toBe('two')
    expect(r.after).toBe(' three four')
  })
  it('strips em and en dashes to a comma', () => {
    expect(plainHeadline('Slow \u2014 steady')).toBe('Slow, steady')
  })
})

describe('buildBridgeDestination', () => {
  it('points at the PDP on the main host with the paid UTMs and no redirect hop', () => {
    const url = buildBridgeDestination(
      { productHandle: 'dame-zee-bullet-vibrator-periwinkle', lane: 'meta', utmCampaign: 'meta-plain-box', slug: 'plain-box' },
      'https://xdipx.com',
    )
    const u = new URL(url)
    expect(u.origin).toBe('https://xdipx.com')
    expect(u.pathname).toBe('/products/dame-zee-bullet-vibrator-periwinkle')
    expect(u.searchParams.get('utm_source')).toBe('meta')
    expect(u.searchParams.get('utm_medium')).toBe('paid')
    expect(u.searchParams.get('utm_campaign')).toBe('meta-plain-box')
    expect(u.searchParams.get('utm_content')).toBe('plain-box')
  })
})

describe('normalizeBridgePage', () => {
  const ok = {
    slug: 'second-spring',
    headline: 'Comfort for a *second* spring.',
    claim: 'A claim.',
    buttonLabel: 'Show me',
    productHandle: 'lelo-water-based-personal-moisturizer-75-ml-2-5-oz',
    utmCampaign: 'meta-second-spring',
    lane: 'meta',
    live: true,
    healthFraming: true,
  }
  it('accepts a complete row', () => {
    expect(normalizeBridgePage(ok)?.slug).toBe('second-spring')
  })
  it('rejects a bad slug, bad handle or missing copy', () => {
    expect(normalizeBridgePage({ ...ok, slug: 'Bad Slug' })).toBeNull()
    expect(normalizeBridgePage({ ...ok, productHandle: '/products/x' })).toBeNull()
    expect(normalizeBridgePage({ ...ok, claim: ' ' })).toBeNull()
    expect(normalizeBridgePage(null)).toBeNull()
  })
  it('falls back to a whitelist CTA and defaults live to false', () => {
    const p = normalizeBridgePage({ ...ok, buttonLabel: 'Buy now', live: undefined as unknown as boolean })!
    expect(p.buttonLabel).toBe('Show me')
    expect(p.live).toBe(false)
  })
  it('CTA whitelist', () => {
    expect(normalizeButtonLabel('Take a peek')).toBe('Take a peek')
    expect(normalizeButtonLabel('Buy now')).toBe('Show me')
  })
  it('slug shape', () => {
    expect(isValidSlug('second-spring')).toBe(true)
    expect(isValidSlug('../x')).toBe(false)
  })
})

describe('pickBridgePackshot', () => {
  const base = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'
  it('keeps position 0 when it is not a packaging shot', () => {
    expect(pickBridgePackshot([{ url: `${base}/90001.jpg?v=1` }, { url: `${base}/90002.jpg?v=1` }])).toBe(`${base}/90001.jpg?v=1`)
  })
  it('swaps a Nalpac A shot for its B sibling', () => {
    expect(
      pickBridgePackshot([{ url: `${base}/77096A.jpg?v=1` }, { url: `${base}/55555.jpg` }, { url: `${base}/77096B.jpg?v=1` }]),
    ).toBe(`${base}/77096B.jpg?v=1`)
  })
  it('keeps the A shot when no sibling exists, and handles an empty list', () => {
    expect(pickBridgePackshot([{ url: `${base}/77096A.jpg` }])).toBe(`${base}/77096A.jpg`)
    expect(pickBridgePackshot([])).toBeNull()
  })
})

describe('bridge host gate', () => {
  it('reads x-forwarded-host before host, ignoring port and case', () => {
    expect(requestHost(new Headers({ host: 'xdipx.com', 'x-forwarded-host': 'Curious.xdipx.com:443' }))).toBe('curious.xdipx.com')
    expect(requestHost({ host: 'curious.xdipx.com:3000' })).toBe('curious.xdipx.com')
  })
  it('only curious.xdipx.com is the bridge host', () => {
    expect(isBridgeHost('curious.xdipx.com')).toBe(true)
    expect(isBridgeHost('xdipx.com')).toBe(false)
    expect(isBridgeHost('curious.xdipx.com.evil.test')).toBe(false)
  })
  it('the dev override works outside production only', () => {
    const req = new Request('http://localhost:3000/bridge/x?bridgeHost=1', { headers: { host: 'localhost:3000' } })
    const prev = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'development'
    expect(isBridgeHostRequest(req)).toBe(true)
    process.env['NODE_ENV'] = 'production'
    expect(isBridgeHostRequest(req)).toBe(false)
    process.env['NODE_ENV'] = prev
  })
  it('the real host works without the override', () => {
    const req = new Request('https://curious.xdipx.com/second-spring', { headers: { host: 'curious.xdipx.com' } })
    expect(isBridgeHostRequest(req)).toBe(true)
  })
  it('extracts slugs from slug-shaped paths and nothing else', () => {
    expect(bridgeSlugFromPath('/second-spring')).toBe('second-spring')
    expect(bridgeSlugFromPath('/bridge/Second-Spring')).toBe('second-spring')
    expect(bridgeSlugFromPath('/second-spring.data')).toBe('second-spring')
    for (const bad of ['/', '/products/x', '/collections/all', '/a/b', '/__manifest', '/x.php', '/../etc']) {
      expect(bridgeSlugFromPath(bad), bad).toBeNull()
    }
  })
  it('support paths are the manifest and the consent log only', () => {
    expect(bridgeHostSupportPath('/__manifest')).toBe(true)
    expect(bridgeHostSupportPath('/api/consent')).toBe(true)
    expect(bridgeHostSupportPath('/api/cart')).toBe(false)
    expect(bridgeHostSupportPath('/')).toBe(false)
  })
})

describe('normalizeLaneEntries', () => {
  it('drops blanks and duplicates', () => {
    const rows = normalizeLaneEntries([
      { productHandle: 'a', displayTitle: 'A', positionZeroOk: true },
      { productHandle: 'a', displayTitle: 'A again' },
      { productHandle: '', displayTitle: 'x' },
      { productHandle: 'b', displayTitle: ' ' },
      { productHandle: 'c', displayTitle: 'C' },
    ])
    expect(rows).toEqual([
      { productHandle: 'a', displayTitle: 'A', positionZeroOk: true },
      { productHandle: 'c', displayTitle: 'C', positionZeroOk: false },
    ])
    expect(normalizeLaneEntries(null)).toEqual([])
  })
})
