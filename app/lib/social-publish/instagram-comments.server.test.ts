// Instagram comment support lane, phase 1 (ticket #2027). Mocks the Graph
// API at the fetch layer (same convention as instagram.server.test.ts) and
// the db client (same chain-proxy convention as team-tickets.test.ts): the
// db here is PRODUCTION, so nothing in this file may reach it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } })
}

const h = vi.hoisted(() => {
  const state = {
    /** FIFO of rows handed to successive db.select() chains. */
    selects: [] as unknown[][],
    /** FIFO of rows handed to successive db.insert()...returning() chains. */
    insertReturns: [] as unknown[][],
    /** Every values() object passed to db.insert(), in order. */
    insertedValues: [] as unknown[],
  }

  function chain(result: () => unknown, onCall?: (m: string, args: unknown[]) => void) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(ok, err)
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args)
          return proxy
        }
      },
    }) as Record<string, unknown>
    return proxy
  }

  const db = {
    select: () => chain(() => state.selects.shift() ?? []),
    insert: () => chain(
      () => state.insertReturns.shift() ?? [],
      (m, args) => { if (m === 'values') state.insertedValues.push(args[0]) },
    ),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))

import {
  describeCommentsApiError,
  ingestRecentComments,
  postCommentReply,
} from './instagram-comments.server'

beforeEach(() => {
  h.state.selects = []
  h.state.insertReturns = []
  h.state.insertedValues = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('describeCommentsApiError', () => {
  it('names the instagram_manage_comments scope on a missing-permission error (code 10)', () => {
    const msg = describeCommentsApiError({ message: 'Application does not have permission', code: 10 })
    expect(msg).toContain('instagram_manage_comments')
    expect(msg).toContain('Meta App Dashboard')
  })

  it('names the scope on code 200 / subcode 33', () => {
    const msg = describeCommentsApiError({ code: 200, error_subcode: 33 })
    expect(msg).toContain('instagram_manage_comments')
  })

  it('falls back to the publisher-shared message for an expired token (code 190)', () => {
    const msg = describeCommentsApiError({ message: 'Session expired', code: 190 })
    expect(msg).toContain('IG_GRAPH_ACCESS_TOKEN is expired or revoked')
    expect(msg).not.toContain('instagram_manage_comments')
  })
})

describe('ingestRecentComments', () => {
  it('degrades to a clear detail, no crash, when the token is not configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestRecentComments()

    expect(result).toEqual({ ok: false, postsChecked: 0, fetched: 0, inserted: 0, detail: 'IG_GRAPH_ACCESS_TOKEN is not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports zero work when there are no recent Instagram posts', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    h.state.selects.push([]) // recentInstagramMediaIds
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await ingestRecentComments()

    expect(result).toEqual({ ok: true, postsChecked: 0, fetched: 0, inserted: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches comments for each recent post and upserts new ones', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    h.state.selects.push([{ externalPostId: 'media-1' }, { externalPostId: 'media-2' }])
    // media-1: two comments, both new (insert returns a row each time)
    // media-2: one comment, already seen (onConflictDoNothing -> empty return)
    h.state.insertReturns.push([{ id: 1 }], [{ id: 2 }], [])

    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/media-1/comments')) {
        return jsonResponse({
          data: [
            { id: 'c1', text: 'love this', username: 'alice', timestamp: '2026-09-01T00:00:00Z' },
            { id: 'c2', text: 'does this ship to CA?', username: 'bob', timestamp: '2026-09-01T01:00:00Z' },
          ],
        })
      }
      if (url.pathname.endsWith('/media-2/comments')) {
        return jsonResponse({ data: [{ id: 'c3', text: 'already ingested', username: 'carol' }] })
      }
      throw new Error(`unexpected fetch: ${url.pathname}`)
    }))

    const result = await ingestRecentComments()

    expect(result).toEqual({ ok: true, postsChecked: 2, fetched: 3, inserted: 2 })
    expect(h.state.insertedValues).toHaveLength(3)
    expect((h.state.insertedValues[0] as { externalCommentId: string }).externalCommentId).toBe('c1')
    expect((h.state.insertedValues[0] as { text: string }).text).toBe('love this')
  })

  it('reports a scope error in `detail` without throwing', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    h.state.selects.push([{ externalPostId: 'media-1' }])
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: { message: 'Missing permission', code: 10 } }),
    ))

    const result = await ingestRecentComments()

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('instagram_manage_comments')
    expect(result.postsChecked).toBe(1)
  })
})

describe('postCommentReply', () => {
  it('posts the reply and returns the new comment id', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toMatch(/\/c1\/replies$/)
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('message')).toBe('Thanks for asking!')
      return jsonResponse({ id: 'reply-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postCommentReply('c1', 'Thanks for asking!')

    expect(result).toEqual({ ok: true, externalReplyId: 'reply-1' })
  })

  it('refuses to send an empty reply without calling the API', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await postCommentReply('c1', '   ')

    expect(result).toEqual({ ok: false, detail: 'Reply text is empty' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('degrades to a clear detail when the token is not configured', async () => {
    const result = await postCommentReply('c1', 'hi')
    expect(result).toEqual({ ok: false, detail: 'IG_GRAPH_ACCESS_TOKEN is not configured' })
  })

  it('surfaces a Graph API error via describeCommentsApiError', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: { message: 'Session expired', code: 190 } }),
    ))

    const result = await postCommentReply('c1', 'hi')

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('IG_GRAPH_ACCESS_TOKEN is expired or revoked')
  })
})
