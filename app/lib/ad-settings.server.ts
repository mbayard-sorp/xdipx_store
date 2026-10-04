/**
 * Ad Studio v2 settings (plan section 5). READ ONLY in PR-A: every key has a
 * code default, so nothing is seeded and a missing pipeline_settings row reads
 * as the default. Writing these (cap edit, rule recipes) arrives in PR-H
 * through setPipelineSettingAudited.
 *
 * All keys are <= varchar(50) (pipeline_settings.key constraint).
 * Rule defaults come from docs/audits/ad-platform-research-2026-10-03.md
 * section E.2 (est., derived: break-even CPA about $15, break-even ROAS about
 * 2.2x on a $33 AOV at 45% gross margin).
 */
import { getPipelineSetting } from '~/lib/feed-processor.server'

export const ADS_SETTING_KEYS = {
  spendEnabled: 'ads_spend_enabled',
  mediaMonthlyCapCents: 'ads_media_monthly_cap_cents',
  mediaDailyCapCents: 'ads_media_daily_cap_cents',
} as const

/** Spend valve. OFF until the owner flips it from the valve surface (Phase 5 runbook). */
export const ADS_SPEND_ENABLED_DEFAULT = false
/** Monthly media cap, in cents ($600). */
export const ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT = 60000
/** Daily guard that rule R7 reads and the burn bar shows, in cents ($20). */
export const ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT = 2000

/**
 * Rule thresholds R1 to R8. The first key of each rule is the headline number;
 * the rest are its companions. Units live in the key name.
 */
export const ADS_RULE_DEFAULTS = {
  // R1 hard kill: spend at least N x break-even CPA with zero attributed purchases, min hours live
  ads_rule_r1_be_multiple: 2,
  ads_rule_r1_min_hours: 48,
  // R2 broken creative: impressions at least N and link CTR below P percent
  ads_rule_r2_min_ctr_pct: 0.5,
  ads_rule_r2_min_impressions: 2000,
  // R3 unprofitable: spend at least N x BE and ROAS below F x break-even ROAS, 7d
  ads_rule_r3_be_multiple: 3,
  ads_rule_r3_roas_factor: 0.8,
  // R4 revive: late-attributed ROAS back at or above break-even within N days, once
  ads_rule_r4_revive_days: 7,
  // R5 scale: ROAS at least F x break-even and at least N purchases, +P percent, once per H hours
  ads_rule_r5_roas_factor: 1.3,
  ads_rule_r5_min_purchases: 3,
  ads_rule_r5_budget_up_pct: 20,
  ads_rule_r5_cooldown_hours: 72,
  // R6 brake: ROAS below break-even in both 3d and 7d windows, budget down P percent
  ads_rule_r6_budget_down_pct: 30,
  // R7 spend guard: CPM above N x its 7-day median (the daily cap is ads_media_daily_cap_cents)
  ads_rule_r7_cpm_multiple: 2,
  // R8 fatigue: frequency above N and CTR down at least P percent versus the first 3 days
  ads_rule_r8_max_frequency: 3,
  ads_rule_r8_ctr_drop_pct: 30,
} as const

export type AdsRuleKey = keyof typeof ADS_RULE_DEFAULTS

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'off') return false
  return fallback
}

function parseNum(raw: string | null, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export async function getAdsSpendEnabled(): Promise<boolean> {
  return parseBool(await getPipelineSetting(ADS_SETTING_KEYS.spendEnabled), ADS_SPEND_ENABLED_DEFAULT)
}

export async function getAdsMediaMonthlyCapCents(): Promise<number> {
  return Math.trunc(parseNum(await getPipelineSetting(ADS_SETTING_KEYS.mediaMonthlyCapCents), ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT))
}

/** Daily cap: its own key when set, else the monthly cap spread over 30 days, else the default. */
export async function getAdsMediaDailyCapCents(): Promise<number> {
  const own = await getPipelineSetting(ADS_SETTING_KEYS.mediaDailyCapCents)
  if (own != null && own.trim() !== '') return Math.trunc(parseNum(own, ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT))
  const monthlyRaw = await getPipelineSetting(ADS_SETTING_KEYS.mediaMonthlyCapCents)
  if (monthlyRaw != null && monthlyRaw.trim() !== '') {
    return Math.max(0, Math.round(parseNum(monthlyRaw, ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT) / 30))
  }
  return ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT
}

export async function getAdsRuleThreshold(key: AdsRuleKey): Promise<number> {
  return parseNum(await getPipelineSetting(key), ADS_RULE_DEFAULTS[key])
}

/** All eight rules' thresholds in one read. */
export async function getAdsRuleThresholds(): Promise<Record<AdsRuleKey, number>> {
  const keys = Object.keys(ADS_RULE_DEFAULTS) as AdsRuleKey[]
  const values = await Promise.all(keys.map(k => getAdsRuleThreshold(k)))
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<AdsRuleKey, number>
}
