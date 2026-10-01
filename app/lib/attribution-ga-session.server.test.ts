import { describe, it, expect } from 'vitest'
import { getGaSessionId } from './attribution.server'
import { attributionCartAttrs } from './attribution-cart.server'

function req(url: string, cookie?: string): Request {
  return new Request(url, cookie ? { headers: { Cookie: cookie } } : {})
}

// ticket #12670: GA4 Measurement Protocol purchases with no session_id are
// not joined to a session and attribute to "Unassigned", which hid every
// channel (AI Assistant included) from the strategy brief's GA4 reports.
describe('getGaSessionId', () => {
  it('parses the current GS2 cookie format', () => {
    expect(getGaSessionId(req('https://xdipx.com/', '_ga_ABC123XYZ=GS2.1.s1696152000$o3$g1$t1696152060$j60$l0$h0')))
      .toBe('1696152000')
  })

  it('parses the older GS1 cookie format', () => {
    expect(getGaSessionId(req('https://xdipx.com/', '_ga_ABC123XYZ=GS1.1.1696152000.3.1.1696152060.0')))
      .toBe('1696152000')
  })

  it('returns null when no _ga_<suffix> cookie is present', () => {
    expect(getGaSessionId(req('https://xdipx.com/'))).toBeNull()
    // The plain `_ga` client-id cookie must not be mistaken for the session cookie.
    expect(getGaSessionId(req('https://xdipx.com/', '_ga=GA1.1.123.456'))).toBeNull()
  })

  it('returns null when the cookie value matches neither known format', () => {
    expect(getGaSessionId(req('https://xdipx.com/', '_ga_ABC123XYZ=garbage'))).toBeNull()
  })

  it('finds the session cookie alongside unrelated cookies', () => {
    expect(getGaSessionId(req(
      'https://xdipx.com/',
      'age_verified=1; _ga_ABC123XYZ=GS2.1.s999$o1$g1$t999; other=thing',
    ))).toBe('999')
  })
})

describe('attributionCartAttrs: _ga_sid', () => {
  it('includes _ga_sid when the GA4 session cookie is present', () => {
    const attrs = attributionCartAttrs(req('https://xdipx.com/', '_ga_ABC123XYZ=GS2.1.s1696152000$o3'))
    expect(attrs).toContainEqual({ key: '_ga_sid', value: '1696152000' })
  })

  it('omits _ga_sid when no GA4 session cookie is present', () => {
    const attrs = attributionCartAttrs(req('https://xdipx.com/'))
    expect(attrs.some(a => a.key === '_ga_sid')).toBe(false)
  })
})
