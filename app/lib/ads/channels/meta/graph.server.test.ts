import { describe, expect, it, vi } from 'vitest'
import { GraphError, createGraphClient, readBusinessUseCaseUsage } from './graph.server'

const TOKEN = 'EAAtest-secret-token'

type Reply = { status?: number; body: unknown; usage?: unknown }

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = replies.shift()
    if (!r) throw new Error('no more replies')
    const headers = new Headers()
    if (r.usage !== undefined) headers.set('x-business-use-case-usage', JSON.stringify(r.usage))
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const usage = (n: number, regain = 0) => ({ '123': [{ type: 'ads_management', call_count: n, total_cputime: 1, total_time: 1, estimated_time_to_regain_access: regain }] })

function client(replies: Reply[]) {
  const f = fakeFetch(replies)
  const sleep = vi.fn(async (_ms: number) => {})
  const c = createGraphClient({ fetchImpl: f.impl, sleep, token: () => TOKEN, baseDelayMs: 100, usageBackoffMs: 2000 })
  return { c, sleep, calls: f.calls }
}

describe('Graph client', () => {
  it('sends the token as a Bearer header on v23.0 and never in the URL', async () => {
    const { c, calls } = client([{ body: { id: '1' } }])
    await c.get('act_1/campaigns', { fields: 'id,name', limit: 5 })
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/act_1/campaigns?fields=id%2Cname&limit=5')
    expect(calls[0]!.url).not.toContain(TOKEN)
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('retries a 429 with exponential backoff, then returns', async () => {
    const { c, sleep, calls } = client([
      { status: 429, body: { error: { message: 'slow down' } } },
      { status: 429, body: { error: { message: 'slow down' } } },
      { body: { ok: true } },
    ])
    await expect(c.get('me')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(3)
    expect(sleep.mock.calls.map(a => a[0])).toEqual([100, 200])
  })

  it('retries Graph error code 17 (user request limit) and gives up as rate_limited', async () => {
    const throttled = { status: 400, body: { error: { message: 'User request limit reached', code: 17 } } }
    const { c, sleep, calls } = client([throttled, throttled, throttled, throttled])
    const err = await c.get('me').catch(e => e)
    expect(err).toBeInstanceOf(GraphError)
    expect(err.kind).toBe('rate_limited')
    expect(err.detail.code).toBe(17)
    expect(calls).toHaveLength(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('retries codes 4, 32 and 613 too', async () => {
    for (const code of [4, 32, 613]) {
      const { c, calls } = client([{ status: 400, body: { error: { message: 'x', code } } }, { body: { ok: code } }])
      await expect(c.get('me')).resolves.toEqual({ ok: code })
      expect(calls).toHaveLength(2)
    }
  })

  it('does not retry an ordinary error', async () => {
    const { c, sleep, calls } = client([{ status: 400, body: { error: { message: 'Invalid parameter', code: 100 } } }])
    const err = await c.get('me').catch(e => e)
    expect(err.kind).toBe('api_error')
    expect(calls).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('sleeps before returning when usage is above 75', async () => {
    const { c, sleep, calls } = client([{ body: { ok: true }, usage: usage(80) }])
    await expect(c.get('me')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('does not sleep at or under 75', async () => {
    const { c, sleep } = client([{ body: { ok: true }, usage: usage(75) }])
    await c.get('me')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('sleeps then retries once when a failed call reports usage above 75', async () => {
    const { c, sleep, calls } = client([
      { status: 400, body: { error: { message: 'temporary', code: 2 } }, usage: usage(90) },
      { status: 400, body: { error: { message: 'temporary', code: 2 } }, usage: usage(90) },
    ])
    const err = await c.get('me').catch(e => e)
    expect(err.kind).toBe('api_error')
    expect(calls).toHaveLength(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('uses Meta\'s regain estimate, capped at the sleep ceiling', async () => {
    const { c, sleep } = client([{ body: { ok: true }, usage: usage(99, 10) }])
    await c.get('me')
    expect(sleep).toHaveBeenCalledWith(30_000)
  })

  it('redacts the token from error messages', async () => {
    const { c } = client([{ status: 400, body: { error: { message: `bad token ${TOKEN}`, code: 190 } } }])
    const err = await c.get('debug_token', { input_token: TOKEN }).catch(e => e)
    expect(err.message).not.toContain(TOKEN)
    expect(err.message).toContain('[redacted]')
  })

  it('refuses with not_configured when there is no token, without calling fetch', async () => {
    const f = fakeFetch([])
    const c = createGraphClient({ fetchImpl: f.impl, token: () => null })
    const err = await c.get('me').catch(e => e)
    expect(err.kind).toBe('not_configured')
    expect(f.calls).toHaveLength(0)
  })

  it('posts a JSON body', async () => {
    const { c, calls } = client([{ body: { id: '9' } }])
    await c.post('act_1/campaigns', { name: 'x', status: 'PAUSED', special_ad_categories: [] })
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: 'x', status: 'PAUSED', special_ad_categories: [] })
  })

  it('follows cursor paging in getAll', async () => {
    const { c, calls } = client([
      { body: { data: [{ id: '1' }], paging: { cursors: { after: 'C1' }, next: 'https://graph.facebook.com/next' } } },
      { body: { data: [{ id: '2' }], paging: { cursors: { after: 'C2' } } } },
    ])
    await expect(c.getAll('act_1/ads', { limit: 1 })).resolves.toEqual([{ id: '1' }, { id: '2' }])
    expect(calls[1]!.url).toContain('after=C1')
  })
})

describe('readBusinessUseCaseUsage', () => {
  it('takes the peak across metrics and entries', () => {
    const h = JSON.stringify({ a: [{ call_count: 10, total_cputime: 81, total_time: 3 }], b: [{ call_count: 40, estimated_time_to_regain_access: 2 }] })
    expect(readBusinessUseCaseUsage(h)).toEqual({ peak: 81, regainMinutes: 2 })
  })

  it('returns null for a missing or broken header', () => {
    expect(readBusinessUseCaseUsage(null)).toBeNull()
    expect(readBusinessUseCaseUsage('{nope')).toBeNull()
  })
})
