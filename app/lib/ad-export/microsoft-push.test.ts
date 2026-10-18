import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import type { ExportIdea } from './common'
import { assembleAdGroup } from './google-editor-csv.server'
import {
  MS_ADULT_AGE_RANGES, MS_ADULT_LINE, MS_LOCATION_US, buildMicrosoftPayload, microsoftPolicyIssues, withAdultLine,
  type MsSearchPayload,
} from './microsoft-payload'
import { pushMicrosoftSearch, type MsPushDeps } from './microsoft-push.server'
import { extractErrors } from '~/lib/microsoft-ads-core'

const CAP = 2500

function idea(over: Partial<ExportIdea> = {}): ExportIdea {
  return {
    id: 52, lane: 'microsoft', registerTier: '3-4', conceptSlug: 'wand-guide', title: 'The wand, explained', oneLiner: null,
    products: [{ handle: 'magic-wand-rechargeable' }],
    headlines: ['Wand Massagers, Explained', 'Plain Box, Plain Label', 'Statement Reads XDIPX'],
    body: ['Corded or rechargeable, named plainly on every page.', 'Hand-checked before it is listed.'],
    audience: { ad_group: 'A0' },
    destinationUrl: 'https://xdipx.com/collections/magic-wand',
    breakEven: null,
    policyCheck: 'pass',
    status: 'hearted',
    ...over,
  }
}

function payloadFor(i: ExportIdea = idea()): MsSearchPayload {
  const g = assembleAdGroup(i, { creativeId: 901, campaign: 'xdipx-search-2026-10', dailyCapCents: CAP })
  return buildMicrosoftPayload({ ...g, ideaId: i.id }, { dailyBudgetCents: 1500, registerTier: i.registerTier })
}

describe('Microsoft payload', () => {
  it('builds a paused Search campaign with exact keywords, 18+ US targets and the adults line', () => {
    const p = payloadFor()
    expect(p.campaign).toMatchObject({ CampaignType: 'Search', Status: 'Paused', DailyBudget: 15, Languages: ['English'] })
    expect(p.adGroup.Status).toBe('Paused')
    expect(p.ad.Status).toBe('Paused')
    expect(p.keywords.length).toBeGreaterThan(0)
    expect(p.keywords.every(k => k.MatchType === 'Exact' && k.Status === 'Paused')).toBe(true)
    expect(p.warnings.some(w => /phrase keyword/.test(w))).toBe(true)
    expect(p.targets).toEqual({ ageRanges: [...MS_ADULT_AGE_RANGES], locationIds: [MS_LOCATION_US] })
    expect(p.ad.Descriptions.map(d => d.Asset.Text)).toContain(MS_ADULT_LINE)
    expect(new URL(p.ad.FinalUrls[0]).searchParams.get('utm_source')).toBe('bing')
    expect(new URL(p.ad.FinalUrls[0]).searchParams.get('utm_content')).toBe('901')
    expect(microsoftPolicyIssues(p, { dailyCapCents: CAP })).toEqual([])
  })

  it('keeps an existing adults line and replaces the fourth description when all four are taken', () => {
    expect(withAdultLine(['Adults only, shipped plain.', 'Two']).added).toBe(false)
    const out = withAdultLine(['One', 'Two', 'Three', 'Four'])
    expect(out.descriptions).toEqual(['One', 'Two', 'Three', MS_ADULT_LINE])
    expect(MS_ADULT_LINE.length).toBeLessThanOrEqual(90)
  })
})

