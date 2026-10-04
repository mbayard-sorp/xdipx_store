/**
 * Shapes and safety assertions for the Meta paused draft payload set. Pure and
 * client-safe, so the admin payload sheet and the tests can read them.
 */
import type { ExportPushErrorCode } from './types'
import { META_DESCRIPTION_MAX } from './policy'

export const META_OBJECT_STATUS = 'PAUSED' as const

export function fitsMetaDescription(s: string): boolean {
  return s.length <= META_DESCRIPTION_MAX
}

export interface MetaDraftAd {
  creativeId: number
  format: string
  /** The adimages step: bytes are fetched from assetUrl at push time, never inlined here. */
  image: { step: 'adimages'; assetUrl: string; filename: string; width: number | null; height: number | null }
  adCreative: {
    name: string
    object_story_spec: {
      page_id: string
      link_data: {
        image_hash: string
        link: string
        message: string
        name: string
        description?: string
        call_to_action: { type: 'SHOP_NOW'; value: { link: string } }
      }
    }
  }
  ad: { name: string; status: typeof META_OBJECT_STATUS; adset_id: string; creative: { creative_id: string } }
  preview: { headline: string; primaryText: string; description: string | null; link: string }
}

export interface MetaDraftPayload {
  version: 1
  exporter: 'meta-paused-draft'
  status: 'ready'
  apiVersion: string
  ideaId: number
  builtAt: string
  safety: { everyObjectStatus: typeof META_OBJECT_STATUS; ageMin: 25; countries: string[]; specialAdCategories: string[]; neverActive: true }
  pageIdConfigured: boolean
  budget: { dailyCents: number; capCents: number; source: string }
  campaign: {
    name: string
    objective: 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC'
    status: typeof META_OBJECT_STATUS
    special_ad_categories: string[]
    buying_type: 'AUCTION'
    is_adset_budget_sharing_enabled: false
  }
  adSet: {
    name: string
    campaign_id: string
    status: typeof META_OBJECT_STATUS
    daily_budget: number
    billing_event: 'IMPRESSIONS'
    optimization_goal: 'LINK_CLICKS'
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP'
    destination_type: 'WEBSITE'
    targeting: {
      age_min: 25
      age_max: number
      geo_locations: { countries: string[] }
      targeting_automation: { advantage_audience: 0 }
    }
  }
  ads: MetaDraftAd[]
  preview: string[]
  warnings: string[]
  mcpEquivalent: string[]
}

export function isMetaDraftPayload(v: unknown): v is MetaDraftPayload {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o['exporter'] === 'meta-paused-draft' && o['version'] === 1 && Array.isArray(o['ads']) && !!o['campaign'] && !!o['adSet']
}

/** Thrown by push. `partial` carries any ids already created so a retry reuses them. */
export class MetaPushError extends Error {
  readonly code: ExportPushErrorCode
  readonly partial: { imageHash?: string; campaignId?: string; adSetId?: string; creativeId?: string; adId?: string }
  constructor(code: ExportPushErrorCode, message: string, partial: MetaPushError['partial'] = {}) {
    super(message)
    this.name = 'MetaPushError'
    this.code = code
    this.partial = partial
  }

  /** Every object PAUSED, age_min 25, US, no special categories, no Advantage+ audience. Throws otherwise. */
  static assertSafe(p: MetaDraftPayload): void {
    const bad: string[] = []
    if (p.campaign.status !== 'PAUSED') bad.push('campaign status')
    if (p.adSet.status !== 'PAUSED') bad.push('ad set status')
    for (const a of p.ads) if (a.ad.status !== 'PAUSED') bad.push(`ad ${a.creativeId} status`)
    if (p.adSet.targeting.age_min !== 25) bad.push('age_min')
    if (p.adSet.targeting.targeting_automation.advantage_audience !== 0) bad.push('advantage audience')
    if (p.adSet.targeting.geo_locations.countries.join(',') !== 'US') bad.push('countries')
    if (p.campaign.special_ad_categories.length !== 0) bad.push('special_ad_categories')
    if (/"status"\s*:\s*"ACTIVE"/i.test(JSON.stringify(p))) bad.push('an ACTIVE status somewhere in the payload')
    if (bad.length) throw new MetaPushError('not_exportable', `Refusing: payload is not a safe paused draft (${bad.join(', ')}).`)
  }
}
