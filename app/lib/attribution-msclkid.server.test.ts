import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureMicrosoftClickId, getStoredMicrosoftClickId } from './attribution.server'
import { attributionCartAttrs } from './attribution-cart.server'

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

/** Reads the cookie value back out of a Set-Cookie string. */
function cookieValue(setCookie: string): string {
  return decodeURIComponent(setCookie.split(';')[0]!.split('=').slice(1).join('='))
}

/** The Cookie header a browser would send back after a capture. */
function cookieHeaderFrom(setCookie: string): string {
  return setCookie.split(';')[0]!
}

const NOW = 1785000000000

afterEach(() => vi.unstubAllEnvs())

describe('captureMicrosoftClickId', () => {
  it('captures msclkid with its capture time', () => {
    const [c] = captureMicrosoftClickId(req('https://xdipx.com/?msclkid=4f2a9c1b8e7d'), NOW)
    expect(c).toMatch(/^__xdipx_msclkid=/)
    expect(JSON.parse(cookieValue(c!))).toEqual({ id: '4f2a9c1b8e7d', capturedAt: new Date(NOW).toISOString() })
  })

  it('writes NO cookie when msclkid is absent or empty', () => {
    // An unconditional Set-Cookie would knock every page out of the edge cache.
    expect(captureMicrosoftClickId(req('https://xdipx.com/'), NOW)).toEqual([])
    expect(captureMicrosoftClickId(req('https://xdipx.com/?utm_source=bing'), NOW)).toEqual([])
    expect(captureMicrosoftClickId(req('https://xdipx.com/?msclkid='), NOW)).toEqual([])
  })

  it('keeps it 90 days, lax, at the site root', () => {
    const [c] = captureMicrosoftClickId(req('https://xdipx.com/?msclkid=abc'), NOW)
    expect(c).toMatch(/Max-Age=7776000/)
    expect(c).toMatch(/SameSite=Lax/)
    expect(c).toMatch(/Path=\//)
  })

  it('scopes to the registrable domain in production, and omits it elsewhere', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const [prod] = captureMicrosoftClickId(req('https://www.xdipx.com/?msclkid=abc'), NOW)
    expect(prod).toMatch(/Domain=\.xdipx\.com/)
    expect(prod).toMatch(/Secure/)
    const [preview] = captureMicrosoftClickId(req('https://xdipx-git-x.vercel.app/?msclkid=abc'), NOW)
    expect(preview).not.toMatch(/Domain=/)
  })
})

describe('getStoredMicrosoftClickId', () => {
  it('round-trips a captured click id', () => {
    const [c] = captureMicrosoftClickId(req('https://xdipx.com/?msclkid=abc123'), NOW)
    expect(getStoredMicrosoftClickId(req('https://xdipx.com/cart', { Cookie: cookieHeaderFrom(c!) })))
      .toEqual({ id: 'abc123', capturedAt: new Date(NOW).toISOString() })
  })

  it('returns null when absent or malformed', () => {
    expect(getStoredMicrosoftClickId(req('https://xdipx.com/'))).toBeNull()
    expect(getStoredMicrosoftClickId(req('https://xdipx.com/', { Cookie: '__xdipx_msclkid=not-json' }))).toBeNull()
    expect(getStoredMicrosoftClickId(req('https://xdipx.com/', { Cookie: `__xdipx_msclkid=${encodeURIComponent('{"id":""}')}` }))).toBeNull()
  })
})

describe('attributionCartAttrs with a Microsoft click', () => {
  it('stamps _msclkid, its capture time and marketing consent onto the cart', () => {
    const [c] = captureMicrosoftClickId(req('https://xdipx.com/?msclkid=abc123'), NOW)
    const attrs = attributionCartAttrs(req('https://xdipx.com/api/cart', { Cookie: cookieHeaderFrom(c!) }))
    expect(attrs).toEqual(expect.arrayContaining([
      { key: '_msclkid', value: 'abc123' },
      { key: '_msclkid_captured_at', value: new Date(NOW).toISOString() },
      { key: '_marketing_consent', value: 'false' },
    ]))
    expect(attrs.some(a => a.key.startsWith('_gclid'))).toBe(false)
  })

  it('emits no msclkid attributes when nothing was captured', () => {
    const attrs = attributionCartAttrs(req('https://xdipx.com/api/cart'))
    expect(attrs.some(a => a.key.startsWith('_msclkid') || a.key === '_marketing_consent')).toBe(false)
  })

  it('sends marketing consent once when both a gclid and an msclkid were captured', () => {
    const gclid = `__xdipx_gclid=${encodeURIComponent(JSON.stringify({ id: 'g1', type: 'gclid', capturedAt: 'x' }))}`
    const [c] = captureMicrosoftClickId(req('https://xdipx.com/?msclkid=m1'), NOW)
    const attrs = attributionCartAttrs(req('https://xdipx.com/api/cart', { Cookie: `${gclid}; ${cookieHeaderFrom(c!)}` }))
    expect(attrs.filter(a => a.key === '_marketing_consent')).toHaveLength(1)
    expect(attrs).toEqual(expect.arrayContaining([{ key: '_gclid', value: 'g1' }, { key: '_msclkid', value: 'm1' }]))
  })
})
