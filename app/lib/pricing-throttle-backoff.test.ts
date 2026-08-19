/**
 * Ticket #4213 — the 07:00 UTC pricing batch recompute threw "Throttled" and
 * wrote no pricing rows.
 *
 * bulkFetchProductsForPricing reads every page up front, so one page that stays
 * throttled after every short retry throws all the way out of recomputeCatalog
 * before a single row is written. The layers were all capping their throttle
 * wait at 5s and giving up before Shopify's leaky bucket could refill. The fix:
 * adminGraphQL throws a typed ShopifyThrottleError carrying Shopify's own refill
 * estimate, and the pricing fetch rests that real amount (capped) in one go.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  shopifyThrottleRefillMs,
  pricingThrottleWaitMs,
  ShopifyThrottleError,
  adminGraphQL,
} from './shopify.server'

const respond = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response

const throttledBody = (currentlyAvailable: number, restoreRate: number, requestedQueryCost: number) => ({
  data: null,
  errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
  extensions: { cost: { requestedQueryCost, throttleStatus: { currentlyAvailable, restoreRate } } },
})

describe('shopifyThrottleRefillMs', () => {
  it('computes the ms to refill the shortfall at the restore rate', () => {
    // Need 100, have 10 → shortfall 90; at 50/s that is 1800ms.
    expect(shopifyThrottleRefillMs({ requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 10, restoreRate: 50 } }))
      .toBe(1800)
  })

  it('is 0 when Shopify omits the rates (caller falls back to its own backoff)', () => {
    expect(shopifyThrottleRefillMs(undefined)).toBe(0)
    expect(shopifyThrottleRefillMs({ requestedQueryCost: 100 })).toBe(0)
    // No shortfall (enough already available) → nothing to wait for.
    expect(shopifyThrottleRefillMs({ requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 50, restoreRate: 50 } }))
      .toBe(0)
  })
})

describe('pricingThrottleWaitMs', () => {
  it('honors Shopify\'s refill estimate when it exceeds the escalating floor', () => {
    // attempt 1 floor is 5000ms; a 12s refill hint wins.
    expect(pricingThrottleWaitMs(12_000, 1)).toBe(12_000)
  })

  it('floors a missing or short hint with an escalating rest', () => {
    expect(pricingThrottleWaitMs(0, 1)).toBe(5_000)
    expect(pricingThrottleWaitMs(0, 3)).toBe(15_000)
    expect(pricingThrottleWaitMs(2_000, 2)).toBe(10_000) // hint below floor → floor wins
  })

  it('caps one page\'s rest so a pathological throttle cannot eat the cron budget', () => {
    expect(pricingThrottleWaitMs(120_000, 1)).toBe(30_000)
    expect(pricingThrottleWaitMs(0, 10)).toBe(30_000) // escalating would be 50s, capped at 30s
  })
})

describe('ShopifyThrottleError', () => {
  it('is an Error, preserves the message, and carries the refill estimate', () => {
    const err = new ShopifyThrottleError('Throttled', 1800)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Throttled')
    expect(err.retryAfterMs).toBe(1800)
    // Callers that still match on the message keep working.
    expect(/throttl/i.test(err.message)).toBe(true)
  })
})

describe('adminGraphQL throttle handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('throws a ShopifyThrottleError carrying the refill estimate once short retries are spent', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => respond(throttledBody(10, 50, 100))))
    const p = adminGraphQL('query { x }').catch((e) => e)
    await vi.runAllTimersAsync()
    const err = await p
    expect(err).toBeInstanceOf(ShopifyThrottleError)
    expect((err as ShopifyThrottleError).retryAfterMs).toBe(1800)
  })

  it('recovers when the throttle clears within the short retries', async () => {
    vi.useFakeTimers()
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      return call === 1
        ? respond(throttledBody(10, 50, 100))
        : respond({ data: { ok: true } })
    }))
    const p = adminGraphQL<{ ok: boolean }>('query { x }')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toEqual({ ok: true })
  })
})
