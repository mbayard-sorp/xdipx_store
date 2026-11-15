/**
 * ExoClick kill rules (ticket #19412). Pure: no I/O, no clock, no settings.
 * Given what the placement, variation and campaign reads returned, it says
 * which brakes to pull. Brakes only: every action here stops or narrows
 * delivery, and none can raise spend.
 *
 * Why these rules: round one of the first ExoClick test spent half its money
 * on sites that never clicked (docs/store-team/sales-pages.md, "Reading a
 * paid test"). The owner asked twice to watch for runaway impressions with no
 * clicks and for a way to exclude sites.
 */

// -- Thresholds ----------------------------------------------------------------

/** A site with at least this many impressions and no clicks is blocked. */
export const SITE_ZERO_CLICK_MIN_IMPRESSIONS = 2000
/** A site with at least this many impressions and a CTR under the floor is blocked. */
export const SITE_LOW_CTR_MIN_IMPRESSIONS = 5000
/** CTR floor for a site, in percent (0.02 means 0.02%). */
export const SITE_LOW_CTR_PCT = 0.02
/** A variation with at least this many impressions and no clicks is paused. */
export const VARIATION_ZERO_CLICK_MIN_IMPRESSIONS = 5000
/** A campaign with at least this many impressions and a CTR under the floor is paused. */
export const CAMPAIGN_LOW_CTR_MIN_IMPRESSIONS = 20000
/** CTR floor for a campaign, in percent. */
export const CAMPAIGN_LOW_CTR_PCT = 0.03
/** A campaign that spends more than this in any one hour is paused, in cents ($5). */
export const CAMPAIGN_HOURLY_SPEND_CENTS = 500
/** The arrivals check starts at this many billed clicks. */
export const ARRIVALS_MIN_BILLED_CLICKS = 50
/** Fewer arrivals than this share of billed clicks pauses the campaign. */
export const ARRIVALS_MIN_RATIO = 0.5

// -- Inputs --------------------------------------------------------------------

/** One site's stats summed over the campaign set and the window. */
export interface SiteRow {
  hostname: string
  impressions: number
  clicks: number
  costCents?: number
}

export interface VariationRow {
  id: string
  campaignId: string
  impressions: number
  clicks: number
}

export interface CampaignRow {
  id: string
  /** 'ACTIVE' | 'PAUSED' | 'ARCHIVED'. Only ACTIVE campaigns are paused. */
  status: string
  impressions: number
  clicks: number
  costCents?: number
  /** The most this campaign spent in any single hour in the window, in cents. Null when not read. */
  maxHourlySpendCents?: number | null
}

/**
 * Landing-page arrivals for the window. A number is the total across the
 * set; a record is per campaign id. Null means unknown and skips the rule.
 */
export type ArrivalsInput = number | Record<string, number> | null

export interface KillRuleInput {
  /** The campaign set the rules apply to. A site block goes on every one of them. */
  campaignIds: readonly string[]
  sites: readonly SiteRow[]
  variations: readonly VariationRow[]
  campaigns: readonly CampaignRow[]
  arrivals: ArrivalsInput
}

// -- Outputs -------------------------------------------------------------------

export type KillRuleId = 'site_zero_click' | 'site_low_ctr' | 'variation_zero_click' | 'campaign_low_ctr' | 'campaign_hourly_spend' | 'arrivals_shortfall'

export interface BlockSiteAction {
  kind: 'block_site'
  rule: Extract<KillRuleId, 'site_zero_click' | 'site_low_ctr'>
  hostname: string
  /** Every campaign in the set. */
  campaignIds: string[]
  reason: string
}

export interface PauseVariationAction {
  kind: 'pause_variation'
  rule: 'variation_zero_click'
  variationId: string
  campaignId: string
  reason: string
}

export interface PauseCampaignAction {
  kind: 'pause_campaign'
  rule: Extract<KillRuleId, 'campaign_low_ctr' | 'campaign_hourly_spend' | 'arrivals_shortfall'>
  campaignId: string
  reason: string
}

export type KillAction = BlockSiteAction | PauseVariationAction | PauseCampaignAction

/** CTR in percent. Zero impressions is zero CTR, never NaN. */
export function ctrPct(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0
}

const pct = (n: number) => `${Math.round(n * 1000) / 1000}%`

// -- Evaluator -----------------------------------------------------------------

