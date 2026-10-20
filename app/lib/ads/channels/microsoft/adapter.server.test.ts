import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'

const getMsAdsAccessToken = vi.fn(async () => 'access-token-1')
vi.mock('~/lib/microsoft-ads-token.server', () => ({ getMsAdsAccessToken: () => getMsAdsAccessToken() }))
// Never touch the real database from a test: .env DATABASE_URL is production.
// health()'s default not-ready read then fails and is ignored.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import { ChannelNotEnabledError, ChannelNotReadyError, isChannelNotReady } from '../errors'
import type { PolicyMirrorRow } from '../types'
import {
  buildReportRequest, createMicrosoftAdapter, csvFromReportZip, microsoftPolicyCheck, msBudgetCents, msHealthError,
  msNotReadyError, normalizeMsEntity, parseMsReportCsv,
} from './adapter.server'

// Shapes follow the Campaign Management and Reporting v13 REST responses for the fields the adapter reads.
const CAMPAIGN = {
  Id: 801234567, Name: 'Search | Wands', Status: 'Paused', CampaignType: 'Search', BudgetType: 'DailyBudgetStandard',
  DailyBudget: 15, BiddingScheme: { Type: 'EnhancedCpc' },
}
const AD_GROUP = { Id: 1301234567890, Name: 'Wand exact', Status: 'Paused', BiddingScheme: { Type: 'InheritFromParent' } }
const AD = { Id: 84012345678, Type: 'ResponsiveSearch', Status: 'Paused', EditorialStatus: 'Disapproved' }

const AD_CSV = [
  '﻿"TimePeriod","AccountId","CampaignId","AdGroupId","AdId","Impressions","Clicks","Spend","Conversions","Revenue"',
  '"2026-10-17","188472831","801234567","1301234567890","84012345678","1,204","37","18.42","1.00","29.99"',
  '"2026-10-18","188472831","801234567","1301234567890","84012345678","880","22","11.05","0.00","0.00"',
  '"2026-10-18","188472831","801234567","1301234567890","84012345678","20","1","0.40","0.00","0.00"',
  '"©2026 Microsoft Corporation. All rights reserved. "',
].join('\r\n')

const ACCOUNT = '188472831'

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', TrackingId: 't-1' } })
}

