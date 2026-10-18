/**
 * Microsoft Search push: the payload and the policy guard. Pure (no db, no
 * network), so the guard is unit-tested and the push step can call it last.
 *
 * Microsoft accepts xdipx only through the Adult Advertising Program
 * (docs/ads-policy.md, Microsoft row). The guard turns that program's rules
 * into checks the push refuses on, whatever the idea or the copy bank says:
 *
 *   - Search campaign only, text responsive search ad only
 *   - every object Paused: campaign, ad group, keywords, ad
 *   - exact match keywords only (phrase rows from the copy bank are converted)
 *   - no condom or lubricant terms in keywords, ad text or the landing path
 *   - an adults-only line in the descriptions
 *   - age targets 18 and over only, location US only
 *   - the shared negative list on the campaign
 *   - register 3-4 (4-5 for factual product text), plain ASCII text, xdipx.com
 *     final URL carrying utm_source=bing and utm_content
 *
 * The owner flips objects live in the Microsoft Advertising UI. Nothing here
 * can produce an Active status.
 */
import type { ExportPushErrorCode } from './types'
import type { PlannedKeyword } from './google-bank'
import { ALL_NEGATIVES } from './google-bank'
import { RSA_DESCRIPTIONS_MAX, RSA_DESCRIPTION_MAX, RSA_HEADLINES_MAX, RSA_PATH_MAX, googleTextIssues } from './policy'
import { clip } from './common'

export const MS_OBJECT_STATUS = 'Paused' as const

/** Added to the descriptions when the idea has no adults-only line of its own. */
export const MS_ADULT_LINE = 'For adults 18 and over. Discreet shipping, plain box.'
const ADULT_LINE_RE = /\b(18\s?\+|18 and over|adults only|adults-only|for adults)\b/i

/**
 * Microsoft AgeRange values at or over 18. Unknown is left out on purpose.
 * "Fourty" is Microsoft's spelling; the correct spelling fails deserialization
 * with "100: The request message is null".
 */
export const MS_ADULT_AGE_RANGES = [
  'EighteenToTwentyFour', 'TwentyFiveToThirtyFour', 'ThirtyFiveToFourtyNine', 'FiftyToSixtyFour', 'SixtyFiveAndAbove',
] as const

/** Microsoft location id for the United States. */
export const MS_LOCATION_US = 190

/** Not allowed in the Adult Advertising Program's keyword list for this account. */
const BLOCKED_TERMS = /\b(condoms?|lubes?|lubricants?|sliquid|system jo|h2o)\b/i

const MS_REGISTERS = new Set(['3-4', '4-5'])

export interface MsTextAsset { Asset: { Type: 'TextAsset'; Text: string } }

export interface MsSearchPayload {
  version: 1
  ideaId: number
  registerTier: string
  campaign: {
    Name: string
    CampaignType: 'Search'
    BudgetType: 'DailyBudgetStandard'
    DailyBudget: number
    TimeZone: 'PacificTimeUSCanadaTijuana'
    Languages: ['English']
    Status: typeof MS_OBJECT_STATUS
    BiddingScheme: { Type: 'ManualCpc' }
  }
  /** Campaign-level negatives, phrase match. */
  negatives: string[]
  targets: { ageRanges: string[]; locationIds: number[] }
  adGroup: { Name: string; Status: typeof MS_OBJECT_STATUS; CpcBid: { Amount: number } }
  keywords: Array<{ Text: string; MatchType: 'Exact'; Bid: { Amount: number }; Status: typeof MS_OBJECT_STATUS }>
  ad: {
    Type: 'ResponsiveSearch'
    Headlines: MsTextAsset[]
    Descriptions: MsTextAsset[]
    Path1: string
    Path2: string
    FinalUrls: [string]
    Status: typeof MS_OBJECT_STATUS
  }
  warnings: string[]
}

/** The parts of an assembled Search ad group the payload needs (see assembleAdGroup). */
export interface MsAdGroupInput {
  ideaId: number
  campaign: string
  adGroup: string
  keywords: readonly PlannedKeyword[]
  maxCpcUsd: number
  headlines: readonly string[]
  descriptions: readonly string[]
  path1: string
  path2: string
  finalUrl: string
}

const asset = (Text: string): MsTextAsset => ({ Asset: { Type: 'TextAsset', Text } })

/** Make sure one description says the ad is for adults, replacing the last one when all four are taken. */
export function withAdultLine(descriptions: readonly string[]): { descriptions: string[]; added: boolean } {
  if (descriptions.some(d => ADULT_LINE_RE.test(d))) return { descriptions: [...descriptions], added: false }
  const out = descriptions.slice(0, RSA_DESCRIPTIONS_MAX)
  if (out.length >= RSA_DESCRIPTIONS_MAX) out[RSA_DESCRIPTIONS_MAX - 1] = MS_ADULT_LINE
  else out.push(MS_ADULT_LINE)
  return { descriptions: out, added: true }
}

