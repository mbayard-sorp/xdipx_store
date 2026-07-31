import { describe, it, expect } from 'vitest'
import { isPrefetchRequest, isCapiEligible } from './capi-eligibility.server'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://xdipx.com/products/test', { headers })
}

describe('isPrefetchRequest', () => {
  it('detects the Chrome Sec-Purpose header', () => {
    expect(isPrefetchRequest(req({ 'sec-purpose': 'prefetch' }))).toBe(true)
    expect(isPrefetchRequest(req({ 'sec-purpose': 'prefetch;prerender' }))).toBe(true)
  })

  it('detects legacy and non-Chrome prefetch headers', () => {
    expect(isPrefetchRequest(req({ purpose: 'prefetch' }))).toBe(true)
    expect(isPrefetchRequest(req({ 'x-moz': 'prefetch' }))).toBe(true)
    expect(isPrefetchRequest(req({ 'x-purpose': 'preview' }))).toBe(true)
  })

  it('is case insensitive', () => {
    expect(isPrefetchRequest(req({ 'sec-purpose': 'Prefetch' }))).toBe(true)
    expect(isPrefetchRequest(req({ 'x-moz': 'PREFETCH' }))).toBe(true)
  })

  it('does not fire on a normal navigation', () => {
    expect(isPrefetchRequest(req({ 'user-agent': CHROME }))).toBe(false)
    expect(isPrefetchRequest(req({ 'sec-fetch-mode': 'navigate' }))).toBe(false)
  })
})

describe('isCapiEligible', () => {
  it('allows a real browser navigation', () => {
    expect(isCapiEligible(req({ 'user-agent': CHROME }))).toBe(true)
  })

  it('blocks hover prefetches from a real browser', () => {
    // The regression that mattered most: prefetch="intent" runs the PDP loader
    // on hover, so a mega-menu mouse pass minted several conversion events.
    expect(isCapiEligible(req({ 'user-agent': CHROME, 'sec-purpose': 'prefetch' }))).toBe(false)
  })

  it('blocks known crawlers', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1',
      'python-requests/2.31.0',
    ]) {
      expect(isCapiEligible(req({ 'user-agent': ua })), ua).toBe(false)
    }
  })

  it('blocks a request with no user agent at all', () => {
    expect(isCapiEligible(req())).toBe(false)
  })
})
