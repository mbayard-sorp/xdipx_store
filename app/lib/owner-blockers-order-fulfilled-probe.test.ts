/**
 * The `order_fulfilled` probe runner (ticket #13155, paid-unfulfilled
 * watchdog). Separate from owner-blockers.test.ts for the same reason
 * owner-blockers-webhook-probe.test.ts is: this one needs the server module,
 * where the runner lives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROBES } from '~/lib/owner-blockers.server'

type Probe = { describe: (a: string) => string; run: (a: string) => Promise<boolean | null> }

describe('order_fulfilled runner', () => {
  const probe = () => (PROBES as unknown as Record<string, Probe>)['order_fulfilled']!
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it('is wired into PROBES and describes itself by order name only', () => {
    expect(probe()).toBeDefined()
    expect(typeof probe().run).toBe('function')
    expect(probe().describe('#1008|gid://shopify/Order/123'))
      .toBe('order #1008 is now fulfilled or cancelled')
  })

  it('returns null on a malformed arg with no gid half', async () => {
    await expect(probe().run('#1008')).resolves.toBeNull()
  })

  it('clears (true) once the order is fulfilled', async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ data: { order: { cancelledAt: null, displayFulfillmentStatus: 'FULFILLED' } } }),
      { status: 200 },
    )) as unknown as typeof fetch
    await expect(probe().run('#1008|gid://shopify/Order/123')).resolves.toBe(true)
  })

  it('clears (true) when the order was cancelled instead of fulfilled', async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ data: { order: { cancelledAt: '2026-10-08T00:00:00Z', displayFulfillmentStatus: 'UNFULFILLED' } } }),
      { status: 200 },
    )) as unknown as typeof fetch
    await expect(probe().run('#1008|gid://shopify/Order/123')).resolves.toBe(true)
  })

  it('stays blocked (false), never clears, while still unfulfilled', async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ data: { order: { cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED' } } }),
      { status: 200 },
    )) as unknown as typeof fetch
    await expect(probe().run('#1008|gid://shopify/Order/123')).resolves.toBe(false)
  })

  it('is a could-not-ask (null), never false, when the order cannot be found', async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ data: { order: null } }),
      { status: 200 },
    )) as unknown as typeof fetch
    await expect(probe().run('#1008|gid://shopify/Order/123')).resolves.toBeNull()
  })

  it('is a could-not-ask (null), never false, on a network error', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    await expect(probe().run('#1008|gid://shopify/Order/123')).resolves.toBeNull()
  })
})
