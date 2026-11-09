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

// Ticket #20828: the real "Fulfilled Order" event nests the Shopify order id
// and line items under `event_properties.$extra`, not at the top level —
// `Items`/`FulfillmentStatus`/etc. at the top level are Klaviyo's own
// flattened projection and never carry the order id at all. This fixture
// mirrors the verified real shape, including a decoy top-level `Items` to
// catch a regression back to reading the wrong field.
function eventsPage(matchOrderId: string | null) {
  return {
    data: matchOrderId
      ? [
          {
            id: 'evt_1',
            attributes: {
              event_properties: {
                Items: [{ ProductID: 'decoy', ProductName: 'decoy' }],
                $extra: { id: matchOrderId, line_items: [{ sku: 'SKU-A', product_id: 1001 }] },
              },
            },
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

  it('follows pagination to a second events page before giving up (#20822)', async () => {
    // First page has no match but links to a second; the match is only on
    // page two. Confirms the match loop is not a one-page read.
    let eventsCalls = 0
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/metrics/')) return jsonResponse(METRICS_PAGE)
      eventsCalls++
      if (eventsCalls === 1) {
        return jsonResponse({ ...eventsPage(null), links: { next: 'https://a.klaviyo.com/api/events/?page=2' } })
      }
      return jsonResponse(eventsPage('111'))
    }) as unknown as typeof fetch

    const result = await resolveFulfilledOrderEmail('111')
    expect(result?.email).toBe('buyer@example.com')
    expect(eventsCalls).toBe(2)
  })

  it('logs a non-PII diagnostic (event ids and their props.id) on a total miss (#20822)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/metrics/')) return jsonResponse(METRICS_PAGE)
      // An event exists in the window, but its order id does not match.
      return jsonResponse(eventsPage('999-not-the-order-we-want'))
    }) as unknown as typeof fetch

    const result = await resolveFulfilledOrderEmail('111')
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const logged = warnSpy.mock.calls[0]?.join(' ') ?? ''
    expect(logged).toContain('111')
    expect(logged).toContain('evt_1')
    expect(logged).toContain('999-not-the-order-we-want')
    expect(logged).not.toContain('buyer@example.com') // no email/PII in the diagnostic
    warnSpy.mockRestore()
  })

  // Ticket #20828: all 7 orders #20822 widened the lookback window for still
  // never resolved, because the order id was being read from the wrong
  // field. An event shaped the OLD (wrong) way — order id at the top level,
  // no `$extra` — must now report a miss, not a stale false-positive match.
  it('does not match an event with the old (wrong) top-level id/line_items shape', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/metrics/')) return jsonResponse(METRICS_PAGE)
      return jsonResponse({
        data: [{
          id: 'evt_1',
          attributes: { event_properties: { id: '111', line_items: [{ sku: 'SKU-A', product_id: 1001 }] } },
          relationships: { profile: { data: { id: 'prof_1' } } },
        }],
        included: [{ type: 'profile', id: 'prof_1', attributes: { email: 'buyer@example.com' } }],
        links: { next: null },
      })
    }) as unknown as typeof fetch

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
