/**
 * Unit cover for the Reddit Ads OAuth helpers.
 *
 * The three things that actually break a Reddit handshake, all of them silent:
 *   - a missing duration=permanent, which yields an access token and no refresh token
 *   - a redirect_uri that differs by one byte between authorize and exchange
 *   - a rejected grant, which Reddit answers with HTTP 200 and an {error} body
 *
 * The module reads env at import time, so every case re-imports it after stubbing.
 *
 * Lives in app/lib rather than beside the routes: anything under app/routes is picked
 * up by flatRoutes/typegen as a route module, tests included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadModule(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string)
  return import('~/lib/reddit-oauth.server')
}

const BASE_ENV = {
  REDDIT_CLIENT_ID:     'cid-123',
  REDDIT_CLIENT_SECRET: 'csecret-456',
  APP_URL:              'https://xdipx.com',
}

beforeEach(() => {
  vi.stubEnv('REDDIT_ADS_CLIENT_ID', '')
  vi.stubEnv('REDDIT_ADS_CLIENT_SECRET', '')
  vi.stubEnv('REDDIT_ADS_REDIRECT_URI', '')
  vi.stubEnv('REDDIT_ADS_SCOPES', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getRedditAuthUrl', () => {
  it('requests a permanent grant with the read-only scope by default', async () => {
    const mod = await loadModule(BASE_ENV)
    const url = new URL(mod.getRedditAuthUrl('https://xdipx.com/api/reddit-callback', 'st8'))

    expect(url.origin + url.pathname).toBe('https://www.reddit.com/api/v1/authorize')
    expect(url.searchParams.get('duration')).toBe('permanent')
    expect(url.searchParams.get('scope')).toBe('adsread')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid-123')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('redirect_uri')).toBe('https://xdipx.com/api/reddit-callback')
  })

  it('normalizes a space-separated scope override to Reddit comma form', async () => {
    const mod = await loadModule({ ...BASE_ENV, REDDIT_ADS_SCOPES: 'adsread adsconversions' })
    const url = new URL(mod.getRedditAuthUrl('https://xdipx.com/api/reddit-callback', 's'))
    expect(url.searchParams.get('scope')).toBe('adsread,adsconversions')
  })

  it('falls back to the REDDIT_ADS_* names when they are set', async () => {
    const mod = await loadModule({ ...BASE_ENV, REDDIT_ADS_CLIENT_ID: 'ads-cid' })
    const url = new URL(mod.getRedditAuthUrl('https://xdipx.com/api/reddit-callback', 's'))
    expect(url.searchParams.get('client_id')).toBe('ads-cid')
  })
})

describe('redditRedirectUri', () => {
  it('prefers APP_URL over the request origin so a preview cannot mint an unregistered URI', async () => {
    const mod = await loadModule(BASE_ENV)
    const req = new Request('https://xdipx-git-preview.vercel.app/api/reddit-connect')
    expect(mod.redditRedirectUri(req)).toBe('https://xdipx.com/api/reddit-callback')
  })

  it('honours an explicit REDDIT_ADS_REDIRECT_URI', async () => {
    const mod = await loadModule({ ...BASE_ENV, REDDIT_ADS_REDIRECT_URI: 'https://alt.example/cb' })
    const req = new Request('https://xdipx.com/api/reddit-connect')
    expect(mod.redditRedirectUri(req)).toBe('https://alt.example/cb')
  })
})

describe('exchangeRedditCode', () => {
  it('posts the code with HTTP Basic auth and a descriptive User-Agent', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 'adsread', expires_in: 3600 }),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await loadModule(BASE_ENV)
    const tokens = await mod.exchangeRedditCode('the-code', 'https://xdipx.com/api/reddit-callback')

    expect(tokens).toEqual({
      accessToken: 'at', refreshToken: 'rt', scope: 'adsread', expiresIn: 3600,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.reddit.com/api/v1/access_token')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from('cid-123:csecret-456').toString('base64')}`)
    expect(headers['User-Agent']).toContain('xdipx')

    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('redirect_uri')).toBe('https://xdipx.com/api/reddit-callback')
  })

  it('throws on a rejected grant even though Reddit answers 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_grant' }), { status: 200 },
    )))
    const mod = await loadModule(BASE_ENV)
    await expect(mod.exchangeRedditCode('stale', 'https://xdipx.com/api/reddit-callback'))
      .rejects.toThrow(/invalid_grant/)
  })

  it('reports a non-200 with the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const mod = await loadModule(BASE_ENV)
    await expect(mod.exchangeRedditCode('c', 'https://xdipx.com/api/reddit-callback'))
      .rejects.toThrow(/401/)
  })

  it('surfaces a missing refresh token as null rather than inventing one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 },
    )))
    const mod = await loadModule(BASE_ENV)
    const tokens = await mod.exchangeRedditCode('c', 'https://xdipx.com/api/reddit-callback')
    expect(tokens.refreshToken).toBeNull()
  })
})

describe('refreshRedditAccessToken', () => {
  it('uses the refresh_token grant', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'at2', scope: 'adsread', expires_in: 3600 }), { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await loadModule(BASE_ENV)
    const tokens = await mod.refreshRedditAccessToken('rt')

    expect(tokens.accessToken).toBe('at2')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
  })
})
