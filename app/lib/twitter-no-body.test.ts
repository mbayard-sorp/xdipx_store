// The X endpoints that answer a 200 with an EMPTY BODY.
//
// `media/metadata/create.json` is one, and parsing its response as JSON threw
// `Unexpected end of JSON input` on a request X had accepted. Because the throw
// came from `res.json()` (downstream of the `res.ok` check) the alt text was in
// fact being set, and every X post since alt text shipped carried a false
// `Alt text failed, published without it: ...` note into its run event.
//
// These tests sit at the `fetch` boundary, which `social-publish/x.server.test.ts`
// mocks past: that file mocks `~/lib/twitter.server` wholesale, so nothing
// covered the response handling inside it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { setMediaAltText, deleteTweet, postTweet } from './twitter.server'

/** A Response whose body is the empty string, as the upload host really sends. */
function emptyBody(status = 200): Response {
  return new Response('', { status, statusText: 'OK' })
}

describe('X calls that expect no response body', () => {
  beforeEach(() => {
    vi.stubEnv('X_API_KEY', 'k')
    vi.stubEnv('X_API_SECRET', 's')
    vi.stubEnv('X_ACCESS_TOKEN', 't')
    vi.stubEnv('X_ACCESS_TOKEN_SECRET', 'ts')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('setMediaAltText succeeds on a 200 with an empty body', async () => {
    const fetchMock = vi.fn(async () => emptyBody(200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await setMediaAltText('media-1', 'a bottle of lube on a nightstand')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://upload.x.com/1.1/media/metadata/create.json')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      media_id: 'media-1',
      alt_text: { text: 'a bottle of lube on a nightstand' },
    })
  })

  it('setMediaAltText caps alt text at 1000 characters', async () => {
    const fetchMock = vi.fn(async () => emptyBody(200))
    vi.stubGlobal('fetch', fetchMock)

    await setMediaAltText('media-1', 'x'.repeat(1200))

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).alt_text.text).toHaveLength(1000)
  })

  it('setMediaAltText still reports a real failure, and names the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"errors":[{"message":"bad media id"}]}', { status: 400 })))

    const result = await setMediaAltText('media-1', 'alt')

    expect(result.ok).toBe(false)
    expect((result as { ok: false; detail: string }).detail).toContain('400')
    expect((result as { ok: false; detail: string }).detail).toContain('bad media id')
  })

  it('deleteTweet succeeds on a 200 with an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyBody(200)))
    await expect(deleteTweet('123')).resolves.toBeUndefined()
  })

  it('deleteTweet still throws on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(deleteTweet('123')).rejects.toThrow(/404/)
  })
})

describe('X calls whose body is the point', () => {
  beforeEach(() => {
    vi.stubEnv('X_API_KEY', 'k')
    vi.stubEnv('X_API_SECRET', 's')
    vi.stubEnv('X_ACCESS_TOKEN', 't')
    vi.stubEnv('X_ACCESS_TOKEN_SECRET', 'ts')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('postTweet returns the id from a normal response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: '999', text: 'hi' } }), { status: 201 })))

    await expect(postTweet('hi')).resolves.toEqual({ id: '999', text: 'hi' })
  })

  // The other half of the fix: relaxing the empty-body case must NOT be done in
  // the shared parser, or a tweet with no id would resolve as a successful post
  // and reach a row marked posted with `externalPostId: undefined`.
  it('postTweet throws rather than resolving empty when the body will not parse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyBody(200)))

    await expect(postTweet('hi')).rejects.toThrow()
  })
})