export function buildMicrosoftPayload(
  group: MsAdGroupInput,
  opts: { dailyBudgetCents: number; registerTier: string },
): MsSearchPayload {
  const warnings: string[] = []
  const bid = Math.round(group.maxCpcUsd * 100) / 100

  const seen = new Set<string>()
  const keywords: MsSearchPayload['keywords'] = []
  let converted = 0
  for (const k of group.keywords) {
    const text = k.text.trim().toLowerCase()
    if (!text || seen.has(text)) continue
    seen.add(text)
    if (k.match !== 'Exact') converted++
    keywords.push({ Text: text, MatchType: 'Exact', Bid: { Amount: bid }, Status: MS_OBJECT_STATUS })
  }
  if (converted) warnings.push(`Converted ${converted} phrase keyword${converted === 1 ? '' : 's'} to exact match (Adult Advertising Program).`)

  const adult = withAdultLine(group.descriptions)
  if (adult.added) warnings.push('Added the adults-only line to the descriptions.')

  return {
    version: 1,
    ideaId: group.ideaId,
    registerTier: opts.registerTier,
    campaign: {
      Name: group.campaign,
      CampaignType: 'Search',
      BudgetType: 'DailyBudgetStandard',
      DailyBudget: Math.round(opts.dailyBudgetCents) / 100,
      TimeZone: 'PacificTimeUSCanadaTijuana',
      Languages: ['English'],
      Status: MS_OBJECT_STATUS,
      BiddingScheme: { Type: 'ManualCpc' },
    },
    negatives: [...ALL_NEGATIVES],
    targets: { ageRanges: [...MS_ADULT_AGE_RANGES], locationIds: [MS_LOCATION_US] },
    adGroup: { Name: group.adGroup, Status: MS_OBJECT_STATUS, CpcBid: { Amount: bid } },
    keywords,
    ad: {
      Type: 'ResponsiveSearch',
      Headlines: group.headlines.slice(0, RSA_HEADLINES_MAX).map(asset),
      Descriptions: adult.descriptions.map(asset),
      Path1: group.path1.slice(0, RSA_PATH_MAX),
      Path2: group.path2.slice(0, RSA_PATH_MAX),
      FinalUrls: [group.finalUrl],
      Status: MS_OBJECT_STATUS,
    },
    warnings,
  }
}

/** Every reason the payload may not go to Microsoft. Empty means it may. */
export function microsoftPolicyIssues(p: MsSearchPayload, opts: { dailyCapCents: number }): string[] {
  const issues: string[] = []
  const headlines = p.ad.Headlines.map(h => h.Asset.Text)
  const descriptions = p.ad.Descriptions.map(d => d.Asset.Text)

  if (!MS_REGISTERS.has(p.registerTier)) issues.push(`Microsoft copy runs at register 3-4 (4-5 for factual product text), this idea is ${p.registerTier}`)
  if (p.campaign.CampaignType !== 'Search') issues.push('Campaign type must be Search')
  if (p.ad.Type !== 'ResponsiveSearch') issues.push('Ad must be a responsive search ad (text only)')

  const statuses = [p.campaign.Status, p.adGroup.Status, p.ad.Status, ...p.keywords.map(k => k.Status)]
  if (statuses.some(s => s !== MS_OBJECT_STATUS)) issues.push('Every campaign, ad group, keyword and ad must be Paused')
  if (/"Status"\s*:\s*"Active"/i.test(JSON.stringify(p))) issues.push('An Active status appears in the payload')

  if (p.keywords.length === 0) issues.push('No keywords')
  for (const k of p.keywords) {
    if (k.MatchType !== 'Exact') issues.push(`Keyword "${k.Text}" is not exact match`)
    if (BLOCKED_TERMS.test(k.Text)) issues.push(`Keyword "${k.Text}" names condoms or lubricant, which this program does not allow`)
  }
  for (const t of [...headlines, ...descriptions]) {
    if (BLOCKED_TERMS.test(t)) issues.push(`Ad text "${clip(t)}" names condoms or lubricant`)
  }
  if (!descriptions.some(d => ADULT_LINE_RE.test(d))) issues.push('No adults-only line in the descriptions')
  for (const d of descriptions) if (d.length > RSA_DESCRIPTION_MAX) issues.push(`Description over ${RSA_DESCRIPTION_MAX} characters: "${clip(d)}"`)

  const ages = [...p.targets.ageRanges].sort().join(',')
  if (ages !== [...MS_ADULT_AGE_RANGES].sort().join(',')) issues.push('Age targets must be exactly the 18 and over ranges')
  if (p.targets.locationIds.join(',') !== String(MS_LOCATION_US)) issues.push('Location target must be the United States only')
  if (!p.negatives.includes('teen') || p.negatives.length < 10) issues.push('Campaign negative list is missing')

  if (!(p.campaign.DailyBudget > 0)) issues.push('Daily budget must be above zero')
  if (Math.round(p.campaign.DailyBudget * 100) > opts.dailyCapCents) issues.push('Daily budget is above the daily spend cap')

  const finalUrl = p.ad.FinalUrls[0]
  issues.push(...googleTextIssues({ headlines, descriptions, finalUrl, paths: [p.ad.Path1, p.ad.Path2].filter(Boolean) }))
  try {
    const u = new URL(finalUrl)
    if (u.hostname !== 'xdipx.com' && u.hostname !== 'www.xdipx.com') issues.push(`Final URL host ${u.hostname} is not xdipx.com`)
    if (u.searchParams.get('utm_source') !== 'bing') issues.push('Final URL must carry utm_source=bing')
    if (BLOCKED_TERMS.test(u.pathname)) issues.push(`Final URL ${u.pathname} lands on a lubricant or condom page`)
  } catch { /* googleTextIssues already reported it */ }

  return [...new Set(issues)]
}

export interface MsPushPartial {
  campaignId?: string
  negativesAdded?: boolean
  targetsAdded?: boolean
  adGroupId?: string
  keywordIds?: string[]
  adId?: string
}

export class MsPushError extends Error {
  readonly code: ExportPushErrorCode
  readonly partial: MsPushPartial
  constructor(code: ExportPushErrorCode, message: string, partial: MsPushPartial = {}) {
    super(message)
    this.name = 'MsPushError'
    this.code = code
    this.partial = partial
  }
}