describe('Microsoft normalization', () => {
  it('normalizes a Search campaign with its daily budget in cents', () => {
    expect(normalizeMsEntity('campaign', ACCOUNT, CAMPAIGN, null)).toEqual({
      platform: 'microsoft', accountId: ACCOUNT, level: 'campaign', externalId: '801234567', parentExternalId: null,
      name: 'Search | Wands', status: 'Paused', effectiveStatus: 'Paused', objective: null,
      dailyBudgetCents: 1500, lifetimeBudgetCents: null, bidStrategy: 'EnhancedCpc', reviewFeedback: null, raw: CAMPAIGN,
    })
  })

  it('normalizes an ad group under its campaign', () => {
    const e = normalizeMsEntity('adset', ACCOUNT, AD_GROUP, '801234567')
    expect(e).toMatchObject({ level: 'adset', externalId: '1301234567890', parentExternalId: '801234567', dailyBudgetCents: null, bidStrategy: 'InheritFromParent' })
  })

  it('marks a disapproved ad DISAPPROVED and keeps the editorial status as feedback', () => {
    const e = normalizeMsEntity('ad', ACCOUNT, AD, '1301234567890')
    expect(e).toMatchObject({
      level: 'ad', externalId: '84012345678', parentExternalId: '1301234567890', name: 'ResponsiveSearch',
      status: 'Paused', effectiveStatus: 'DISAPPROVED', reviewFeedback: { EditorialStatus: 'Disapproved' }, bidStrategy: null,
    })
  })

  it('treats a zero or missing budget as null', () => {
    expect(msBudgetCents(0)).toBeNull()
    expect(msBudgetCents(undefined)).toBeNull()
    expect(msBudgetCents('12.5')).toBe(1250)
  })

  it('parses an ad report CSV, summing split rows and skipping the footer', () => {
    const rows = parseMsReportCsv('ad', AD_CSV)
    expect(rows).toEqual([
      {
        platform: 'microsoft', level: 'ad', externalId: '84012345678', day: '2026-10-17',
        spendCents: 1842, impressions: 1204, reach: 0, frequency: 0, clicks: 37, linkClicks: 37,
        leads: 0, platformPurchases: 1, platformPurchaseValueCents: 2999, actions: { conversions: 1 },
      },
      {
        platform: 'microsoft', level: 'ad', externalId: '84012345678', day: '2026-10-18',
        spendCents: 1145, impressions: 900, reach: 0, frequency: 0, clicks: 23, linkClicks: 23,
        leads: 0, platformPurchases: 0, platformPurchaseValueCents: 0, actions: { conversions: 0 },
      },
    ])
  })

  it('reads M/D/YYYY time periods from older report formats', () => {
    const rows = parseMsReportCsv('campaign', 'TimePeriod,CampaignId,Spend\n10/7/2026,801234567,3.00\n')
    expect(rows[0]).toMatchObject({ externalId: '801234567', day: '2026-10-07', spendCents: 300 })
  })

  it('reads the CSV out of the downloaded zip', () => {
    const zip = zipSync({ 'report.csv': strToU8('a,b\n1,2\n') })
    expect(csvFromReportZip(zip)).toBe('a,b\n1,2\n')
    expect(csvFromReportZip(strToU8('plain,csv\n'))).toBe('plain,csv\n')
  })

  it('builds a daily report request scoped to the account', () => {
    const req = buildReportRequest('ad', ACCOUNT, { since: '2026-10-12', until: '2026-10-18' })['ReportRequest'] as Record<string, unknown>
    expect(req).toMatchObject({
      Type: 'AdPerformanceReportRequest', Format: 'Csv', Aggregation: 'Daily', ExcludeReportHeader: true,
      Scope: { AccountIds: [188472831] },
      Time: { CustomDateRangeStart: { Day: 12, Month: 10, Year: 2026 }, CustomDateRangeEnd: { Day: 18, Month: 10, Year: 2026 } },
    })
    expect(req['Columns']).toEqual(expect.arrayContaining(['TimePeriod', 'AdId', 'Spend', 'Impressions', 'Clicks', 'Conversions']))
  })
})

