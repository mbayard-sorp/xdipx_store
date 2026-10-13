import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory db stand-in, keyed by the drizzle table object each query names
// (same pattern as ad-rules.server.test.ts). Where/eq/and/gte/isNotNull are
// not evaluated here; each test seeds exactly the rows its query should see.
// ---------------------------------------------------------------------------
const mem = vi.hoisted(() => ({
  emailSendsRows: [] as Array<Record<string, unknown>>,
  orderAttributionRows: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ id: unknown; set: Record<string, unknown> }>,
}))

vi.mock('./db.server', () => {
  const thenable = (rows: Array<Record<string, unknown>>) => {
    const t: Record<string, unknown> = {
      from: () => t,
      where: () => t,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    }
    return t
  }
  return {
    db: {
      select: (projection: Record<string, unknown>) => {
        // Distinguish the two `.select({...}).from(...)` call sites by shape
        // of the requested columns, since `from()` here does not see the table.
        if ('klaviyoCampaignId' in projection) return thenable(mem.emailSendsRows)
        return thenable(mem.orderAttributionRows)
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          mem.inserted.push(v)
          return Promise.resolve()
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: () => {
            mem.updated.push({ id: null, set: v })
            return Promise.resolve()
          },
        }),
      }),
    },
  }
})

vi.mock('./klaviyo-flows.server', () => ({
  getMetricIdsByName: vi.fn(async () => new Map([['Placed Order', 'SHOPIFY_ORDER']])),
}))

import {
  fetchCampaignStatus,
  fetchCampaignValuesReport,
  orderAttributionForCampaign,
  runEmailMetricsPull,
  sumStatisticsForCampaign,
  type CampaignValuesReportResult,
} from './email-metrics-pull.server'

const okJson = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(), text: async () => JSON.stringify(body) }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  mem.emailSendsRows = []
  mem.orderAttributionRows = []
  mem.inserted = []
  mem.updated = []
})

describe('sumStatisticsForCampaign', () => {
  const results: CampaignValuesReportResult[] = [
    { groupings: { campaign_id: 'C1', campaign_message_id: 'M1' }, statistics: { recipients: 100, opens_unique: 40 } },
    { groupings: { campaign_id: 'C1', campaign_message_id: 'M2' }, statistics: { recipients: 50, opens_unique: 10 } },
    { groupings: { campaign_id: 'C2', campaign_message_id: 'M3' }, statistics: { recipients: 999 } },
  ]

  it('sums every group for the named campaign and ignores other campaigns', () => {
    expect(sumStatisticsForCampaign(results, 'C1')).toEqual({ recipients: 150, opens_unique: 50 })
  })

  it('returns an empty object for a campaign with no groups', () => {
    expect(sumStatisticsForCampaign(results, 'UNKNOWN')).toEqual({})
  })
})

