import { describe, expect, it, vi } from 'vitest'
import { ChannelNotEnabledError } from '../errors'
import type { PolicyMirrorRow } from '../types'
import { EXO_BASE, createExoClient } from './client.server'
import {
  createExoclickAdapter, exoConversions, exoDays, exoclickPolicyCheck, normalizeExoCampaign, normalizeExoVariation,
  parseExoStatsPage,
} from './adapter.server'

const NOW = new Date('2026-10-20T12:00:00Z')

// Fixtures shaped from the v2 swagger (Campaign, VariationDetails,
// StatisticsAdvertiserVariation) and the live login and list answers of 2026-10-20.
const CAMPAIGN = {
  id: 9001, name: 'xdipx wand 300x250', status: 1, pricing_model: 2,
  daily_limit_type: 1, max_daily_budget: 3.5, max_daily_budget_reset: 10, total_budget_limit: 0,
  calculated_status: { id: 1, status: 'Running' },
}
const PAUSED_NO_LIMIT = { id: 9002, name: 'paused one', status: 0, daily_limit_type: 0, calculated_status: { id: 0, status: 'Paused' } }
const VARIATION_OK = {
  idvariation: 55501, idcampaign: 9001, name: 'S5 steel 300x250', active: 1, status: 1, calculated_status: 'approved',
  url: 'https://xdipx.com/products/steel?utm_source=adnetwork&utm_medium=display&utm_campaign=idea-12&utm_content=345',
}
const VARIATION_REJECTED = { idvariation: 55502, idcampaign: 9001, name: '', active: 1, status: 2, calculated_status: 'rejected' }
const VARIATION_ARCHIVED = { idvariation: 55503, idcampaign: 9001, name: 'old', active: 0, status: 1 }

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function adapterWith(route: (path: string, qs: URLSearchParams) => unknown) {
  const paths: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const u = new URL(String(input))
    if (u.pathname === '/v2/login') return jsonRes(200, { token: 't', type: 'Bearer', expires_in: 43199 })
    const path = u.pathname.replace(/^\/v2\//, '')
    paths.push(`${path}?${u.searchParams.toString()}`)
    return jsonRes(200, route(path, u.searchParams))
  })
  const client = createExoClient({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => 'k', now: () => NOW.getTime() })
  return { adapter: createExoclickAdapter({ client, now: () => NOW, accountId: async () => '1014762' }), paths }
}

describe('normalizeExoCampaign', () => {
  it('maps status, calculated status, daily budget and pricing into the mirror shape', () => {
    const e = normalizeExoCampaign('1014762', CAMPAIGN)
    expect(e).toMatchObject({
      platform: 'adult:exoclick', accountId: '1014762', level: 'campaign', externalId: '9001', parentExternalId: null,
      name: 'xdipx wand 300x250', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: 1000,
      lifetimeBudgetCents: null, bidStrategy: 'CPM', objective: null,
    })
    expect(e.raw).toBe(CAMPAIGN)
  })

  it('leaves the daily budget null without a budget-type daily limit, and keeps other calculated statuses readable', () => {
    expect(normalizeExoCampaign('a', PAUSED_NO_LIMIT)).toMatchObject({ status: 'PAUSED', effectiveStatus: 'PAUSED', dailyBudgetCents: null })
    const noFunds = normalizeExoCampaign('a', { ...CAMPAIGN, calculated_status: { id: 2, status: 'No Funds' } })
    expect(noFunds.effectiveStatus).toBe('NO_FUNDS')
    expect(normalizeExoCampaign('a', { id: 1, status: -1 }).status).toBe('ARCHIVED')
  })
})

describe('normalizeExoVariation', () => {
  it('mirrors a variation as an ad under its campaign', () => {
    expect(normalizeExoVariation('a', '9001', VARIATION_OK)).toMatchObject({
      level: 'ad', externalId: '55501', parentExternalId: '9001', name: 'S5 steel 300x250',
      status: 'ACTIVE', effectiveStatus: 'ACTIVE', reviewFeedback: null,
    })
  })

  it('marks a rejected variation DISAPPROVED, names it by id when unnamed, and reads archived', () => {
    const r = normalizeExoVariation('a', '9001', VARIATION_REJECTED)
    expect(r).toMatchObject({ name: '55502', effectiveStatus: 'DISAPPROVED' })
    expect(r.reviewFeedback).toEqual({ status: 2, calculated_status: 'rejected' })
    expect(normalizeExoVariation('a', '9001', VARIATION_ARCHIVED)).toMatchObject({ status: 'ARCHIVED', effectiveStatus: 'ARCHIVED' })
    expect(normalizeExoVariation('a', '9001', { idvariation: 7, status: 0 }).effectiveStatus).toBe('PENDING_REVIEW')
  })
})

