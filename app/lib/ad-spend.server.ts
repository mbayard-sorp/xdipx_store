/**
 * Ad Studio v2 Spend tab and simulation sheet, the database half (PR-H).
 *
 *   getSpendOverview()   caps, month to date, media today, compute today, the
 *                        planned-versus-actual rows, rule thresholds
 *   saveMediaCaps()      owner-only cap edit through setPipelineSettingAudited
 *   saveRuleValues()     owner-only rule recipe edit, same setter
 *   saveAutoApply()      owner-only automation switch, same setter
 *   saveAutomationLimits() owner-only automation numbers, same setter
 *   getSimulationExit()  the four exit-criteria lines, real numbers
 *
 * Media (ad platforms) and compute (image renders) are never summed into one
 * number: they answer to different caps.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  adCampaigns, adCreativeDailyMetrics, adCreativeFeedback, adCreatives, homepageTeamRuns,
} from '../../db/schema'
import {
  ADS_SETTING_KEYS, getAdsGrossMarginPct, getAdsMediaDailyCapCents, getAdsMediaMonthlyCapCents, getAdsRuleThresholds,
  getAdsSimulationExitOk, getAdsSpendEnabled, type AdsRuleKey,
  ADS_AUTOMATION_BOUNDS, getAdsAutomationSettings, type AdsAutomationSettings,
} from '~/lib/ad-settings.server'
import { setPipelineSettingAudited, type SettingsActor } from '~/lib/settings.server'
import { addDays, todayUtc } from '~/lib/ad-metrics.server'
import {
  recipeFields, validateRuleValue, type RuleId,
} from '~/lib/ad-rules-core'
import {
  MAX_MONTHLY_CAP_CENTS, buildPlanVsActual, monthProjection, parseDollarsToCents, routineStreak,
  type MonthProjection, type PlanRow, type SimulationExit,
} from '~/lib/ad-spend-core'

export * from '~/lib/ad-spend-core'

export class SpendInputError extends Error {}

const SOURCE = 'admin.ad-studio.spend'

export interface SpendOverview {
  today: string
  monthlyCapCents: number
  dailyCapCents: number
  spendEnabled: boolean
  month: MonthProjection
  mediaTodayCents: number
  /** null when the compute spend could not be read. */
  computeTodayCents: number | null
  computeCapCents: number
  plan7: PlanRow[]
  plan30: PlanRow[]
  thresholds: Record<AdsRuleKey, number>
  grossMarginPct: number
  automation: AdsAutomationSettings
}

