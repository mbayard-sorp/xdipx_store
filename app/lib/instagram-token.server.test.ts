// Instagram Graph API access-token auto-refresh (ticket #13153, owner-away
// all-hands 2026-10-02). Mocks the db client (same chain-proxy convention as
// app/lib/social-publish/instagram-comments.server.test.ts): the db here is
// PRODUCTION, so nothing in this file may reach it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** FIFO of rows handed to successive db.select() chains. */
    selects: [] as unknown[][],
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
      () => [],
      (m, args) => { if (m === 'values') state.insertedValues.push(args[0]) },
    ),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))

import {
  getInstagramAccessToken,
  refreshInstagramAccessToken,
  checkInstagramTokenExpiryWarning,
  EXPIRY_WARNING_DAYS,
  STALE_REFRESH_DAYS,
} from './instagram-token.server'

const DAY_MS = 24 * 60 * 60 * 1000

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

function successRow(overrides: Partial<{ accessToken: string; expiresAt: Date; attemptedAt: Date }> = {}) {
  return [{
    accessToken: overrides.accessToken ?? 'db-stored-token',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * DAY_MS),
    success: true,
    attemptedAt: overrides.attemptedAt ?? new Date(),
  }]
}

beforeEach(() => {
  h.state.selects = []
  h.state.insertedValues = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getInstagramAccessToken', () => {
  it('DB-hit: returns the newest successfully-refreshed token, never touching env', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'env-token')
    h.state.selects.push(successRow({ accessToken: 'db-token' }))

    expect(await getInstagramAccessToken()).toBe('db-token')
  })

  it('DB-miss: falls back to the env var when no refresh has ever succeeded', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'env-token')
    h.state.selects.push([])

    expect(await getInstagramAccessToken()).toBe('env-token')
  })

  it('DB-miss and no env var: returns null', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', '')
    h.state.selects.push([])

    expect(await getInstagramAccessToken()).toBeNull()
  })

  it('a DB read failure falls back to env rather than throwing', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'env-token')
    const originalSelect = h.db.select
    // Make the chain throw instead of resolving, to cover the catch path.
    h.db.select = () => { throw new Error('connection refused') }
    try {
      expect(await getInstagramAccessToken()).toBe('env-token')
    } finally {
      h.db.select = originalSelect
    }
  })
})

describe('refreshInstagramAccessToken', () => {
  it('fails closed, recording the attempt, when there is no current token to refresh', async () => {
    const result = await refreshInstagramAccessToken({ currentToken: async () => null })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no current Instagram token')
    expect(h.state.insertedValues).toHaveLength(1)
    expect(h.state.insertedValues[0]).toMatchObject({ success: false, accessToken: null })
  })

  it('records a successful refresh with the computed expiresAt', async () => {
    let capturedUrl = ''
    const fetchMock: typeof fetch = (async (input: string | URL | Request) => {
      capturedUrl = String(input)
      return jsonResponse({ access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 })
    }) as typeof fetch
    const before = Date.now()

    const result = await refreshInstagramAccessToken({ fetch: fetchMock, currentToken: async () => 'old-token' })

    expect(result.ok).toBe(true)
    expect(capturedUrl).toContain('grant_type=ig_refresh_token')
    expect(capturedUrl).toContain('access_token=old-token')
    expect(h.state.insertedValues).toHaveLength(1)
    const inserted = h.state.insertedValues[0] as { success: boolean; accessToken: string; expiresAt: Date }
    expect(inserted.success).toBe(true)
    expect(inserted.accessToken).toBe('new-token')
    expect(inserted.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5_184_000 * 1000 - 1000)
  })

  it('a non-2xx response records failure and never writes a token, leaving the old one in place', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'bad request' }, 400))

    const result = await refreshInstagramAccessToken({ fetch: fetchMock, currentToken: async () => 'old-token' })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('HTTP 400')
    expect(h.state.insertedValues).toHaveLength(1)
    expect(h.state.insertedValues[0]).toMatchObject({ success: false, accessToken: null, expiresAt: null })
  })

  it('an unrecognised response shape records failure rather than trusting a partial body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ token_type: 'bearer' })) // no access_token/expires_in

    const result = await refreshInstagramAccessToken({ fetch: fetchMock, currentToken: async () => 'old-token' })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('unrecognised response shape')
    expect(h.state.insertedValues[0]).toMatchObject({ success: false })
  })

  it('a network failure records failure without throwing', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ETIMEDOUT') })

    const result = await refreshInstagramAccessToken({ fetch: fetchMock, currentToken: async () => 'old-token' })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ETIMEDOUT')
    expect(h.state.insertedValues[0]).toMatchObject({ success: false })
  })

  it('never logs the token itself anywhere in a failure detail', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'bad request' }, 401))
    const result = await refreshInstagramAccessToken({ fetch: fetchMock, currentToken: async () => 'super-secret-token-value' })
    expect(result.detail).not.toContain('super-secret-token-value')
  })
})

describe('checkInstagramTokenExpiryWarning', () => {
  it('never warns when no refresh has ever succeeded (the cron-liveness floor owns that gap)', async () => {
    h.state.selects.push([])

    const result = await checkInstagramTokenExpiryWarning()
    expect(result).toEqual({ warn: false, reason: null, expiresAt: null, lastSuccessAt: null })
  })

  it('does not warn when the token is far from expiring and the last refresh was recent', async () => {
    h.state.selects.push(successRow({
      expiresAt: new Date(Date.now() + (EXPIRY_WARNING_DAYS + 20) * DAY_MS),
      attemptedAt: new Date(),
    }))

    const result = await checkInstagramTokenExpiryWarning()
    expect(result.warn).toBe(false)
  })

  it('warns when the stored expiry is under the warning window', async () => {
    h.state.selects.push(successRow({
      expiresAt: new Date(Date.now() + (EXPIRY_WARNING_DAYS - 2) * DAY_MS),
      attemptedAt: new Date(),
    }))

    const result = await checkInstagramTokenExpiryWarning()
    expect(result.warn).toBe(true)
    expect(result.reason).toContain('expires in')
  })

  it('warns when no refresh has succeeded in over STALE_REFRESH_DAYS, even with a distant expiry', async () => {
    h.state.selects.push(successRow({
      expiresAt: new Date(Date.now() + 50 * DAY_MS),
      attemptedAt: new Date(Date.now() - (STALE_REFRESH_DAYS + 3) * DAY_MS),
    }))

    const result = await checkInstagramTokenExpiryWarning()
    expect(result.warn).toBe(true)
    expect(result.reason).toContain('no successful refresh')
  })

  it('names both reasons when both apply', async () => {
    h.state.selects.push(successRow({
      expiresAt: new Date(Date.now() + 1 * DAY_MS),
      attemptedAt: new Date(Date.now() - (STALE_REFRESH_DAYS + 1) * DAY_MS),
    }))

    const result = await checkInstagramTokenExpiryWarning()
    expect(result.warn).toBe(true)
    expect(result.reason).toContain('expires in')
    expect(result.reason).toContain('no successful refresh')
  })
})