describe('syncEntities', () => {
  it('lists campaigns, then each campaign\'s variations', async () => {
    const { adapter, paths } = adapterWith(path => {
      if (path === 'campaigns') return { result: [CAMPAIGN, PAUSED_NO_LIMIT], request_metadata: { limit: 500, offset: 0, count: 2 } }
      if (path === 'campaigns/9001/variation') return { variations: [VARIATION_OK, VARIATION_REJECTED] }
      if (path === 'campaigns/9002/variation') return { variations: [] }
      throw new Error(`unexpected ${path}`)
    })
    const rows = await adapter.syncEntities({})
    expect(rows.map(r => `${r.level}:${r.externalId}:${r.parentExternalId}`)).toEqual([
      'campaign:9001:null', 'ad:55501:9001', 'ad:55502:9001', 'campaign:9002:null',
    ])
    expect(rows.every(r => r.platform === 'adult:exoclick' && r.accountId === '1014762')).toBe(true)
    expect(paths[0]).toBe('campaigns?detailed=true&limit=500&offset=0')
  })

  it('treats zero campaigns as a clean, empty result (the account today)', async () => {
    const { adapter } = adapterWith(() => ({ result: [], request_metadata: { limit: 500, offset: 0, count: 0 } }))
    expect(await adapter.syncEntities({})).toEqual([])
  })

  it('pages campaigns by offset until a short page', async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, status: 1 }))
    const { adapter, paths } = adapterWith((path, qs) => {
      if (path === 'campaigns') return { result: qs.get('offset') === '0' ? page : [{ id: 999, status: 0 }] }
      return { variations: [] }
    })
    const rows = await adapter.syncEntities({})
    expect(rows.filter(r => r.level === 'campaign')).toHaveLength(501)
    expect(paths.filter(p => p.startsWith('campaigns?'))).toHaveLength(2)
  })
})