describe('Microsoft policy guard', () => {
  it('refuses lubricant keywords and lubricant landing pages', () => {
    const p = payloadFor(idea({ audience: { ad_group: 'D' }, destinationUrl: 'https://xdipx.com/collections/lubricants', products: [{ handle: 'sliquid-h2o' }] }))
    const issues = microsoftPolicyIssues(p, { dailyCapCents: CAP })
    expect(issues.some(i => /condoms or lubricant/.test(i))).toBe(true)
    expect(issues.some(i => /lands on a lubricant/.test(i))).toBe(true)
  })

  it('refuses an Active status, a phrase keyword, a budget over the cap and a high register', () => {
    const p = payloadFor()
    const bad: MsSearchPayload = {
      ...p,
      registerTier: '6-7',
      campaign: { ...p.campaign, DailyBudget: 40 },
      keywords: [{ ...p.keywords[0]!, MatchType: 'Phrase' as 'Exact' }],
      ad: { ...p.ad, Status: 'Active' as 'Paused' },
    }
    const issues = microsoftPolicyIssues(bad, { dailyCapCents: CAP }).join(' | ')
    expect(issues).toMatch(/register 3-4/)
    expect(issues).toMatch(/must be Paused/)
    expect(issues).toMatch(/not exact match/)
    expect(issues).toMatch(/above the daily spend cap/)
  })

  it('refuses minors or unknown ages and non-US locations', () => {
    const p = payloadFor()
    const issues = microsoftPolicyIssues({ ...p, targets: { ageRanges: ['ThirteenToSeventeen', 'Unknown'], locationIds: [190, 32] } }, { dailyCapCents: CAP })
    expect(issues).toContain('Age targets must be exactly the 18 and over ranges')
    expect(issues).toContain('Location target must be the United States only')
  })
})

type Call = { path: string; body: Record<string, unknown> }

function deps(over: Partial<MsPushDeps> = {}, reply?: (c: Call) => { data: unknown; partial?: Array<{ code: number; errorCode: string; message: string; index: number }> }): { deps: MsPushDeps; calls: Call[] } {
  const calls: Call[] = []
  const ids: Record<string, unknown> = {
    Campaigns: { CampaignIds: [111] },
    EntityNegativeKeywords: { NegativeKeywordIds: [[1, 2]] },
    CampaignCriterions: { CampaignCriterionIds: [5, 6] },
    AdGroups: { AdGroupIds: [222] },
    Ads: { AdIds: [444] },
  }
  const d: MsPushDeps = {
    spendEnabled: async () => true,
    missingConfig: () => [],
    env: () => 'sandbox',
    accountId: () => '555660651',
    dailyCapCents: async () => CAP,
    call: async <T,>(_s: string, path: string, body: unknown) => {
      const c = { path, body: body as Record<string, unknown> }
      calls.push(c)
      if (reply) {
        const r = reply(c)
        return { data: r.data as T, partial: r.partial ?? [] }
      }
      if (path === 'Keywords') {
        const n = ((body as { Keywords: unknown[] }).Keywords).length
        return { data: { KeywordIds: Array.from({ length: n }, (_, i) => 300 + i) } as T, partial: [] }
      }
      return { data: ids[path] as T, partial: [] }
    },
    ...over,
  }
  return { deps: d, calls }
}