describe('fetchCampaignValuesReport', () => {
  it('POSTs one batched request with the full statistic list, timeframe, and campaign filter', async () => {
    const fetchMock = vi.fn(async () => okJson({
      data: { attributes: { results: [{ groupings: { campaign_id: 'C1' }, statistics: { recipients: 10 } }] } },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await fetchCampaignValuesReport(['C1', 'C2'], 'METRIC1')

    expect(results).toEqual([{ groupings: { campaign_id: 'C1' }, statistics: { recipients: 10 } }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://a.klaviyo.com/api/campaign-values-reports/')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.data.type).toBe('campaign-values-report')
    expect(body.data.attributes.conversion_metric_id).toBe('METRIC1')
    expect(body.data.attributes.timeframe).toEqual({ key: 'last_30_days' })
    expect(body.data.attributes.statistics).toEqual([
      'recipients', 'delivered', 'opens_unique', 'clicks_unique',
      'conversions', 'conversion_value', 'unsubscribes', 'spam_complaints', 'bounced',
    ])
    expect(body.data.attributes.filter).toBe('and(contains-any(campaign_id,["C1","C2"]),equals(send_channel,"email"))')
  })

  it('makes no request for an empty campaign id list', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchCampaignValuesReport([], 'METRIC1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a 429 with backoff and succeeds on the next attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'retry-after': '0.01' }), text: async () => 'rate limited' } as unknown as Response)
      .mockResolvedValueOnce(okJson({ data: { attributes: { results: [] } } }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await fetchCampaignValuesReport(['C1'], 'METRIC1')

    expect(results).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-429 error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ error: 'nope' }, 500)))
    await expect(fetchCampaignValuesReport(['C1'], 'METRIC1')).rejects.toThrow(/500/)
  })
})

describe('fetchCampaignStatus', () => {
  it('reads status and send_time off the campaign resource', async () => {
    const fetchMock = vi.fn(async () => okJson({ data: { attributes: { status: 'Sent', send_time: '2026-10-10T12:00:00Z' } } }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchCampaignStatus('C1')).toEqual({ status: 'Sent', sendTime: '2026-10-10T12:00:00Z' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://a.klaviyo.com/api/campaigns/C1/?fields[campaign]=status,send_time')
  })
})

describe('orderAttributionForCampaign (utm_campaign / utm_content join)', () => {
  it('sums orders and revenue overall and per utm_content block', async () => {
    mem.orderAttributionRows = [
      { utmContent: 'hero-wand', totalPrice: '49.00' },
      { utmContent: 'hero-wand', totalPrice: '51.00' },
      { utmContent: 'deal-lube', totalPrice: '19.99' },
      { utmContent: null, totalPrice: '10.00' },
    ]

    const attribution = await orderAttributionForCampaign('daily-20261013')

    expect(attribution.attributedOrders).toBe(4)
    expect(attribution.attributedRevenue).toBe('129.99')
    expect(attribution.byBlock).toEqual({
      'hero-wand': { orders: 2, revenue: '100.00' },
      'deal-lube': { orders: 1, revenue: '19.99' },
      unknown: { orders: 1, revenue: '10.00' },
    })
  })

  it('returns zeros when nothing is attributed to the campaign', async () => {
    mem.orderAttributionRows = []
    expect(await orderAttributionForCampaign('daily-20261013')).toEqual({
      attributedOrders: 0,
      attributedRevenue: '0.00',
      byBlock: {},
    })
  })
})

describe('runEmailMetricsPull', () => {
  it('reports no-klaviyo-api-key and touches nothing when the key is unset', async () => {
    vi.stubEnv('KLAVIYO_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runEmailMetricsPull()

    expect(result).toEqual({ campaignsChecked: 0, pulled: 0, statusFlipped: 0, errors: ['no-klaviyo-api-key'] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a clean no-op when no email_sends row is due', async () => {
    vi.stubEnv('KLAVIYO_API_KEY', 'test-key')
    mem.emailSendsRows = []
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runEmailMetricsPull()

    expect(result).toEqual({ campaignsChecked: 0, pulled: 0, statusFlipped: 0, errors: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pulls stats, joins order_attribution by utm_campaign/utm_content, writes one metrics row, and flips status to sent', async () => {
    vi.stubEnv('KLAVIYO_API_KEY', 'test-key')
    mem.emailSendsRows = [
      { id: 1, campaignKey: 'daily-20261013', klaviyoCampaignId: 'C1', status: 'drafted' },
    ]
    mem.orderAttributionRows = [
      { utmContent: 'hero-wand', totalPrice: '49.00' },
    ]

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({
        data: {
          attributes: {
            results: [{ groupings: { campaign_id: 'C1' }, statistics: { recipients: 200, delivered: 198, opens_unique: 90 } }],
          },
        },
      }))
      .mockResolvedValueOnce(okJson({ data: { attributes: { status: 'Sent', send_time: '2026-10-13T12:05:00Z' } } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runEmailMetricsPull()

    expect(result).toEqual({ campaignsChecked: 1, pulled: 1, statusFlipped: 1, errors: [] })
    expect(mem.inserted).toHaveLength(1)
    expect(mem.inserted[0]).toMatchObject({
      campaignKey: 'daily-20261013',
      klaviyoCampaignId: 'C1',
      recipients: 200,
      delivered: 198,
      opensUnique: 90,
      attributedOrders: 1,
      attributedRevenue: '49.00',
      byBlock: { 'hero-wand': { orders: 1, revenue: '49.00' } },
    })
    expect(mem.updated).toHaveLength(1)
    expect(mem.updated[0]!.set).toMatchObject({ status: 'sent' })
    expect((mem.updated[0]!.set['sentAt'] as Date).toISOString()).toBe('2026-10-13T12:05:00.000Z')
  })

  it('does not re-check status for a campaign already marked sent', async () => {
    vi.stubEnv('KLAVIYO_API_KEY', 'test-key')
    mem.emailSendsRows = [
      { id: 1, campaignKey: 'daily-20261010', klaviyoCampaignId: 'C9', status: 'sent' },
    ]
    mem.orderAttributionRows = []

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ data: { attributes: { results: [] } } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runEmailMetricsPull()

    expect(result).toEqual({ campaignsChecked: 1, pulled: 1, statusFlipped: 0, errors: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1) // the batched report only; no status GET
    expect(mem.updated).toHaveLength(0)
  })

  it('records the metric-lookup failure and does not call Klaviyo', async () => {
    vi.stubEnv('KLAVIYO_API_KEY', 'test-key')
    mem.emailSendsRows = [
      { id: 1, campaignKey: 'daily-20261013', klaviyoCampaignId: 'C1', status: 'drafted' },
    ]
    const { getMetricIdsByName } = await import('./klaviyo-flows.server')
    vi.mocked(getMetricIdsByName).mockResolvedValueOnce(new Map())
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runEmailMetricsPull()

    expect(result.errors).toEqual(['no-placed-order-metric-id'])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