describe('statistics parsing', () => {
  it('maps hits, clicks, cost in dollars to cents, and goals to platform purchases', () => {
    const rows = parseExoStatsPage('ad', '2026-10-19', {
      result: [
        { idvariation: 55501, hits: 12034, clicks: 41, value: 0, cost: 12.345, ctr: 0.34, cpm: 1.02, avg_cpc: 0.3,
          goals: { data: { abc: { volume: 2, coa: 3, ecpa: 6 }, def: { volume: 1 } }, total: 3, ecpa: 4 } },
        { idvariation: 55502, hits: 10, clicks: 0, cost: 0.004 },
      ],
      request_metadata: [],
    })
    expect(rows).toEqual([
      {
        platform: 'adult:exoclick', level: 'ad', externalId: '55501', day: '2026-10-19',
        spendCents: 1235, impressions: 12034, reach: 0, frequency: 0, clicks: 41, linkClicks: 41,
        leads: 0, platformPurchases: 3, platformPurchaseValueCents: 0,
        actions: { conversions: 3, 'goal:abc': 2, 'goal:def': 1 },
      },
      expect.objectContaining({ externalId: '55502', spendCents: 0, impressions: 10, platformPurchases: 0, actions: { conversions: 0 } }),
    ])
  })

  it('falls back to value when cost is absent, and to summed goal volumes when total is absent', () => {
    const [row] = parseExoStatsPage('campaign', '2026-10-19', {
      result: [{ idcampaign: 9001, hits: '1,000', clicks: '3', value: 2.5, goals: { data: { g: { volume: 4 } } } }],
    })
    expect(row).toMatchObject({ level: 'campaign', externalId: '9001', spendCents: 250, impressions: 1000, clicks: 3, platformPurchases: 4 })
    expect(exoConversions([{ total: 1 }, { total: 2 }]).total).toBe(3)
    expect(exoConversions(undefined)).toEqual({ total: 0, byGoal: {} })
  })

  it('sums a variation that appears twice and skips rows without an id', () => {
    const rows = parseExoStatsPage('ad', '2026-10-19', {
      result: [{ idvariation: 1, hits: 5, clicks: 1, cost: 1 }, { idvariation: 1, hits: 5, clicks: 2, cost: 0.5 }, { hits: 9 }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ impressions: 10, clicks: 3, linkClicks: 3, spendCents: 150 })
  })

  it('refuses a page with no result array', () => {
    expect(() => parseExoStatsPage('ad', '2026-10-19', { error: 'x' })).toThrow(/no result array/)
  })

  it('lists every day in a range, inclusive', () => {
    expect(exoDays({ since: '2026-10-30', until: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
})

describe('pullInsights', () => {
  it('asks the variation endpoint one day at a time with goals included', async () => {
    const { adapter, paths } = adapterWith((path, qs) => {
      expect(path).toBe('statistics/a/variation')
      return qs.get('date-from') === '2026-10-19'
        ? { result: [{ idvariation: 55501, hits: 100, clicks: 2, cost: 1.5 }] }
        : { result: [], request_metadata: [] }
    })
    const rows = await adapter.pullInsights({ since: '2026-10-19', until: '2026-10-20' }, 'ad')
    expect(rows).toEqual([expect.objectContaining({ level: 'ad', externalId: '55501', day: '2026-10-19', spendCents: 150, impressions: 100 })])
    expect(paths).toEqual([
      'statistics/a/variation?date-from=2026-10-19&date-to=2026-10-19&include=goals&limit=500&offset=0',
      'statistics/a/variation?date-from=2026-10-20&date-to=2026-10-20&include=goals&limit=500&offset=0',
    ])
  })

  it('uses the campaign endpoint at campaign level and refuses the other levels', async () => {
    const { adapter, paths } = adapterWith(() => ({ result: [{ idcampaign: 9001, hits: 1, clicks: 0, cost: 0 }] }))
    const rows = await adapter.pullInsights({ since: '2026-10-19', until: '2026-10-19' }, 'campaign')
    expect(rows[0]).toMatchObject({ level: 'campaign', externalId: '9001' })
    expect(paths[0]).toMatch(/^statistics\/a\/campaign\?/)
    await expect(adapter.pullInsights({ since: '2026-10-19', until: '2026-10-19' }, 'adset')).rejects.toThrow(/variation \(ad\) or campaign/)
  })

  it('returns nothing for an account with no statistics', async () => {
    const { adapter } = adapterWith(() => ({ result: [], request_metadata: [] }))
    expect(await adapter.pullInsights({ since: '2026-10-14', until: '2026-10-20' }, 'ad')).toEqual([])
  })
})

describe('health', () => {
  it('is valid when the login succeeds, with the key expiry unknown rather than the 12h session', async () => {
    const { adapter } = adapterWith(() => ({}))
    expect(await adapter.auth.health()).toEqual({
      valid: true, expiresAt: null, expiryUnknown: true, scopes: ['api_token'], checkedAt: NOW.toISOString(),
    })
  })

  it('reads not_configured when EXOCLICK_API_KEY is missing, exactly like Meta', async () => {
    const fetchImpl = vi.fn()
    const client = createExoClient({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => null })
    const h = await createExoclickAdapter({ client, now: () => NOW }).auth.health()
    expect(h).toMatchObject({ valid: false, expiresAt: null, error: 'not_configured', checkedAt: NOW.toISOString() })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads token_rejected when ExoClick refuses the key', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      expect(String(input)).toBe(`${EXO_BASE}/login`)
      return jsonRes(403, { message: 'Incorrect access details' })
    })
    const client = createExoClient({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: () => 'bad' })
    expect(await createExoclickAdapter({ client, now: () => NOW }).auth.health()).toMatchObject({ valid: false, error: 'token_rejected' })
  })
})

describe('mutations', () => {
  it('has no mutate verbs, and mutate and createPaused throw ChannelNotEnabledError', async () => {
    const { adapter } = adapterWith(() => ({}))
    expect(adapter.capabilities).toEqual({ read: true, insights: true, mutate: [], audiences: 'none', preview: false })
    await expect(adapter.mutate({ verb: 'pause', target: { platform: 'adult:exoclick', level: 'campaign', externalId: '1' }, params: {} }))
      .rejects.toBeInstanceOf(ChannelNotEnabledError)
    await expect(adapter.createPaused({})).rejects.toBeInstanceOf(ChannelNotEnabledError)
  })
})

describe('policyCheck', () => {
  const GOOD = 'https://xdipx.com/products/steel?utm_source=adnetwork&utm_medium=display&utm_campaign=idea-12&utm_content=345'

  it('allows when every banner URL carries the four UTMs', () => {
    expect(exoclickPolicyCheck({ mirror: [], bannerUrls: [GOOD, GOOD.replace('345', '346')] })).toEqual({ ok: true, refusals: [] })
    expect(exoclickPolicyCheck({ mirror: [] })).toEqual({ ok: true, refusals: [] })
  })

  it('refuses and names each missing parameter', () => {
    const v = exoclickPolicyCheck({ mirror: [], bannerUrls: ['https://xdipx.com/products/steel?utm_source=adnetwork&utm_campaign=x&utm_content='] })
    expect(v.ok).toBe(false)
    expect(v.refusals.map(r => r.code)).toEqual(['exoclick_missing_utm', 'exoclick_missing_utm'])
    expect(v.refusals[0]!.message).toMatch(/missing utm_medium/)
    expect(v.refusals[1]!.message).toMatch(/missing utm_content/)
    for (const r of v.refusals) expect(r.message).not.toMatch(/\u2014/)
  })

  it('refuses a URL it cannot parse, and a rejected mirrored variation', () => {
    const mirror: PolicyMirrorRow[] = [
      { platform: 'adult:exoclick', level: 'ad', externalId: '55502', name: 'S5', effectiveStatus: 'DISAPPROVED', reviewFeedback: null },
      { platform: 'meta', level: 'ad', externalId: 'm1', name: null, effectiveStatus: 'DISAPPROVED', reviewFeedback: null },
    ]
    const v = exoclickPolicyCheck({ mirror, bannerUrls: ['not a url'] })
    expect(v.refusals.map(r => r.code)).toEqual(['exoclick_rejected', 'exoclick_bad_url'])
    expect(v.refusals[0]!.ref).toEqual({ platform: 'adult:exoclick', level: 'ad', externalId: '55502' })
  })

  it('runs the same check through the adapter', async () => {
    const { adapter } = adapterWith(() => ({}))
    const ctx = { mirror: [], bannerUrls: ['https://xdipx.com/?utm_source=exoclick'] }
    const v = await adapter.policyCheck(ctx)
    expect(v.ok).toBe(false)
    expect(v.refusals).toHaveLength(3)
  })
})
