/**
 * Ticket #18252 (dedupeKey pricing-batch-stall, 100+ recurrences on
 * 2026-10-27): `kickContinuation()` used to fire its next slice with a bare
 * `void fetch(...)` and never awaited it at all, so the serverless instance
 * could freeze or be reclaimed before the request ever left the process,
 * silently dropping the rest of the day's walk. It now awaits a bounded
 * dispatch confirmation (`KICK_DISPATCH_TIMEOUT_MS`) instead. These tests
 * pin that behaviour without depending on real timers or network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { kickContinuation } from './cron.pricing-batch-recompute'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env['APP_URL'] = 'xdipx.com'
  process.env['CRON_SECRET'] = 'secret'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('kickContinuation', () => {
  it('awaits the dispatch and returns true on a normal response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await kickContinuation()

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://xdipx.com/cron/pricing-batch-recompute')
    expect(JSON.parse(String(init.body))).toEqual({ trigger: 'batch_continuation' })
    expect((init.headers as Record<string, string>)['x-cron-secret']).toBe('secret')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('still reports success when its own dispatch timeout fires (AbortError): the request already left', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortError }))

    const result = await kickContinuation()

    expect(result).toBe(true)
  })

  it('returns false when the request never goes out at all (DNS/connection failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))

    const result = await kickContinuation()

    expect(result).toBe(false)
  })

  it('returns false without calling fetch when APP_URL/CRON_SECRET are unavailable', async () => {
    delete process.env['APP_URL']
    delete process.env['CRON_SECRET']
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await kickContinuation()

    expect(result).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
