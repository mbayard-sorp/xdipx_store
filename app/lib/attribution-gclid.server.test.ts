import { describe, it, expect } from 'vitest'
import { captureGoogleClickId, getStoredGoogleClickId } from './attribution.server'
import { attributionCartAttrs } from './attribution-cart.server'

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

/** Reads the cookie value back out of a Set-Cookie string. */
function cookieValue(setCookie: string): string {
  return decodeURIComponent(setCookie.split(';')[0]!.split('=').slice(1).join('='))
}

const NOW = 1785000000000

describe('captureGoogleClickId', () => {
  it('captures gclid with its type and capture time', () => {
    const [c] = captureGoogleClickId(req('https://xdipx.com/?gclid=EAIaIQabc'), NOW)
    expect(c).toBeDefined()
    expect(JSON.parse(cookieValue(c!))).toEqual({
      id: 'EAIaIQabc',
      type: 'gclid',
      capturedAt: new Date(NOW).toISOString(),
    })
  })

  it.each(['wbraid', 'gbraid'] as const)('captures %s and records its own type', type => {
    // These upload in a different column than gclid, so losing the type loses
    // the ability to import the conversion at all.
    const [c] = captureGoogleClickId(req(`https://xdipx.com/?${type}=Cj0abc`), NOW)
    expect(JSON.parse(cookieValue(c!))).toMatchObject({ id: 'Cj0abc', type })
  })

  it('prefers gclid over the braid params when several are present', () => {
    const [c] = captureGoogleClickId(
      req('https://xdipx.com/?gbraid=g1&wbraid=w1&gclid=real'), NOW,
    )
    expect(JSON.parse(cookieValue(c!))).toMatchObject({ id: 'real', type: 'gclid' })
  })

  it('prefers wbraid over gbraid when gclid is absent', () => {
    const [c] = captureGoogleClickId(req('https://xdipx.com/?gbraid=g1&wbraid=w1'), NOW)
    expect(JSON.parse(cookieValue(c!))).toMatchObject({ id: 'w1', type: 'wbraid' })
  })

  it('writes NO cookie when no click id is present', () => {
    // Load-bearing: an unconditional Set-Cookie on every request knocks the
    // homepage and every PDP out of the edge cache.
    expect(captureGoogleClickId(req('https://xdipx.com/'), NOW)).toEqual([])
    expect(captureGoogleClickId(req('https://xdipx.com/?utm_source=google'), NOW)).toEqual([])
  })

  it('ignores an empty click id rather than storing a blank', () => {
    expect(captureGoogleClickId(req('https://xdipx.com/?gclid='), NOW)).toEqual([])
  })

  it('survives a malformed request url', () => {
    expect(() => captureGoogleClickId(new Request('https://xdipx.com/'), NOW)).not.toThrow()
  })

  it('sets a 90-day lifetime, matching Google’s offline import window', () => {
    const [c] = captureGoogleClickId(req('https://xdipx.com/?gclid=abc'), NOW)
    expect(c).toContain(`Max-Age=${60 * 60 * 24 * 90}`)
  })

  it('is lax and path-scoped to the site root', () => {
    // An ad click is a top-level cross-site navigation; Strict would drop it.
    const [c] = captureGoogleClickId(req('https://xdipx.com/?gclid=abc'), NOW)
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/')
  })

  it('scopes to the registrable domain in production, and omits it elsewhere', () => {
    // Vercel preview hosts sit on a public suffix; setting Domain drops it.
    const [prod] = captureGoogleClickId(req('https://www.xdipx.com/?gclid=abc'), NOW)
    expect(prod).toContain('Domain=.xdipx.com')
    const [preview] = captureGoogleClickId(req('https://xdipx-abc.vercel.app/?gclid=abc'), NOW)
    expect(preview).not.toContain('Domain=')
  })

  it('last click wins', () => {
    const [first] = captureGoogleClickId(req('https://xdipx.com/?gclid=one'), NOW)
    const [second] = captureGoogleClickId(req('https://xdipx.com/?gclid=two'), NOW + 5000)
    expect(JSON.parse(cookieValue(first!)).id).toBe('one')
    expect(JSON.parse(cookieValue(second!))).toMatchObject({
      id: 'two',
      capturedAt: new Date(NOW + 5000).toISOString(),
    })
  })
})

describe('getStoredGoogleClickId', () => {
  it('round-trips a captured click id', () => {
    const [c] = captureGoogleClickId(req('https://xdipx.com/?gclid=EAIaIQabc'), NOW)
    const stored = getStoredGoogleClickId(
      req('https://xdipx.com/', { Cookie: `__xdipx_gclid=${encodeURIComponent(cookieValue(c!))}` }),
    )
    expect(stored).toMatchObject({ id: 'EAIaIQabc', type: 'gclid' })
  })

  it('returns null when absent, malformed, or of an unknown type', () => {
    expect(getStoredGoogleClickId(req('https://xdipx.com/'))).toBeNull()
    expect(getStoredGoogleClickId(
      req('https://xdipx.com/', { Cookie: '__xdipx_gclid=not-json' }),
    )).toBeNull()
    expect(getStoredGoogleClickId(
      req('https://xdipx.com/', { Cookie: `__xdipx_gclid=${encodeURIComponent('{"id":"x","type":"fbclid"}')}` }),
    )).toBeNull()
  })
})

describe('attributionCartAttrs', () => {
  it('carries the click id and its type across the off-domain checkout boundary', () => {
    // Cart attributes are the only channel to the order webhook, so a missing
    // attribute here makes the order permanently unattributable to the ad.
    const stored = encodeURIComponent(JSON.stringify({
      id: 'EAIaIQabc', type: 'gclid', capturedAt: new Date(NOW).toISOString(),
    }))
    const attrs = attributionCartAttrs(
      req('https://xdipx.com/', { Cookie: `__xdipx_gclid=${stored}` }),
    )
    expect(attrs).toEqual(expect.arrayContaining([
      { key: '_gclid', value: 'EAIaIQabc' },
      { key: '_gclid_type', value: 'gclid' },
    ]))
  })

  it('emits no gclid attributes when nothing was captured', () => {
    const attrs = attributionCartAttrs(req('https://xdipx.com/'))
    expect(attrs.find(a => a.key === '_gclid')).toBeUndefined()
    expect(attrs.find(a => a.key === '_gclid_type')).toBeUndefined()
  })
})