export async function getSpendOverview(now: Date = new Date()): Promise<SpendOverview> {
  const today = todayUtc(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const [monthlyCapCents, dailyCapCents, spendEnabled, thresholds, grossMarginPct, automation] = await Promise.all([
    getAdsMediaMonthlyCapCents(), getAdsMediaDailyCapCents(), getAdsSpendEnabled(), getAdsRuleThresholds(), getAdsGrossMarginPct(),
    getAdsAutomationSettings(),
  ])

  const from30 = addDays(today, -29)
  const [metrics, creatives, campaigns] = await Promise.all([
    db.select({
      creativeId: adCreativeDailyMetrics.creativeId, day: adCreativeDailyMetrics.day, platform: adCreativeDailyMetrics.platform,
      spendCents: adCreativeDailyMetrics.spendCents, orders: adCreativeDailyMetrics.orders, netRevenueCents: adCreativeDailyMetrics.netRevenueCents,
    }).from(adCreativeDailyMetrics).where(gte(adCreativeDailyMetrics.day, from30 < monthStart ? from30 : monthStart)),
    db.select({
      id: adCreatives.id, campaignId: adCreatives.adCampaignId, lane: adCreatives.lane, registerTier: adCreatives.registerTier, ideaId: adCreatives.ideaId,
    }).from(adCreatives),
    db.select({ id: adCampaigns.id, name: adCampaigns.name, plannedDailyCents: adCampaigns.plannedDailyCents }).from(adCampaigns),
  ])

  const mtd = metrics.filter(m => m.day >= monthStart && m.day <= today).reduce((s, m) => s + m.spendCents, 0)
  const mediaToday = metrics.filter(m => m.day === today).reduce((s, m) => s + m.spendCents, 0)

  // Compute today: the same api_token_log query the ads team gate uses (feature LIKE 'ads-%').
  let computeTodayCents: number | null = null
  let computeCapCents = 500
  try {
    const { getTodaySpendCents, getTeamConfig } = await import('~/lib/team.server')
    const [spent, cfg] = await Promise.all([getTodaySpendCents('ads', { forceFresh: true }), getTeamConfig('ads')])
    computeTodayCents = spent
    computeCapCents = cfg.dailyCents
  } catch (err) {
    console.error('[ad-spend] compute spend read failed', err)
  }

  const base = { today, dailyCapCents, metrics, creatives, campaigns }
  return {
    today, monthlyCapCents, dailyCapCents, spendEnabled,
    month: monthProjection(today, mtd, monthlyCapCents),
    mediaTodayCents: mediaToday,
    computeTodayCents, computeCapCents,
    plan7: buildPlanVsActual({ ...base, windowDays: 7 }),
    plan30: buildPlanVsActual({ ...base, windowDays: 30 }),
    thresholds, grossMarginPct, automation,
  }
}

// ---------------------------------------------------------------------------
// Owner-only writes
// ---------------------------------------------------------------------------

export interface CapSave { monthlyCents: number; dailyCents: number; message: string }

/**
 * Save the monthly cap and the daily guard. Both are pipeline settings, written
 * through the audited setter (actor 'owner') so the change is attributable.
 */
export async function saveMediaCaps(input: { monthly: unknown; daily: unknown }, actor: SettingsActor = 'owner'): Promise<CapSave> {
  const monthlyCents = parseDollarsToCents(input.monthly)
  const dailyCents = parseDollarsToCents(input.daily)
  if (monthlyCents == null) throw new SpendInputError('Enter the monthly cap in dollars, like 600.')
  if (dailyCents == null) throw new SpendInputError('Enter the daily guard in dollars, like 20.')
  if (monthlyCents > MAX_MONTHLY_CAP_CENTS) throw new SpendInputError('That monthly cap is over $100,000. Check the number.')
  if (dailyCents > monthlyCents && monthlyCents > 0) throw new SpendInputError('The daily guard cannot be larger than the monthly cap.')
  const [, d] = await Promise.all([
    setPipelineSettingAudited(ADS_SETTING_KEYS.mediaMonthlyCapCents, String(monthlyCents), actor, SOURCE),
    setPipelineSettingAudited(ADS_SETTING_KEYS.mediaDailyCapCents, String(dailyCents), actor, SOURCE),
  ])
  const dollars = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
  const parts = [`Monthly cap set to ${dollars(monthlyCents)}.`]
  if (!d.unchanged) parts.push(`Daily guard set to ${dollars(dailyCents)}.`)
  return { monthlyCents, dailyCents, message: parts.join(' ') }
}

/** Save one rule's numbers. Only keys that belong to that rule are accepted, and each is range checked. */
export async function saveRuleValues(
  ruleId: RuleId,
  values: Record<string, unknown>,
  actor: SettingsActor = 'owner',
): Promise<{ saved: Array<{ key: AdsRuleKey; value: number }>; message: string }> {
  const fields = recipeFields(ruleId)
  if (fields.length === 0) throw new SpendInputError(`${ruleId} has no numbers to edit.`)
  const next: Array<{ key: AdsRuleKey; value: number }> = []
  for (const f of fields) {
    if (!(f.key in values)) continue
    const v = validateRuleValue(f.key, values[f.key])
    if (v == null) throw new SpendInputError(`${f.label} must be a number from ${f.min} to ${f.max}.`)
    next.push({ key: f.key, value: v })
  }
  if (next.length === 0) throw new SpendInputError('Nothing to save.')
  for (const n of next) await setPipelineSettingAudited(n.key, String(n.value), actor, SOURCE)
  return { saved: next, message: `${ruleId} saved.` }
}

export async function saveGrossMargin(raw: unknown, actor: SettingsActor = 'owner'): Promise<{ value: number; message: string }> {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n < 1 || n > 100) throw new SpendInputError('Gross margin must be a percent from 1 to 100.')
  await setPipelineSettingAudited(ADS_SETTING_KEYS.grossMarginPct, String(n), actor, SOURCE)
  return { value: n, message: `Gross margin set to ${n}%. Break-even moves with it.` }
}

/**
 * Turn auto-apply on or off. It only lets machines apply actions that lower
 * spend, and only while ads_spend_enabled is also on.
 */
export async function saveAutoApply(next: boolean, actor: SettingsActor = 'owner'): Promise<{ value: boolean; message: string }> {
  await setPipelineSettingAudited(ADS_SETTING_KEYS.autoApplyEnabled, next ? 'true' : 'false', actor, SOURCE)
  return {
    value: next,
    message: next
      ? 'Auto-apply is on. Rules can now pause and brake on their own, but only while spend is on.'
      : 'Auto-apply is off. Rules only write dry-run rows.',
  }
}

