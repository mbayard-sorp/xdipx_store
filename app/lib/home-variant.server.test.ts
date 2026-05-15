import { afterEach, describe, expect, it } from 'vitest'
import { pinHomeVariantCookie, resolveHomeVariant, HOME_VARIANT_COOKIE } from './home-variant.server'

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

const originalEnv = process.env['HOME_VARIANT']
afterEach(() => {
  if (originalEnv === undefined) delete process.env['HOME_VARIANT']
  else process.env['HOME_VARIANT'] = originalEnv
})

describe('resolveHomeVariant', () => {
  it('defaults to a when nothing is set', () => {
    delete process.env['HOME_VARIANT']
    const r = resolveHomeVariant(req('https://xdipx.com/'))
    expect(r).toEqual({ variant: 'a', source: 'default' })
  })

  it('reads HOME_VARIANT env var', () => {
    process.env['HOME_VARIANT'] = 'b'
    const r = resolveHomeVariant(req('https://xdipx.com/'))
    expect(r).toEqual({ variant: 'b', source: 'env' })
  })

  it('honors the cookie over env', () => {
    process.env['HOME_VARIANT'] = 'a'
    const r = resolveHomeVariant(req('https://xdipx.com/', {
      cookie: `${HOME_VARIANT_COOKIE}=b`,
    }))
    expect(r).toEqual({ variant: 'b', source: 'cookie' })
  })

  it('honors the query param over cookie + env', () => {
    process.env['HOME_VARIANT'] = 'a'
    const r = resolveHomeVariant(req('https://xdipx.com/?variant=b', {
      cookie: `${HOME_VARIANT_COOKIE}=a`,
    }))
    expect(r).toEqual({ variant: 'b', source: 'query' })
  })

  it('rejects an invalid variant value', () => {
    delete process.env['HOME_VARIANT']
    const r = resolveHomeVariant(req('https://xdipx.com/?variant=z'))
    expect(r).toEqual({ variant: 'a', source: 'default' })
  })

  it('rejects an invalid env value', () => {
    process.env['HOME_VARIANT'] = 'banana'
    const r = resolveHomeVariant(req('https://xdipx.com/'))
    expect(r).toEqual({ variant: 'a', source: 'default' })
  })
})

describe('pinHomeVariantCookie', () => {
  it('builds a SameSite=Lax cookie with 60-day TTL', () => {
    const c = pinHomeVariantCookie('b')
    expect(c).toContain(`${HOME_VARIANT_COOKIE}=b`)
    expect(c).toMatch(/Path=\//)
    expect(c).toMatch(/Max-Age=5184000/)
    expect(c).toMatch(/SameSite=Lax/)
  })
})