export function evaluateKillRules(input: KillRuleInput): KillAction[] {
  const actions: KillAction[] = []
  const setIds = [...new Set(input.campaignIds)]

  // Sites. Zero-click wins over low-CTR when both would fire, so one site is one action.
  for (const s of input.sites) {
    const host = s.hostname.trim().toLowerCase()
    if (!host) continue
    if (s.impressions >= SITE_ZERO_CLICK_MIN_IMPRESSIONS && s.clicks === 0) {
      actions.push({
        kind: 'block_site', rule: 'site_zero_click', hostname: host, campaignIds: setIds,
        reason: `${host}: ${s.impressions} impressions, 0 clicks (rule: ${SITE_ZERO_CLICK_MIN_IMPRESSIONS}+ impressions and no clicks)`,
      })
    } else if (s.impressions >= SITE_LOW_CTR_MIN_IMPRESSIONS && ctrPct(s.clicks, s.impressions) < SITE_LOW_CTR_PCT) {
      actions.push({
        kind: 'block_site', rule: 'site_low_ctr', hostname: host, campaignIds: setIds,
        reason: `${host}: ${s.impressions} impressions, CTR ${pct(ctrPct(s.clicks, s.impressions))} (rule: ${SITE_LOW_CTR_MIN_IMPRESSIONS}+ impressions and CTR under ${SITE_LOW_CTR_PCT}%)`,
      })
    }
  }

  // Variations.
  const pausedCampaignStatus = new Map(input.campaigns.map(c => [c.id, c.status]))
  for (const v of input.variations) {
    if (v.impressions >= VARIATION_ZERO_CLICK_MIN_IMPRESSIONS && v.clicks === 0) {
      // A variation in a campaign that is not running is already not delivering.
      const status = pausedCampaignStatus.get(v.campaignId)
      if (status !== undefined && status !== 'ACTIVE') continue
      actions.push({
        kind: 'pause_variation', rule: 'variation_zero_click', variationId: v.id, campaignId: v.campaignId,
        reason: `variation ${v.id}: ${v.impressions} impressions, 0 clicks (rule: ${VARIATION_ZERO_CLICK_MIN_IMPRESSIONS}+ impressions and no clicks)`,
      })
    }
  }

  // Campaigns. One pause per campaign: the first rule that fires names it.
  const arrivalsFor = (id: string): number | null => {
    if (input.arrivals === null || input.arrivals === undefined) return null
    if (typeof input.arrivals === 'number') return input.arrivals
    const v = input.arrivals[id]
    return typeof v === 'number' ? v : null
  }
  const totalBilled = input.campaigns.reduce((n, c) => n + c.clicks, 0)
  for (const c of input.campaigns) {
    if (c.status !== 'ACTIVE') continue
    const ctr = ctrPct(c.clicks, c.impressions)
    if (c.impressions >= CAMPAIGN_LOW_CTR_MIN_IMPRESSIONS && ctr < CAMPAIGN_LOW_CTR_PCT) {
      actions.push({
        kind: 'pause_campaign', rule: 'campaign_low_ctr', campaignId: c.id,
        reason: `campaign ${c.id}: ${c.impressions} impressions, CTR ${pct(ctr)} (rule: ${CAMPAIGN_LOW_CTR_MIN_IMPRESSIONS}+ impressions and CTR under ${CAMPAIGN_LOW_CTR_PCT}%)`,
      })
      continue
    }
    if (c.maxHourlySpendCents != null && c.maxHourlySpendCents > CAMPAIGN_HOURLY_SPEND_CENTS) {
      actions.push({
        kind: 'pause_campaign', rule: 'campaign_hourly_spend', campaignId: c.id,
        reason: `campaign ${c.id}: $${(c.maxHourlySpendCents / 100).toFixed(2)} in one hour (rule: over $${(CAMPAIGN_HOURLY_SPEND_CENTS / 100).toFixed(2)} in any hour)`,
      })
      continue
    }
    // A single total is compared with the whole set's billed clicks; a per-campaign record, with that campaign's.
    const billed = typeof input.arrivals === 'number' ? totalBilled : c.clicks
    const arrived = arrivalsFor(c.id)
    if (arrived !== null && billed >= ARRIVALS_MIN_BILLED_CLICKS && arrived < billed * ARRIVALS_MIN_RATIO) {
      actions.push({
        kind: 'pause_campaign', rule: 'arrivals_shortfall', campaignId: c.id,
        reason: `campaign ${c.id}: ${billed} billed clicks, ${arrived} arrivals (rule: ${ARRIVALS_MIN_BILLED_CLICKS}+ billed clicks and under ${ARRIVALS_MIN_RATIO * 100}% arriving)`,
      })
    }
  }

  return actions
}
