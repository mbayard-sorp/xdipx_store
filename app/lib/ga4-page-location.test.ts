import { describe, it, expect } from 'vitest'
import { buildPageLocation } from './ga4-page-location'

describe('buildPageLocation', () => {
  it('joins origin, pathname, and search into exactly one query string', () => {
    const url = buildPageLocation('https://xdipx.com', '/', '?variant=b')
    expect(url).toBe('https://xdipx.com/?variant=b')
    expect(url.split('?')).toHaveLength(2) // exactly one '?'
  })

  it('carries utm params intact, unmangled', () => {
    const url = buildPageLocation(
      'https://xdipx.com',
      '/products/some-toy',
      '?utm_source=google&utm_medium=paid&gclid=EAIaIQabc',
    )
    expect(url).toBe('https://xdipx.com/products/some-toy?utm_source=google&utm_medium=paid&gclid=EAIaIQabc')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('utm_source')).toBe('google')
    expect(parsed.searchParams.get('utm_medium')).toBe('paid')
    expect(parsed.searchParams.get('gclid')).toBe('EAIaIQabc')
  })

  it('never duplicates the query string even if search already carries the leading ?', () => {
    // This is the exact regression: a caller passing a `search` value that
    // already starts with '?' (URL.prototype.search's own shape, e.g.
    // location.search) must not get a second '?' prepended.
    const url = buildPageLocation('https://xdipx.com', '/', '?variant=b')
    expect(url).not.toBe('https://xdipx.com/?variant=b?variant=b')
    expect((url.match(/\?/g) ?? []).length).toBe(1)
  })

  it('produces a bare origin+path with no query string when search is empty', () => {
    const url = buildPageLocation('https://xdipx.com', '/faq', '')
    expect(url).toBe('https://xdipx.com/faq')
    expect(url).not.toContain('?')
  })

  it('normalizes a search value missing its leading ? rather than concatenating blindly', () => {
    const url = buildPageLocation('https://xdipx.com', '/', 'variant=b')
    expect(url).toBe('https://xdipx.com/?variant=b')
  })
})
