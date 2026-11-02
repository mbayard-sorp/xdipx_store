/**
 * Resolves a fulfilled order's email/line-items from a mocked Klaviyo
 * Events API response (ticket #19525) — no live network call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMetricIdByName, resolveFulfilledOrderEmail } from './klaviyo-order-email.server'

const METRICS_PAGE = {
  data: [
    { id: 'QRamTi', attributes: { name: 'Active on Site' } },
    { id: 'WMB9hY', attributes: { name: 'Fulfilled Order' } },
  ],
  links: { next: null },
}

function eventsPage(matchOrderId: string | null) {
  return {
    data: matchOrderId
      ? [
          {
            id: 'evt_1',
            attributes: { event_properties: { id: matchOrderId, line_items: [{ sku: 'SKU-A', product_id: 1001 }] } },
            relationships: { profile: { data: { id: 'prof_1' } } },
          },
        ]
      : [],
    included: matchOrderId
      ? [{ type: 'profile', id: 'prof_1', attributes: { email: 'buyer@example.com', first_name: 'Jordan', last_name: 'Rivera' } }]
      : [],
    links: { next: null },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const realFetch = global.fetch

beforeEach(() => {
  process.env['KLAVIYO_API_KEY'] = 'test-key'
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe('getMetricIdByName', () => {
  it('finds the metric id by exact name match', async () => {
    global.fetch = vi.fn(async () => jsonResponse(METRICS_PAGE)) as unknown as typeof fetch
    expect(await getMetricIdByName('Fulfilled Order')).toBe('WMB9hY')
  })

  it('returns null when no metric has that name', async () => {
    global.fetch = vi.fn(async () => jsonResponse(METRICS_PAGE)) as unknown as typeof fetch
    expect(await getMetricIdByName('Nonexistent Metric')).toBeNull()
  })
})

describe('resolveFulfilledOrderEmail', () => {
  it('returns the matching event\'s email, name, and line items', async () => {
    const calls: string[] = []
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/metrics/')) return jsonResponse(METRICS_PAGE)
      return jsonResponse(eventsPage('111'))
    }) as unknown as typeof fetch

    const result = await resolveFulfilledOrderEmail('111')
    expect(result).toEqual({
      email: 'buyer@example.com',
      reviewerName: 'Jordan Rivera',
      lineItems: [{ sku: 'SKU-A', productId: '1001' }],
    })
    expect(calls.some((u) => u.includes('metric_id%2C%22WMB9hY%22') || u.includes('WMB9hY'))).toBe(true)
  })

  it('returns null — a miss, not a throw — when no event matches the order id', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/metrics/')) return jsonResponse(METRICS_PAGE)
      return jsonResponse(eventsPage(null))
    }) as unknown as typeof fetch

    expect(await resolveFulfilledOrderEmail('999')).toBeNull()
  })

  it('returns null when the Fulfilled Order metric cannot be found at all', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ data: [], links: { next: null } })) as unknown as typeof fetch
    expect(await resolveFulfilledOrderEmail('111')).toBeNull()
  })

  it('retries once on a 429 and then succeeds', async () => {
    let metricCalls = 0
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/metrics/')) {
        metricCalls++
        if (metricCalls === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
        return jsonResponse(METRICS_PAGE)
      }
      return jsonResponse(eventsPage('111'))
    }) as unknown as typeof fetch

    const result = await resolveFulfilledOrderEmail('111')
    expect(result?.email).toBe('buyer@example.com')
    expect(metricCalls).toBe(2)
  })
})