describe('pushMicrosoftSearch', () => {
  it('sends nothing and reads nothing when the valve is off', async () => {
    const missing = vi.fn(() => [])
    const { deps: d, calls } = deps({ spendEnabled: async () => false, missingConfig: missing })
    await expect(pushMicrosoftSearch(payloadFor(), {}, d)).rejects.toMatchObject({ code: 'spend_disabled' })
    expect(calls).toHaveLength(0)
    expect(missing).not.toHaveBeenCalled()
  })

  it('refuses when config is missing, and when the guard fails, before any call', async () => {
    const a = deps({ missingConfig: () => ['MSADS_CLIENT_SECRET'] })
    await expect(pushMicrosoftSearch(payloadFor(), {}, a.deps)).rejects.toMatchObject({ code: 'not_configured' })
    expect(a.calls).toHaveLength(0)
    const b = deps()
    const bad = payloadFor(idea({ audience: { ad_group: 'D' }, destinationUrl: 'https://xdipx.com/collections/lubricants' }))
    await expect(pushMicrosoftSearch(bad, {}, b.deps)).rejects.toMatchObject({ code: 'not_exportable' })
    expect(b.calls).toHaveLength(0)
  })

  it('creates campaign, negatives, targets, ad group, keywords and ad in order, all paused', async () => {
    const { deps: d, calls } = deps()
    const p = payloadFor()
    const res = await pushMicrosoftSearch(p, {}, d)
    expect(calls.map(c => c.path)).toEqual(['Campaigns', 'EntityNegativeKeywords', 'CampaignCriterions', 'AdGroups', 'Keywords', 'Ads'])
    expect(res).toMatchObject({ env: 'sandbox', campaignId: '111', adGroupId: '222', adId: '444', externalAdId: '444', reused: { campaign: false, adGroup: false } })
    expect(res.keywordIds).toHaveLength(p.keywords.length)
    expect(calls[0]!.body).toMatchObject({ AccountId: '555660651' })
    const crit = calls[2]!.body as { CriterionType: string; CampaignCriterions: Array<{ CampaignId: string; Criterion: Record<string, unknown> }> }
    expect(crit.CriterionType).toBe('Targets')
    expect(crit.CampaignCriterions.every(c => c.CampaignId === '111')).toBe(true)
    expect(crit.CampaignCriterions.filter(c => c.Criterion['Type'] === 'AgeCriterion')).toHaveLength(MS_ADULT_AGE_RANGES.length)
    expect(crit.CampaignCriterions.filter(c => c.Criterion['LocationId'] === MS_LOCATION_US)).toHaveLength(1)
    expect(JSON.stringify(calls)).not.toMatch(/"Status":"Active"/)
  })

  it('reuses an existing campaign and skips its negatives and targets', async () => {
    const { deps: d, calls } = deps()
    const res = await pushMicrosoftSearch(payloadFor(), { campaignId: '999', negativesAdded: true, targetsAdded: true }, d)
    expect(calls.map(c => c.path)).toEqual(['AdGroups', 'Keywords', 'Ads'])
    expect(calls[0]!.body).toMatchObject({ CampaignId: '999' })
    expect(res.reused.campaign).toBe(true)
  })

  it('stops on partial errors and reports the ids created so far', async () => {
    const { deps: d } = deps({}, c => c.path === 'AdGroups'
      ? { data: { AdGroupIds: [null] }, partial: [{ code: 1201, errorCode: 'CampaignServiceInvalidAdGroupName', message: 'bad name', index: 0 }] }
      : { data: c.path === 'Campaigns' ? { CampaignIds: [111] } : {} })
    await expect(pushMicrosoftSearch(payloadFor(), {}, d)).rejects.toMatchObject({
      code: 'api_error',
      partial: { campaignId: '111', negativesAdded: true, targetsAdded: true },
    })
  })
})

describe('pushMicrosoftSearch retry', () => {
  it('treats an already existing target as done', async () => {
    const { deps: d, calls } = deps({}, c => {
      if (c.path === 'CampaignCriterions') return { data: { CampaignCriterionIds: [null] }, partial: [{ code: 1043, errorCode: 'CampaignServiceEntityAlreadyExists', message: 'exists', index: 0 }] }
      if (c.path === 'Keywords') return { data: { KeywordIds: (c.body['Keywords'] as unknown[]).map((_, i) => i + 1) } }
      return { data: { AdGroupIds: [222], AdIds: [444] } }
    })
    const res = await pushMicrosoftSearch(payloadFor(), { campaignId: '111', negativesAdded: true }, d)
    expect(res.adId).toBe('444')
    expect(calls.filter(c => c.path === 'CampaignCriterions')).toHaveLength(1)
  })
})

describe('extractErrors NestedPartialErrors', () => {
  it('reads a collection-level error when BatchErrors is null', () => {
    const body = { NestedPartialErrors: [{ BatchErrors: null, Code: 1043, ErrorCode: 'CampaignServiceEntityAlreadyExists', Message: 'exists', Index: 0 }] }
    expect(extractErrors(body).partial).toEqual([{ code: 1043, errorCode: 'CampaignServiceEntityAlreadyExists', message: 'exists', index: 0 }])
  })

  it('flattens nested batch errors into partial', () => {
    const body = { NestedPartialErrors: [{ Index: 0, BatchErrors: [{ Code: 1043, ErrorCode: 'InvalidAgeRange', Message: 'bad', Index: 0 }] }] }
    expect(extractErrors(body).partial).toEqual([{ code: 1043, errorCode: 'InvalidAgeRange', message: 'bad', index: 0 }])
    expect(extractErrors({ NestedPartialErrors: [] }).partial).toEqual([])
  })
})
