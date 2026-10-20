import { describe, expect, it, vi } from 'vitest'
import { ChannelNotEnabledError } from '../errors'
import type { PolicyMirrorRow } from '../types'
import { budgetCents, createMetaAdapter, normalizeMetaEntity, normalizeMetaInsight } from './adapter.server'
import { GraphError, type GraphClient, type GraphJson } from './graph.server'

// Fixtures shaped like Graph v23.0 responses for the fields the adapter asks for.
const CAMPAIGN: GraphJson = {
  id: '120200000000001', name: 'Leads | Curious door', status: 'ACTIVE', effective_status: 'ACTIVE',
  objective: 'OUTCOME_LEADS', daily_budget: '1500', lifetime_budget: '0', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  updated_time: '2026-10-18T12:00:00-0700',
}
const ADSET: GraphJson = {
  id: '120200000000101', name: 'US 25-54', campaign_id: '120200000000001', status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED',
  lifetime_budget: '0', updated_time: '2026-10-18T12:00:00-0700',
}
const AD: GraphJson = {
  id: '120200000001001', name: 'Wand object-first 1x1', adset_id: '120200000000101', status: 'ACTIVE', effective_status: 'DISAPPROVED',
  ad_review_feedback: { global: { 'Adult Products or Services': 'Ads must not promote adult products.' } },
  creative: { id: '120200000009001' }, updated_time: '2026-10-19T08:00:00-0700',
}
const INSIGHT_DAY: GraphJson = {
  campaign_id: '120200000000001', adset_id: '120200000000101', ad_id: '120200000001001',
  date_start: '2026-10-18', date_stop: '2026-10-18',
  spend: '12.34', impressions: '2210', reach: '1904', frequency: '1.160714', clicks: '61', inline_link_clicks: '48',
  actions: [
    { action_type: 'link_click', value: '48' },
    { action_type: 'lead', value: '3' },
    { action_type: 'onsite_conversion.lead_grouped', value: '3' },
    { action_type: 'offsite_conversion.fb_pixel_purchase', value: '1' },
  ],
  action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '29.99' }],
}

describe('Meta normalization', () => {
  it('normalizes a campaign', () => {
    expect(normalizeMetaEntity('campaign', 'act_920738511029316', CAMPAIGN)).toEqual({
      platform: 'meta', accountId: 'act_920738511029316', level: 'campaign', externalId: '120200000000001',
      parentExternalId: null, name: 'Leads | Curious door', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
      objective: 'OUTCOME_LEADS', dailyBudgetCents: 1500, lifetimeBudgetCents: null,
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP', reviewFeedback: null, raw: CAMPAIGN,
    })
  })

  it('normalizes an ad set under CBO, with no budget of its own', () => {
    const e = normalizeMetaEntity('adset', 'act_1', ADSET)
    expect(e.parentExternalId).toBe('120200000000001')
    expect(e.effectiveStatus).toBe('CAMPAIGN_PAUSED')
    expect(e.objective).toBeNull()
    expect(e.dailyBudgetCents).toBeNull()
    expect(e.lifetimeBudgetCents).toBeNull()
    expect(e.bidStrategy).toBeNull()
  })

  it('normalizes an ad with its review feedback', () => {
    const e = normalizeMetaEntity('ad', 'act_1', AD)
    expect(e.parentExternalId).toBe('120200000000101')
    expect(e.effectiveStatus).toBe('DISAPPROVED')
    expect(e.reviewFeedback).toEqual(AD['ad_review_feedback'])
    expect(e.dailyBudgetCents).toBeNull()
    expect(e.raw).toBe(AD)
  })

  it('normalizes one insights day without double-counting leads', () => {
    expect(normalizeMetaInsight('ad', INSIGHT_DAY)).toEqual({
      platform: 'meta', level: 'ad', externalId: '120200000001001', day: '2026-10-18',
      spendCents: 1234, impressions: 2210, reach: 1904, frequency: 1.160714, clicks: 61, linkClicks: 48,
      leads: 3, platformPurchases: 1, platformPurchaseValueCents: 2999,
      actions: { link_click: 48, lead: 3, 'onsite_conversion.lead_grouped': 3, 'offsite_conversion.fb_pixel_purchase': 1 },
    })
  })

  it('reads zeros when a day has no actions', () => {
    const r = normalizeMetaInsight('campaign', { campaign_id: '5', date_start: '2026-10-17', spend: '0' })
    expect(r).toMatchObject({ externalId: '5', spendCents: 0, leads: 0, platformPurchases: 0, actions: {} })
  })

  it('treats a zero or missing budget as null', () => {
    expect(budgetCents('0')).toBeNull()
    expect(budgetCents(undefined)).toBeNull()
    expect(budgetCents('2500')).toBe(2500)
  })
})

function fakeGraph(byPath: Record<string, GraphJson[]>, single: Record<string, GraphJson> = {}) {
  const getAll = vi.fn(async (path: string) => byPath[path] ?? [])
  const get = vi.fn(async (path: string) => single[path] ?? {})
  const post = vi.fn(async () => ({}))
  return { graph: { get, getAll, post } as unknown as GraphClient, get, getAll, post }
}

const creds = () => ({ token: 'tok', accountId: 'act_1', pageId: null })