export interface AutomationLimitsSave { maxActionsPerDay: number; maxStepPct: number; leadCplCeilingCents: number; message: string }

function wholeNumberIn(raw: unknown, bounds: { min: number; max: number }): number | null {
  const t = String(raw ?? '').trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= bounds.min && n <= bounds.max ? n : null
}

/** Save the daily action cap, the budget step limit and the lead CPL ceiling together. */
export async function saveAutomationLimits(
  input: { maxActionsPerDay: unknown; maxStepPct: unknown; leadCplCeiling: unknown },
  actor: SettingsActor = 'owner',
): Promise<AutomationLimitsSave> {
  const b = ADS_AUTOMATION_BOUNDS
  const maxActionsPerDay = wholeNumberIn(input.maxActionsPerDay, b.autoActionsMaxPerDay)
  if (maxActionsPerDay == null) {
    throw new SpendInputError(`Actions per day must be a whole number from ${b.autoActionsMaxPerDay.min} to ${b.autoActionsMaxPerDay.max}.`)
  }
  const maxStepPct = wholeNumberIn(input.maxStepPct, b.budgetMaxStepPct)
  if (maxStepPct == null) {
    throw new SpendInputError(`Budget step must be a whole percent from ${b.budgetMaxStepPct.min} to ${b.budgetMaxStepPct.max}.`)
  }
  const leadCplCeilingCents = parseDollarsToCents(input.leadCplCeiling)
  if (leadCplCeilingCents == null || leadCplCeilingCents < b.leadCplCeilingCents.min || leadCplCeilingCents > b.leadCplCeilingCents.max) {
    throw new SpendInputError(`Lead price ceiling must be from $${b.leadCplCeilingCents.min / 100} to $${b.leadCplCeilingCents.max / 100}.`)
  }
  await setPipelineSettingAudited(ADS_SETTING_KEYS.autoActionsMaxPerDay, String(maxActionsPerDay), actor, SOURCE)
  await setPipelineSettingAudited(ADS_SETTING_KEYS.budgetMaxStepPct, String(maxStepPct), actor, SOURCE)
  await setPipelineSettingAudited(ADS_SETTING_KEYS.leadCplCeilingCents, String(leadCplCeilingCents), actor, SOURCE)
  return { maxActionsPerDay, maxStepPct, leadCplCeilingCents, message: 'Automation limits saved.' }
}

// ---------------------------------------------------------------------------
// Simulation exit criteria
// ---------------------------------------------------------------------------

/**
 * The four exit lines on the simulation sheet (plan section 2), from real data:
 * successful ads runs on consecutive days, creatives with an up verdict, lanes
 * among those, and the owner's go. Bridge page: the Sanity `adBridgePage.live`
 * read lives in PR-D and is not on this base, so it reads null (the sheet says
 * "unknown"). Each failed read is null, never a made-up zero.
 */
export async function getSimulationExit(now: Date = new Date()): Promise<SimulationExit> {
  const today = todayUtc(now)
  const since = new Date(now.getTime() - 60 * 86_400_000)
  const [streakDays, hearts, ownerSaysGo] = await Promise.all([
    db.selectDistinct({ day: sql<string>`(${homepageTeamRuns.startedAt} at time zone 'UTC')::date::text` })
      .from(homepageTeamRuns)
      .where(and(eq(homepageTeamRuns.team, 'ads'), eq(homepageTeamRuns.status, 'succeeded'), gte(homepageTeamRuns.startedAt, since)))
      .then(rows => routineStreak(rows.map(r => r.day), today))
      .catch((err): null => { console.error('[ad-spend] streak read failed', err); return null }),
    db.select({ lane: adCreatives.lane })
      .from(adCreativeFeedback)
      .innerJoin(adCreatives, eq(adCreatives.id, adCreativeFeedback.creativeId))
      .where(eq(adCreativeFeedback.verdict, 'up'))
      .catch((err): null => { console.error('[ad-spend] hearts read failed', err); return null }),
    getAdsSimulationExitOk().catch((): boolean => false),
  ])
  return {
    streakDays,
    heartedCreatives: hearts ? hearts.length : null,
    lanesWithHearts: hearts ? new Set(hearts.map(h => h.lane).filter((l): l is string => !!l)).size : null,
    bridgeLive: null,
    ownerSaysGo,
  }
}