describe('Microsoft adapter over the REST client, fetch mocked', () => {
  const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    vi.stubEnv('MSADS_ENV', 'sandbox')
    vi.stubEnv('MSADS_SANDBOX_CUSTOMER_ID', '251000001')
    vi.stubEnv('MSADS_SANDBOX_ACCOUNT_ID', ACCOUNT)
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    getMsAdsAccessToken.mockClear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const bodyOf = (i: number) => JSON.parse(String(fetchMock.mock.calls[i]![1]!.body)) as Record<string, unknown>
  const urlOf = (i: number) => String(fetchMock.mock.calls[i]![0])

  it('syncs campaigns, ad groups and ads for the configured account', async () => {
    fetchMock.mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/Campaigns/QueryByAccountId')) return jsonRes({ Campaigns: [CAMPAIGN] })
      if (url.endsWith('/AdGroups/QueryByCampaignId')) return jsonRes({ AdGroups: [AD_GROUP] })
      if (url.endsWith('/Ads/QueryByAdGroupId')) return jsonRes({ Ads: [AD] })
      return jsonRes({}, 404)
    })
    const entities = await createMicrosoftAdapter().syncEntities({})
    expect(entities.map(e => [e.level, e.externalId, e.parentExternalId])).toEqual([
      ['campaign', '801234567', null],
      ['adset', '1301234567890', '801234567'],
      ['ad', '84012345678', '1301234567890'],
    ])
    expect(urlOf(0)).toBe('https://campaign.api.sandbox.bingads.microsoft.com/CampaignManagement/v13/Campaigns/QueryByAccountId')
    expect(bodyOf(0)).toEqual({ AccountId: ACCOUNT, CampaignType: 'Search' })
    expect(bodyOf(1)).toEqual({ CampaignId: '801234567' })
    expect(bodyOf(2)).toMatchObject({ AdGroupId: '1301234567890' })
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer access-token-1')
    expect(headers['CustomerAccountId']).toBe(ACCOUNT)
  })

  it('pulls ad insights: submit, poll until done, download the zip, parse', async () => {
    const zip = zipSync({ 'AdPerformanceReport.csv': strToU8(AD_CSV) })
    let polls = 0
    fetchMock.mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/GenerateReport/Submit')) return jsonRes({ ReportRequestId: '3001234567_1' })
      if (url.endsWith('/GenerateReport/Poll')) {
        polls++
        return jsonRes({ ReportRequestStatus: polls < 2 ? { Status: 'Pending', ReportDownloadUrl: null } : { Status: 'Success', ReportDownloadUrl: 'https://bingadsappsstorageprod.blob.core.windows.net/r/1.zip?sig=x' } })
      }
      if (url.startsWith('https://bingadsappsstorageprod')) return new Response(zip, { status: 200 })
      return jsonRes({}, 404)
    })
    const sleep = vi.fn(async () => {})
    const rows = await createMicrosoftAdapter({ sleep, pollIntervalMs: 1 }).pullInsights({ since: '2026-10-17', until: '2026-10-18' }, 'ad')

    expect(urlOf(0)).toBe('https://reporting.api.sandbox.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit')
    expect((bodyOf(0)['ReportRequest'] as Record<string, unknown>)['Type']).toBe('AdPerformanceReportRequest')
    expect(bodyOf(1)).toEqual({ ReportRequestId: '3001234567_1' })
    expect(polls).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ platform: 'microsoft', level: 'ad', externalId: '84012345678', day: '2026-10-17', spendCents: 1842, platformPurchases: 1 })
  })

  it('returns no rows when the finished report has no download url', async () => {
    fetchMock.mockImplementation(async input => String(input).endsWith('/Submit')
      ? jsonRes({ ReportRequestId: 'r2' })
      : jsonRes({ ReportRequestStatus: { Status: 'Success', ReportDownloadUrl: null } }))
    expect(await createMicrosoftAdapter().pullInsights({ since: '2026-10-18', until: '2026-10-18' }, 'campaign')).toEqual([])
  })

  it('throws when the report job fails or never finishes', async () => {
    fetchMock.mockImplementation(async input => String(input).endsWith('/Submit')
      ? jsonRes({ ReportRequestId: 'r3' })
      : jsonRes({ ReportRequestStatus: { Status: 'Error' } }))
    await expect(createMicrosoftAdapter().pullInsights({ since: '2026-10-18', until: '2026-10-18' }, 'ad')).rejects.toMatchObject({ kind: 'report_failed' })

    fetchMock.mockImplementation(async input => String(input).endsWith('/Submit')
      ? jsonRes({ ReportRequestId: 'r4' })
      : jsonRes({ ReportRequestStatus: { Status: 'Pending' } }))
    const a = createMicrosoftAdapter({ sleep: async () => {}, maxPolls: 3 })
    await expect(a.pullInsights({ since: '2026-10-18', until: '2026-10-18' }, 'ad')).rejects.toMatchObject({ kind: 'report_timeout' })
  })

  it('refuses creative-level insights', async () => {
    await expect(createMicrosoftAdapter().pullInsights({ since: '2026-10-18', until: '2026-10-18' }, 'creative')).rejects.toThrow(/creative level/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The body Microsoft sent in production on 2026-10-20 for account 188472831,
  // Pending in the Adult Advertising Program, with a token exchange that worked.
  const INACTIVE = {
    Errors: [{
      Code: 105, ErrorCode: 'InvalidCredentials',
      Message: 'Authentication failed. Either supplied credentials are invalid or the account is inactive',
    }],
  }

  it('turns a 401 with code 105 on the entity sync into ChannelNotReadyError account_inactive', async () => {
    fetchMock.mockImplementation(async () => jsonRes(INACTIVE, 401))
    const err = await createMicrosoftAdapter().syncEntities({}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChannelNotReadyError)
    expect(err).toMatchObject({ channel: 'microsoft', reason: 'account_inactive', kind: 'not_ready' })
    expect((err as Error).message).toContain(ACCOUNT)
    expect((err as Error).message).toContain('Adult Advertising Program')
    expect((err as Error).message).not.toMatch(/\u2014/)
  })

  it('turns a 401 with code 105 on the report submit into ChannelNotReadyError', async () => {
    fetchMock.mockImplementation(async () => jsonRes(INACTIVE, 401))
    const err = await createMicrosoftAdapter().pullInsights({ since: '2026-10-19', until: '2026-10-20' }, 'ad').catch((e: unknown) => e)
    expect(isChannelNotReady(err)).toBe(true)
    expect(err).toMatchObject({ reason: 'account_inactive' })
  })

  it('leaves every other API error alone', async () => {
    fetchMock.mockImplementation(async () => jsonRes({ Errors: [{ Code: 109, ErrorCode: 'AuthenticationTokenExpired', Message: 'expired' }] }, 401))
    const expired = await createMicrosoftAdapter().syncEntities({}).catch((e: unknown) => e)
    expect(isChannelNotReady(expired)).toBe(false)
    expect((expired as Error).name).toBe('MsAdsApiError')

    fetchMock.mockImplementation(async () => jsonRes(INACTIVE, 500))
    const server = await createMicrosoftAdapter().syncEntities({}).catch((e: unknown) => e)
    expect(isChannelNotReady(server)).toBe(false)
  })
})

describe('msNotReadyError', () => {
  const apiError = (status: number, errors: unknown[], message = 'Microsoft Ads CampaignManagement/x failed') =>
    Object.assign(new Error(message), { name: 'MsAdsApiError', status, errors })

  it('maps 401 + 105 and nothing else', () => {
    expect(msNotReadyError(apiError(401, [{ code: 105, errorCode: 'InvalidCredentials', message: 'm', index: null }]), '188472831'))
      .toMatchObject({ reason: 'account_inactive' })
    expect(msNotReadyError(apiError(401, [{ code: 106, errorCode: null, message: 'm', index: null }]), '1')).toBeNull()
    expect(msNotReadyError(apiError(400, [{ code: 105, errorCode: null, message: 'm', index: null }]), '1')).toBeNull()
    expect(msNotReadyError(new Error('105: Authentication failed'), '1')).toBeNull()
    expect(msNotReadyError('nope', '1')).toBeNull()
  })

  it('falls back to the "105: " text when the structured list is empty', () => {
    const e = apiError(401, [], 'Microsoft Ads Reporting/GenerateReport/Submit failed (401): 105: Authentication failed.')
    expect(msNotReadyError(e, '188472831')?.message).toContain('188472831')
  })
})

describe('Microsoft token health', () => {
  const now = () => new Date('2026-10-19T12:00:00Z')

  it('is valid when the token exchange succeeds, with the expiry reported as unknown', async () => {
    const a = createMicrosoftAdapter({ missingConfig: () => [], accessToken: async () => 'tok', now, lastNotReady: async () => null })
    expect(await a.auth.health()).toEqual({
      valid: true, expiresAt: null, expiryUnknown: true, scopes: ['msads.manage'], checkedAt: '2026-10-19T12:00:00.000Z',
    })
  })

  it('reports ready false with the reason the last sync stored, and stays valid', async () => {
    const a = createMicrosoftAdapter({ missingConfig: () => [], accessToken: async () => 'tok', now, lastNotReady: async () => 'account_inactive' })
    expect(await a.auth.health()).toMatchObject({ valid: true, ready: false, notReadyReason: 'account_inactive', scopes: ['msads.manage'] })
  })

  it('treats a failed read of the stored reason as ready', async () => {
    const a = createMicrosoftAdapter({ missingConfig: () => [], accessToken: async () => 'tok', now })
    const h = await a.auth.health()
    expect(h.valid).toBe(true)
    expect(h.ready).toBeUndefined()
  })

  it('is not_configured when MSADS_* values are missing, without trying an exchange', async () => {
    const accessToken = vi.fn(async () => 'tok')
    const h = await createMicrosoftAdapter({ missingConfig: () => ['MSADS_ACCOUNT_ID'], accessToken, now }).auth.health()
    expect(h).toMatchObject({ valid: false, error: 'not_configured' })
    expect(accessToken).not.toHaveBeenCalled()
  })

  it('is invalid with token_rejected when Microsoft refuses the refresh token', async () => {
    const err = Object.assign(new Error('Microsoft Ads (production) is not connected: Microsoft rejected the stored refresh token (invalid_grant).'), { name: 'MsAdsNotConnectedError' })
    const h = await createMicrosoftAdapter({ missingConfig: () => [], accessToken: async () => { throw err }, now }).auth.health()
    expect(h).toMatchObject({ valid: false, expiresAt: null, expiryUnknown: true, error: 'token_rejected' })
  })

  it('maps the other exchange failures to codes the token health cron understands', () => {
    expect(msHealthError(Object.assign(new Error('no stored refresh token'), { name: 'MsAdsNotConnectedError' }))).toBe('not_connected')
    expect(msHealthError(new TypeError('fetch failed'))).toBe('network')
    expect(msHealthError(Object.assign(new Error('server_error'), { name: 'MsAdsTokenError' }))).toBe('api_error')
    expect(msHealthError('weird')).toBe('unknown')
  })
})

describe('Microsoft writes and policy', () => {
  it('has no mutations until the Adult Advertising Program accepts the account', async () => {
    const a = createMicrosoftAdapter()
    expect(a.capabilities).toEqual({ read: true, insights: true, mutate: [], audiences: 'none', preview: false })
    await expect(a.mutate({ verb: 'pause', target: { platform: 'microsoft', level: 'ad', externalId: '1' }, params: null }))
      .rejects.toBeInstanceOf(ChannelNotEnabledError)
  })

  it('createPaused refuses anything that is not a Microsoft Search payload, before any push', async () => {
    const pushDeps = vi.fn()
    await expect(createMicrosoftAdapter({ pushDeps }).createPaused({ nope: true })).rejects.toMatchObject({ code: 'not_exportable' })
    expect(pushDeps).not.toHaveBeenCalled()
  })

  it('createPaused delegates to the paused push, which checks the spend valve first', async () => {
    const call = vi.fn()
    const payload = { version: 1, campaign: {}, adGroup: {}, ad: {}, keywords: [] }
    const a = createMicrosoftAdapter({
      pushDeps: async () => ({
        spendEnabled: async () => false, missingConfig: () => [], env: () => 'sandbox', accountId: () => ACCOUNT,
        dailyCapCents: async () => 0, call,
      }),
    })
    await expect(a.createPaused(payload)).rejects.toMatchObject({ code: 'spend_disabled' })
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses while a mirrored Microsoft ad is disapproved', () => {
    const mirror: PolicyMirrorRow[] = [
      { platform: 'microsoft', level: 'ad', externalId: '84012345678', name: null, effectiveStatus: 'DISAPPROVED', reviewFeedback: null },
      { platform: 'meta', level: 'ad', externalId: '9', name: null, effectiveStatus: 'DISAPPROVED', reviewFeedback: null },
    ]
    const v = microsoftPolicyCheck({ mirror })
    expect(v.ok).toBe(false)
    expect(v.refusals).toEqual([expect.objectContaining({ code: 'microsoft_disapproved', ref: { platform: 'microsoft', level: 'ad', externalId: '84012345678' } })])
    expect(microsoftPolicyCheck({ mirror: [] })).toEqual({ ok: true, refusals: [] })
  })

  it('runs the Adult Advertising Program guard over a payload', () => {
    const payload = {
      version: 1, ideaId: 1, registerTier: '6-7',
      campaign: { Name: 'x', CampaignType: 'Search', BudgetType: 'DailyBudgetStandard', DailyBudget: 10, Status: 'Active' },
      adGroup: { Status: 'Paused' },
      ad: { Type: 'ResponsiveSearch', Status: 'Paused', Headlines: [], Descriptions: [], FinalUrls: ['https://xdipx.com/'] },
      keywords: [{ Text: 'lube', MatchType: 'Phrase', Status: 'Paused' }],
      negatives: [], targets: { ageRanges: [], locationIds: [] }, warnings: [],
    }
    const v = microsoftPolicyCheck({ mirror: [], payload, dailyCapCents: 5000 })
    expect(v.ok).toBe(false)
    const messages = v.refusals.map(r => r.message).join(' | ')
    expect(messages).toMatch(/register 3-4/)
    expect(messages).toMatch(/Paused/)
    expect(messages).toMatch(/not exact match/)
    expect(messages).toMatch(/condoms or lubricant/)
    expect(messages).toMatch(/adults-only line/)
    expect(v.refusals.every(r => r.code === 'microsoft_program_guard')).toBe(true)
  })
})