describe('metaAdapter', () => {
  it('syncs campaigns, ad sets and ads and writes nothing', async () => {
    const g = fakeGraph({ 'act_1/campaigns': [CAMPAIGN], 'act_1/adsets': [ADSET], 'act_1/ads': [AD] })
    const a = createMetaAdapter({ graph: g.graph, credentials: creds })
    const rows = await a.syncEntities({})
    expect(rows.map(r => [r.level, r.externalId])).toEqual([
      ['campaign', '120200000000001'], ['adset', '120200000000101'], ['ad', '120200000001001'],
    ])
    expect(g.post).not.toHaveBeenCalled()
    const adFields = (g.getAll.mock.calls.find(c => c[0] === 'act_1/ads') as unknown[] | undefined)?.[1] as Record<string, string>
    expect(adFields.fields).toContain('ad_review_feedback')
  })

  it('drops rows not updated since the cutoff', async () => {
    const g = fakeGraph({ 'act_1/campaigns': [CAMPAIGN], 'act_1/adsets': [ADSET], 'act_1/ads': [AD] })
    const a = createMetaAdapter({ graph: g.graph, credentials: creds })
    const rows = await a.syncEntities({ since: new Date('2026-10-19T00:00:00Z') })
    expect(rows.map(r => r.level)).toEqual(['ad'])
  })

  it('pulls daily insights at ad level', async () => {
    const g = fakeGraph({ 'act_1/insights': [INSIGHT_DAY] })
    const a = createMetaAdapter({ graph: g.graph, credentials: creds })
    const rows = await a.pullInsights({ since: '2026-10-18', until: '2026-10-18' }, 'ad')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.spendCents).toBe(1234)
    expect((g.getAll.mock.calls[0] as unknown[])[1]).toMatchObject({ level: 'ad', time_increment: 1, time_range: { since: '2026-10-18', until: '2026-10-18' } })
  })

  it('refuses to sync with no ad account configured', async () => {
    const g = fakeGraph({})
    const a = createMetaAdapter({ graph: g.graph, credentials: () => ({ token: 'tok', accountId: null, pageId: null }) })
    await expect(a.syncEntities({})).rejects.toMatchObject({ kind: 'not_configured' })
    expect(g.getAll).not.toHaveBeenCalled()
  })

  it('reports token health from debug_token', async () => {
    const g = fakeGraph({}, { debug_token: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 1798761600, scopes: ['ads_read', 'ads_management'] } } })
    const a = createMetaAdapter({ graph: g.graph, credentials: creds, now: () => new Date('2026-10-19T00:00:00Z') })
    await expect(a.auth.health()).resolves.toEqual({
      valid: true, expiresAt: null, dataAccessExpiresAt: '2027-01-01T00:00:00.000Z',
      scopes: ['ads_read', 'ads_management'], checkedAt: '2026-10-19T00:00:00.000Z',
    })
  })

  it('reports an invalid token without throwing', async () => {
    const g = fakeGraph({}, { debug_token: { data: { is_valid: false, error: { message: 'Session has expired' }, scopes: [] } } })
    const a = createMetaAdapter({ graph: g.graph, credentials: creds })
    await expect(a.auth.health()).resolves.toMatchObject({ valid: false, error: 'Session has expired' })
  })

  it('marks a token Meta refuses with code 190 as token_rejected, and a network failure as network', async () => {
    const refusing = { get: vi.fn(async () => { throw new GraphError('api_error', 'refused', { status: 400, code: 190 }) }) } as unknown as GraphClient
    await expect(createMetaAdapter({ graph: refusing, credentials: creds }).auth.health())
      .resolves.toMatchObject({ valid: false, error: 'token_rejected' })
    const offline = { get: vi.fn(async () => { throw new GraphError('network', 'down') }) } as unknown as GraphClient
    await expect(createMetaAdapter({ graph: offline, credentials: creds }).auth.health())
      .resolves.toMatchObject({ valid: false, error: 'network' })
  })

  it('throws NotEnabled for createPaused and mutate', async () => {
    const g = fakeGraph({})
    const a = createMetaAdapter({ graph: g.graph, credentials: creds })
    await expect(a.createPaused({})).rejects.toBeInstanceOf(ChannelNotEnabledError)
    await expect(a.mutate({ verb: 'pause', target: { platform: 'meta', level: 'ad', externalId: '1' }, params: {} })).rejects.toBeInstanceOf(ChannelNotEnabledError)
    expect(g.post).not.toHaveBeenCalled()
  })

  it('policyCheck refuses while a mirrored Meta entity is DISAPPROVED', async () => {
    const a = createMetaAdapter({ graph: fakeGraph({}).graph, credentials: creds })
    const mirror: PolicyMirrorRow[] = [
      { platform: 'meta', level: 'campaign', externalId: 'c1', name: 'Leads', effectiveStatus: 'ACTIVE', reviewFeedback: null },
      { platform: 'meta', level: 'ad', externalId: 'a1', name: 'Wand 1x1', effectiveStatus: 'DISAPPROVED', reviewFeedback: { global: {} } },
      { platform: 'microsoft', level: 'ad', externalId: 'm1', name: null, effectiveStatus: 'DISAPPROVED', reviewFeedback: null },
    ]
    const v = await a.policyCheck({ mirror })
    expect(v.ok).toBe(false)
    expect(v.refusals).toHaveLength(1)
    expect(v.refusals[0]!).toMatchObject({ code: 'meta_disapproved', ref: { platform: 'meta', level: 'ad', externalId: 'a1' } })
  })

  it('policyCheck passes a clean mirror', async () => {
    const a = createMetaAdapter({ graph: fakeGraph({}).graph, credentials: creds })
    await expect(a.policyCheck({ mirror: [] })).resolves.toEqual({ ok: true, refusals: [] })
  })
})
