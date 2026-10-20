import { describe, expect, it, vi } from 'vitest'
import { EXO_BASE, ExoClickError, createExoClient, encodeExoParams, exoApiKeyFromEnv } from './client.server'

const KEY = 'exo-secret-key-123'

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

const loginBody = (token: string, expiresIn = 43199) => ({
  token, type: 'Bearer', expires_in: expiresIn, refresh_token: 'r', refresh_token_expires_in: 86400,
})

/** A fetch that answers /login with tokens tok-1, tok-2, ... and hands every other call to `onGet`. */
function fakeFetch(onGet: (url: string, auth: string) => Response, loginRes?: () => Response) {
  let logins = 0
  const calls: Array<{ url: string; method: string; auth: string; body: string | null }> = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const auth = headers['authorization'] ?? ''
    calls.push({ url, method: init?.method ?? 'GET', auth, body: (init?.body as string | undefined) ?? null })
    if (url === `${EXO_BASE}/login`) {
      logins++
      return loginRes ? loginRes() : jsonRes(200, loginBody(`tok-${logins}`))
    }
    return onGet(url, auth)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, logins: () => logins }
}

describe('exoApiKeyFromEnv', () => {
  it('reads EXOCLICK_API_KEY and treats blank as unset', () => {
    expect(exoApiKeyFromEnv({ EXOCLICK_API_KEY: ' k ' } as NodeJS.ProcessEnv)).toBe('k')
    expect(exoApiKeyFromEnv({ EXOCLICK_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBeNull()
    expect(exoApiKeyFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('encodeExoParams', () => {
  it('drops nulls and repeats arrays as key[]', () => {
    expect(encodeExoParams({ 'date-from': '2026-10-19', limit: 5, a: null, b: undefined, ids: [1, 2] }))
      .toBe('date-from=2026-10-19&limit=5&ids%5B%5D=1&ids%5B%5D=2')
  })
})

describe('createExoClient', () => {
  it('logs in with the api key as JSON and sends the bearer on reads', async () => {
    const f = fakeFetch(() => jsonRes(200, { result: [], request_metadata: { limit: 5, offset: 0, count: 0 } }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0 })
    const json = await c.get('campaigns', { limit: 5 })
    expect(json).toEqual({ result: [], request_metadata: { limit: 5, offset: 0, count: 0 } })
    expect(f.calls[0]).toMatchObject({ url: `${EXO_BASE}/login`, method: 'POST' })
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ api_token: KEY })
    expect(f.calls[1]).toMatchObject({ url: `${EXO_BASE}/campaigns?limit=5`, auth: 'Bearer tok-1' })
  })

  it('caches the session until expires_in minus a minute, then logs in again', async () => {
    let t = 0
    const f = fakeFetch(() => jsonRes(200, { result: [] }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => t })
    const s1 = await c.session()
    expect(s1.expiresAtMs).toBe((43199 - 60) * 1000)
    await c.get('campaigns')
    t = (43199 - 61) * 1000
    await c.get('campaigns')
    expect(f.logins()).toBe(1)
    t = (43199 - 60) * 1000
    const s2 = await c.session()
    expect(s2.token).toBe('tok-2')
    expect(f.logins()).toBe(2)
  })

  it('shares one login between parallel cold reads', async () => {
    const f = fakeFetch(() => jsonRes(200, { result: [] }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0 })
    await Promise.all([c.get('a'), c.get('b'), c.get('c')])
    expect(f.logins()).toBe(1)
  })

  it('re-logs in once on a 401 and retries the read with the new token', async () => {
    const f = fakeFetch((_url, auth) => (auth === 'Bearer tok-1' ? jsonRes(401, { message: 'expired' }) : jsonRes(200, { result: [1] })))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0 })
    expect(await c.get('campaigns')).toEqual({ result: [1] })
    expect(f.logins()).toBe(2)
    expect(f.calls.filter(x => !x.url.endsWith('/login')).map(x => x.auth)).toEqual(['Bearer tok-1', 'Bearer tok-2'])
  })

  it('gives up after one re-login when the new token is refused too', async () => {
    const f = fakeFetch(() => jsonRes(401, { message: 'nope' }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0 })
    await expect(c.get('campaigns')).rejects.toMatchObject({ name: 'ExoClickError', kind: 'token_rejected' })
    expect(f.logins()).toBe(2)
  })

  it('retries 429 and 5xx with backoff, honouring Retry-After', async () => {
    const answers = [jsonRes(429, {}, { 'retry-after': '2' }), jsonRes(503, {}), jsonRes(200, { result: ['ok'] })]
    const f = fakeFetch(() => answers.shift()!)
    const sleeps: number[] = []
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0, sleep: async ms => { sleeps.push(ms) }, baseDelayMs: 100 })
    expect(await c.get('statistics/a/variation')).toEqual({ result: ['ok'] })
    expect(sleeps).toEqual([2000, 200])
  })

  it('stops retrying after maxRetries and reports rate_limited', async () => {
    const f = fakeFetch(() => jsonRes(429, { message: 'slow down' }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0, sleep: async () => {}, maxRetries: 2 })
    await expect(c.get('x')).rejects.toMatchObject({ kind: 'rate_limited', detail: { status: 429 } })
  })

  it('throws not_configured without calling ExoClick when the key is missing', async () => {
    const f = fakeFetch(() => jsonRes(200, {}))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => null })
    await expect(c.session()).rejects.toMatchObject({ kind: 'not_configured' })
    expect(f.calls).toHaveLength(0)
  })

  it('maps a refused login to token_rejected', async () => {
    const f = fakeFetch(() => jsonRes(200, {}), () => jsonRes(403, { message: 'Incorrect access details' }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY })
    await expect(c.session()).rejects.toMatchObject({ kind: 'token_rejected', detail: { status: 403 } })
  })

  it('never puts the key or the token in an error message', async () => {
    const f = fakeFetch(
      () => jsonRes(400, { message: `bad request for tok-1 and ${KEY}` }),
    )
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY, now: () => 0 })
    const err = await c.get('x').catch(e => e as ExoClickError)
    expect(err).toBeInstanceOf(ExoClickError)
    expect(err.message).not.toContain('tok-1')
    expect(err.message).not.toContain(KEY)
    expect(err.message).toContain('[redacted]')

    const net = createExoClient({
      fetchImpl: (async () => { throw new TypeError(`connect failed ${KEY}`) }) as unknown as typeof fetch,
      apiKey: () => KEY,
    })
    const nerr = (await net.session().catch(e => e)) as ExoClickError
    expect(nerr.kind).toBe('network')
    expect(nerr.message).not.toContain(KEY)
  })

  it('rejects a login answer with no token as bad_response', async () => {
    const f = fakeFetch(() => jsonRes(200, {}), () => jsonRes(200, { type: 'Bearer' }))
    const c = createExoClient({ fetchImpl: f.fetchImpl, apiKey: () => KEY })
    await expect(c.session()).rejects.toMatchObject({ kind: 'bad_response' })
  })
})
