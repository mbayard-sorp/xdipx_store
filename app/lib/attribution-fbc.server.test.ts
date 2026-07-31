import { describe, it, expect } from 'vitest'
import { buildFbc, fbCookieDomain, captureFbClickId, getClientIPOrNull } from './attribution.server'

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

describe('buildFbc', () => {
  it('produces the exact format Meta expects', () => {
    expect(buildFbc('IwAR2abc', 1785000000000)).toBe('fb.1.1785000000000.IwAR2abc')
  })

  it('uses millisecond precision', () => {
    // Seconds precision degrades or invalidates the click attribution, and the
    // 13-digit shape is what fbevents.js writes.
    const v = buildFbc('abc', 1785000000000)
    expect(v).toMatch(/^fb\.1\.\d{13}\.abc$/)
  })

  it('uses subdomain index 1, matching the registrable domain', () => {
    // A mismatch makes fbevents.js write a competing second _fbc cookie.
    expect(buildFbc('x', 1785000000000).split('.')[1]).toBe('1')
  })

  it('passes the fbclid through untouched, including special characters', () => {
    const clid = 'IwAR2-abc_def.ghi123'
    expect(buildFbc(clid, 1785000000000)).toBe(`fb.1.1785000000000.${clid}`)
  })
})

describe('fbCookieDomain', () => {
  it('returns the registrable domain on production hosts', () => {
    expect(fbCookieDomain(req('https://xdipx.com/'))).toBe('.xdipx.com')
    expect(fbCookieDomain(req('https://www.xdipx.com/'))).toBe('.xdipx.com')
  })

  it('omits the domain where the browser would reject it', () => {
    // Vercel preview hosts sit on a public suffix and localhost has no
    // registrable domain; setting Domain there drops the cookie entirely.
    expect(fbCookieDomain(req('https://xdipx-abc.vercel.app/'))).toBeNull()
    expect(fbCookieDomain(req('http://localhost:3000/'))).toBeNull()
  })
})

describe('captureFbClickId', () => {
  it('writes nothing when there is no fbclid', () => {
    expect(captureFbClickId(req('https://xdipx.com/products/x'))).toEqual([])
  })

  it('writes a correctly attributed cookie on an ad click', () => {
    const [cookie] = captureFbClickId(req('https://xdipx.com/?fbclid=CLICK123'), 1785000000000)
    expect(cookie).toContain('_fbc=fb.1.1785000000000.CLICK123')
    expect(cookie).toContain('Domain=.xdipx.com')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=7776000')
    expect(cookie?.toLowerCase()).toContain('samesite=lax')
  })

  it('does not mark the cookie HttpOnly', () => {
    // fbevents.js has to be able to read it, or it writes its own.
    const [cookie] = captureFbClickId(req('https://xdipx.com/?fbclid=X'), 1785000000000)
    expect(cookie?.toLowerCase()).not.toContain('httponly')
  })

  it('lets the latest click win', () => {
    const [first]  = captureFbClickId(req('https://xdipx.com/?fbclid=FIRST'), 1785000000000)
    const [second] = captureFbClickId(req('https://xdipx.com/?fbclid=SECOND'), 1785000009999)
    expect(first).toContain('FIRST')
    expect(second).toContain('SECOND')
    expect(second).toContain('1785000009999')
  })
})

describe('getClientIPOrNull', () => {
  it('reads the first x-forwarded-for hop', () => {
    expect(getClientIPOrNull(req('https://xdipx.com/', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip', () => {
    expect(getClientIPOrNull(req('https://xdipx.com/', { 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
  })

  it('returns null rather than a placeholder when the IP is unknown', () => {
    // The old '0.0.0.0' fallback read as 100% IP coverage in Meta's Event Match
    // Quality while matching nobody.
    expect(getClientIPOrNull(req('https://xdipx.com/'))).toBeNull()
  })
})
