/**
 * Microsoft Search push: create one paused Search campaign, ad group, exact
 * keywords and responsive search ad through the Campaign Management REST API.
 * See microsoft-payload.ts for what the payload holds and what the guard refuses.
 * Order of refusals is deliberate and tested: the valve is checked FIRST, so
 * with ads_spend_enabled off nothing else is read or sent.
 *
 *   1. valve off                     -> MsPushError('spend_disabled')
 *   2. MSADS_* config missing        -> MsPushError('not_configured')
 *   3. policy guard finds an issue   -> MsPushError('not_exportable')
 *   4. calls in order, all Paused:
 *      campaign, campaign negatives, age + location targets, ad group, keywords, ad
 *
 * A campaign that already exists (a sibling idea in the same campaign, or this
 * creative's own earlier partial push) is reused, and the steps it records as
 * done are skipped, so a retry never duplicates. A failure part way throws with
 * the ids created so far on the error for the caller to store.
 */
import type { MsAdsEnv, MsAdsErrorItem, MsAdsService } from '~/lib/microsoft-ads-core'
import { describeErrors } from '~/lib/microsoft-ads-core'
import { MsPushError, microsoftPolicyIssues, type MsPushPartial, type MsSearchPayload } from './microsoft-payload'

export interface MsPushDeps {
  spendEnabled: () => Promise<boolean>
  /** Names of MSADS_* variables still unset for the active environment. */
  missingConfig: () => string[]
  env: () => MsAdsEnv
  accountId: () => string
  dailyCapCents: () => Promise<number>
  call: <T>(service: MsAdsService, path: string, body: unknown) => Promise<{ data: T; partial: MsAdsErrorItem[] }>
}

export type MsPushExisting = MsPushPartial

export interface MsPushResult {
  env: MsAdsEnv
  campaignName: string
  campaignId: string
  adGroupId: string
  keywordIds: string[]
  adId: string
  externalAdId: string
  pushedAt: string
  reused: { campaign: boolean; adGroup: boolean }
  warnings: string[]
}

/** CampaignServiceEntityAlreadyExists. */
const ENTITY_ALREADY_EXISTS = 1043

function firstId(list: unknown): string | null {
  if (!Array.isArray(list)) return null
  const v = list[0]
  return v == null ? null : String(v)
}

/** Create the paused Search objects for one payload. Never creates anything Active. */
export async function pushMicrosoftSearch(
  payload: MsSearchPayload,
  existing: MsPushExisting,
  deps: MsPushDeps,
): Promise<MsPushResult> {
  if (!(await deps.spendEnabled())) {
    throw new MsPushError('spend_disabled', 'Spend is off (ads_spend_enabled is false). Nothing was sent to Microsoft.')
  }
  const missing = deps.missingConfig()
  if (missing.length) throw new MsPushError('not_configured', `Microsoft Ads is not configured: ${missing.join(', ')} not set. Nothing was sent.`)
  const issues = microsoftPolicyIssues(payload, { dailyCapCents: await deps.dailyCapCents() })
  if (issues.length) throw new MsPushError('not_exportable', `Refusing: ${issues.slice(0, 4).join('; ')}.`)

  const env = deps.env()
  const accountId = deps.accountId()
  const partial: MsPushPartial = { ...existing }

  /** One API call. Partial errors fail the step unless every one is in `tolerate`. */
  async function step<T>(name: string, path: string, body: unknown, tolerate: readonly number[] = []): Promise<T> {
    let out: { data: T; partial: MsAdsErrorItem[] }
    try {
      out = await deps.call<T>('CampaignManagement', path, body)
    } catch (err) {
      throw new MsPushError('api_error', `Microsoft ${name} refused: ${err instanceof Error ? err.message : String(err)}`, { ...partial })
    }
    if (out.partial.some(e => e.code === null || !tolerate.includes(e.code))) {
      throw new MsPushError('api_error', `Microsoft ${name} refused: ${describeErrors(out.partial)}`, { ...partial })
    }
    return out.data
  }

  // 1. campaign
  const reusedCampaign = !!partial.campaignId
  if (!partial.campaignId) {
    const r = await step<{ CampaignIds?: unknown }>('campaign', 'Campaigns', { AccountId: accountId, Campaigns: [payload.campaign] })
    const id = firstId(r.CampaignIds)
    if (!id) throw new MsPushError('api_error', 'Microsoft campaign create returned no id.', { ...partial })
    partial.campaignId = id
  }
  const campaignId = partial.campaignId

  // 2. negatives, before the first impression
  if (!partial.negativesAdded) {
    await step('negative keywords', 'EntityNegativeKeywords', {
      EntityNegativeKeywords: [{
        EntityId: campaignId,
        EntityType: 'Campaign',
        NegativeKeywords: payload.negatives.map(Text => ({ Type: 'NegativeKeyword', Text, MatchType: 'Phrase' })),
      }],
    })
    partial.negativesAdded = true
  }

  // 3. age 18 and over, United States. A retry re-sends all of them, so
  // "already exists" (1043) counts as done.
  if (!partial.targetsAdded) {
    const criterion = (Criterion: Record<string, unknown>) => ({
      Type: 'BiddableCampaignCriterion',
      CampaignId: campaignId,
      Criterion,
      CriterionBid: { Type: 'BidMultiplier', Multiplier: 0 },
    })
    await step('age and location targets', 'CampaignCriterions', {
      CriterionType: 'Targets',
      CampaignCriterions: [
        ...payload.targets.ageRanges.map(AgeRange => criterion({ Type: 'AgeCriterion', AgeRange })),
        ...payload.targets.locationIds.map(LocationId => criterion({ Type: 'LocationCriterion', LocationId })),
      ],
    }, [ENTITY_ALREADY_EXISTS])
    partial.targetsAdded = true
  }

  // 4. ad group
  const reusedAdGroup = !!partial.adGroupId
  if (!partial.adGroupId) {
    const r = await step<{ AdGroupIds?: unknown }>('ad group', 'AdGroups', { CampaignId: campaignId, AdGroups: [payload.adGroup] })
    const id = firstId(r.AdGroupIds)
    if (!id) throw new MsPushError('api_error', 'Microsoft ad group create returned no id.', { ...partial })
    partial.adGroupId = id
  }
  const adGroupId = partial.adGroupId

  // 5. keywords
  if (!partial.keywordIds?.length) {
    const r = await step<{ KeywordIds?: unknown }>('keywords', 'Keywords', { AdGroupId: adGroupId, Keywords: payload.keywords })
    const ids = Array.isArray(r.KeywordIds) ? r.KeywordIds.filter(v => v != null).map(String) : []
    if (ids.length !== payload.keywords.length) throw new MsPushError('api_error', `Microsoft accepted ${ids.length} of ${payload.keywords.length} keywords.`, { ...partial })
    partial.keywordIds = ids
  }

  // 6. ad
  if (!partial.adId) {
    const r = await step<{ AdIds?: unknown }>('ad', 'Ads', { AdGroupId: adGroupId, Ads: [payload.ad] })
    const id = firstId(r.AdIds)
    if (!id) throw new MsPushError('api_error', 'Microsoft ad create returned no id.', { ...partial })
    partial.adId = id
  }

  return {
    env,
    campaignName: payload.campaign.Name,
    campaignId,
    adGroupId,
    keywordIds: partial.keywordIds ?? [],
    adId: partial.adId,
    externalAdId: partial.adId,
    pushedAt: new Date().toISOString(),
    reused: { campaign: reusedCampaign, adGroup: reusedAdGroup },
    warnings: payload.warnings,
  }
}
