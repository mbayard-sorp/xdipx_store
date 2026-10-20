/**
 * Ad Studio v2 settings (plan section 5). Every key has a code default, so
 * nothing is seeded and a missing pipeline_settings row reads as the default.
 * Writes (cap edit, rule recipes on the Spend tab) go through
 * setPipelineSettingAudited with actor 'owner' (see ad-spend.server.ts).
 *
 * All keys are <= varchar(50) (pipeline_settings.key constraint).
 * Rule defaults come from docs/audits/ad-platform-research-2026-10-03.md
 * section E.2 (est., derived: break-even CPA about $15, break-even ROAS about
 * 2.2x on a $33 AOV at 45% gross margin).
 */
import { getPipelineSetting } from '~/lib/feed-processor.server'

export {
  ADS_SETTING_KEYS, ADS_SPEND_ENABLED_DEFAULT, ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT,
  ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT, ADS_GROSS_MARGIN_PCT_DEFAULT, ADS_RULE_DEFAULTS, ADS_SIMULATION_EXIT_OK_DEFAULT, type AdsRuleKey,
  ADS_AUTO_APPLY_ENABLED_DEFAULT, ADS_AUTO_ACTIONS_MAX_PER_DAY_DEFAULT, ADS_BUDGET_MAX_STEP_PCT_DEFAULT,
  ADS_LEAD_CPL_CEILING_CENTS_DEFAULT, ADS_AUTOMATION_BOUNDS,
} from '~/lib/ad-settings-defaults'
import {
  ADS_SETTING_KEYS, ADS_SPEND_ENABLED_DEFAULT, ADS_MEDIA_MONTHLY_CAP_CENTS_DEFAULT,
  ADS_MEDIA_DAILY_CAP_CENTS_DEFAULT, ADS_GROSS_MARGIN_PCT_DEFAULT, ADS_RULE_DEFAULTS, ADS_SIMULATION_EXIT_OK_DEFAULT, type AdsRuleKey,
  ADS_AUTO_APPLY_ENABLED_DEFAULT, ADS_AUTO_ACTIONS_MAX_PER_DAY_DEFAULT, ADS_BUDGET_MAX_STEP_PCT_DEFAULT,
  ADS_LEAD_CPL_CEILING_CENTS_DEFAULT, ADS_AUTOMATION_BOUNDS,
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

/** The owner's go for leaving simulation. Default false; flipped from the owner valve surface, never in Ad Studio. */
export async function getAdsSimulationExitOk(): Promise<boolean> {
  return parseBool(await getPipelineSetting(ADS_SETTING_KEYS.simulationExitOk), ADS_SIMULATION_EXIT_OK_DEFAULT)
}

// ---------------------------------------------------------------------------
// Automation valves (ads control plane, plan sections 5 and 9.4)
// ---------------------------------------------------------------------------

/** A whole number inside its bounds, else the default. */
function parseBoundedInt(raw: string | null, fallback: number, bounds: { min: number; max: number }): number {
  const n = Math.trunc(parseNum(raw, fallback))
  return n >= bounds.min && n <= bounds.max ? n : fallback
}

export async function getAdsAutoApplyEnabled(): Promise<boolean> {
  return parseBool(await getPipelineSetting(ADS_SETTING_KEYS.autoApplyEnabled), ADS_AUTO_APPLY_ENABLED_DEFAULT)
}

export async function getAdsAutoActionsMaxPerDay(): Promise<number> {
  return parseBoundedInt(
    await getPipelineSetting(ADS_SETTING_KEYS.autoActionsMaxPerDay),
    ADS_AUTO_ACTIONS_MAX_PER_DAY_DEFAULT, ADS_AUTOMATION_BOUNDS.autoActionsMaxPerDay,
  )
}

export async function getAdsBudgetMaxStepPct(): Promise<number> {
  return parseBoundedInt(
    await getPipelineSetting(ADS_SETTING_KEYS.budgetMaxStepPct),
    ADS_BUDGET_MAX_STEP_PCT_DEFAULT, ADS_AUTOMATION_BOUNDS.budgetMaxStepPct,
  )
}

export async function getAdsLeadCplCeilingCents(): Promise<number> {
  return parseBoundedInt(
    await getPipelineSetting(ADS_SETTING_KEYS.leadCplCeilingCents),
    ADS_LEAD_CPL_CEILING_CENTS_DEFAULT, ADS_AUTOMATION_BOUNDS.leadCplCeilingCents,
  )
}

export interface AdsAutomationSettings {
  autoApplyEnabled: boolean
  /** True only when both ads_spend_enabled and ads_auto_apply_enabled are on. */
  autoApplyAllowed: boolean
  autoActionsMaxPerDay: number
  budgetMaxStepPct: number
  leadCplCeilingCents: number
}

/** The four automation valves in one read, plus whether auto-apply may run at all. */
export async function getAdsAutomationSettings(): Promise<AdsAutomationSettings> {
  const [spendEnabled, autoApplyEnabled, autoActionsMaxPerDay, budgetMaxStepPct, leadCplCeilingCents] = await Promise.all([
    getAdsSpendEnabled(), getAdsAutoApplyEnabled(), getAdsAutoActionsMaxPerDay(), getAdsBudgetMaxStepPct(), getAdsLeadCplCeilingCents(),
  ])
  return {
    autoApplyEnabled,
    autoApplyAllowed: spendEnabled && autoApplyEnabled,
    autoActionsMaxPerDay, budgetMaxStepPct, leadCplCeilingCents,
  }
}
