/**
 * Ticket #13115 — the REST Admin API helper (`shopifyAdmin`, used by
 * `updateVariantPricing` among others) had no 429 retry at all, unlike
 * `adminGraphQL` in the same file. Under batch pricing-apply volume this
 * turned a transient rate limit into a silently dropped price update: the
 * catch in pricing-apply-v2.server.ts parked the audit row as 'pending', and
 * the next day's recompute superseded it as 'rejected' without ever applying
 * the price. Mirrors adminGraphQL's short-retry shape (Retry-After honored,
 * capped wait, a few attempts) rather than inventing a new one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { shopifyAdmin } from './shopify.server'

const respond = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

describe('shopifyAdmin 429 retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('retries a 429 honoring Retry-After and returns the eventual success', async () => {
    vi.useFakeTimers()
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      return call === 1
        ? respond({}, 429, { 'retry-after': '1' })
        : respond({ variant: { id: '123' } }, 200)
    }))
    const p = shopifyAdmin<{ variant: { id: string } }>('/variants/123.json', 'PUT', { variant: {} })
    await vi.runAllTimersAsync()
    await expect(p).resolves.toEqual({ variant: { id: '123' } })
    expect(call).toBe(2)
  })

  it('gives up after the attempt ceiling and throws a diagnosable error', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => respond({ errors: 'Too Many Requests' }, 429)))
    const p = shopifyAdmin('/variants/123.json', 'PUT', { variant: {} }).catch(e => e)
    await vi.runAllTimersAsync()
    const err = await p
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/429/)
  })

  it('does not retry a non-429 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ errors: { title: ['bad'] } }, 422)))
    await expect(shopifyAdmin('/products/1.json', 'PUT', {})).rejects.toThrow(/422/)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})
