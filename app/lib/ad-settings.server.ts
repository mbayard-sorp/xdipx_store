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

export {
  ADS_SETTING_KEYS, ADS_SPEND_ENABLED_DEFAULT, ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT,
  ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT, ADS_GROSS_MARGIN_PCT_DEFAULT, ADS_RULE_DEFAULTS, type AdsRuleKey,
} from '~/lib/ad-settings-defaults'
import {
  ADS_SETTING_KEYS, ADS_SPEND_ENABLED_DEFAULT, ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT,
  ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT, ADS_GROSS_MARGIN_PCT_DEFAULT, ADS_RULE_DEFAULTS, type AdsRuleKey,
} from '~/lib/ad-settings-defaults'

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

/** Gross margin percent for break-even math. Valid range 1 to 100, else the default. */
export async function getAdsGrossMarginPct(): Promise<number> {
  const v = parseNum(await getPipelineSetting(ADS_SETTING_KEYS.grossMarginPct), ADS_GROSS_MARGIN_PCT_DEFAULT)
  return v >= 1 && v <= 100 ? v : ADS_GROSS_MARGIN_PCT_DEFAULT
}
