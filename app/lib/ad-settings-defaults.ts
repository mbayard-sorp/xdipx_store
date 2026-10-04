/**
 * Ad Studio v2 setting keys and code defaults (plan section 5). Client-safe: no
 * server imports, so Live tab components and the pure metrics core can read the
 * defaults. The readers live in ad-settings.server.ts, which re-exports this.
 */
export const ADS_SETTING_KEYS = {
  spendEnabled: 'ads_spend_enabled',
  mediaMonthlyCapCents: 'ads_media_monthly_cap_cents',
  mediaDailyCapCents: 'ads_media_daily_cap_cents',
  grossMarginPct: 'ads_gross_margin_pct',
  /** Owner's go for leaving simulation (plan section 2 exit criteria). Read-only chip in the sheet. */
  simulationExitOk: 'ads_simulation_exit_ok',
} as const

export const ADS_SIMULATION_EXIT_OK_DEFAULT = false

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
  // R6 brake: ROAS below break-even in both 3d and 7d windows, budget down P percent.
  // The next two are additions the research table does not carry: a brake needs at least
  // N x break-even CPA of 7d spend behind it (below that the window is noise), and fires at
  // most once per H hours so a quiet week cannot brake the same ad three times.
  ads_rule_r6_budget_down_pct: 30,
  ads_rule_r6_min_spend_be_multiple: 2,
  ads_rule_r6_cooldown_hours: 72,
  // R7 spend guard: CPM above N x its 7-day median (the daily cap is ads_media_daily_cap_cents)
  ads_rule_r7_cpm_multiple: 2,
  // R8 fatigue: frequency above N and CTR down at least P percent versus the first 3 days
  ads_rule_r8_max_frequency: 3,
  ads_rule_r8_ctr_drop_pct: 30,
} as const

export type AdsRuleKey = keyof typeof ADS_RULE_DEFAULTS

/** Gross margin used for break-even CPA and ROAS, in percent (research E.2: about 45). */
export const ADS_GROSS_MARGIN_PCT_DEFAULT = 45
