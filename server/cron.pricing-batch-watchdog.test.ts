/**
 * Backstop for the pricing batch recompute's self-continuation chain
 * (ticket: pricing-batch-continuation-chain-dies-silently, 2026-09-26).
 *
 * `kickContinuation()` in cron.pricing-batch-recompute.ts fires the next
 * slice with an un-awaited `fetch` from a function about to return, so the
 * serverless instance can freeze before the request is ever dispatched. The
 * watchdog below is a separately-scheduled, independently-testable backstop:
 * it reads the same durable cursor checkpoint, and when the day is undone and
 * stale, alerts the owner once and resumes the walk with a normally-awaited
 * request. These tests pin that behaviour without depending on real timers,
 * network, or the database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getPricingBatchCursorAgeMs = vi.fn<(day: string) => Promise<number | null>>()
const utcDay = vi.fn(() => '2026-09-26')

vi.mock('../app/lib/pricing-apply-v2.server.js', () => ({
  utcDay,
  getPricingBatchCursorAgeMs,
}))

const kvSetNX = vi.fn<(key: string, value: string, ttl: number) => Promise<boolean>>()
vi.mock('../app/lib/kv.server.js', () => ({ kvSetNX }))

const captureMessage = vi.fn()
vi.mock('../app/lib/sentry.server.js', () => ({ Sentry: { captureMessage } }))

const fileDetectionTicket = vi.fn(async () => 1)
vi.mock('../app/lib/detection-tickets.server.js', () => ({
  fileDetectionTicket,
  makeDedupeKey: (...parts: unknown[]) => parts.join(':'),
  priorityFromSeverity: () => 1,
}))

const sendOwnerEmail = vi.fn(async () => undefined)
vi.mock('../app/lib/owner-alerts.server.js', () => ({
  sendOwnerEmail,
  escapeHtml: (s: string) => s,
}))

import { handlePricingBatchWatchdog } from './cron.pricing-batch-recompute'

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body; return this },
  }
  return res
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env['APP_URL'] = 'xdipx.com'
  process.env['CRON_SECRET'] = 'secret'
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('handlePricingBatchWatchdog', () => {
  it('no-ops when there is no checkpoint to watch (nothing started, or already done)', async () => {
    getPricingBatchCursorAgeMs.mockResolvedValue(null)
    const res = fakeRes()
    await handlePricingBatchWatchdog({} as never, res as never)
    expect(res.body).toMatchObject({ ok: true, skipped: 'not-stalled' })
    expect(kvSetNX).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no-ops when the checkpoint is fresh (still walking, normal cadence)', async () => {
    getPricingBatchCursorAgeMs.mockResolvedValue(5 * 60_000) // 5 min, under the 20 min threshold
    const res = fakeRes()
    await handlePricingBatchWatchdog({} as never, res as never)
    expect(res.body).toMatchObject({ ok: true, skipped: 'fresh' })
    expect(kvSetNX).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('alerts and resumes when the checkpoint is stale past the threshold', async () => {
    getPricingBatchCursorAgeMs.mockResolvedValue(25 * 60_000) // 25 min, over the 20 min threshold
    kvSetNX.mockResolvedValue(true) // first alert of the day
    const res = fakeRes()
    await handlePricingBatchWatchdog({} as never, res as never)

    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(fileDetectionTicket).toHaveBeenCalledTimes(1)
    expect(sendOwnerEmail).toHaveBeenCalledTimes(1)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://xdipx.com/cron/pricing-batch-recompute')
    expect(JSON.parse(String(init.body))).toEqual({ trigger: 'batch_continuation' })
    expect((init.headers as Record<string, string>)['x-cron-secret']).toBe('secret')

    expect(res.body).toMatchObject({ ok: true, stalled: true, alerted: true, resumed: true })
  })

  it('resumes without re-alerting once the day has already been alerted', async () => {
    getPricingBatchCursorAgeMs.mockResolvedValue(45 * 60_000)
    kvSetNX.mockResolvedValue(false) // kvSetNX(NX) fails: another tick already set the flag today
    const res = fakeRes()
    await handlePricingBatchWatchdog({} as never, res as never)

    expect(captureMessage).not.toHaveBeenCalled()
    expect(fileDetectionTicket).not.toHaveBeenCalled()
    expect(sendOwnerEmail).not.toHaveBeenCalled()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(res.body).toMatchObject({ ok: true, stalled: true, alerted: false, resumed: true })
  })

  it('reports resumed:false without throwing when APP_URL/CRON_SECRET are unavailable', async () => {
    getPricingBatchCursorAgeMs.mockResolvedValue(30 * 60_000)
    kvSetNX.mockResolvedValue(true)
    delete process.env['APP_URL']
    delete process.env['CRON_SECRET']
    const res = fakeRes()
    await handlePricingBatchWatchdog({} as never, res as never)

    expect(fetch).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ ok: true, stalled: true, resumed: false })
  })
})
