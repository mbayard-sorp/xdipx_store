/**
 * Objective-aware rules, the pure half for lead campaigns (ticket #16428, ads
 * control plane phase 4b, plan section 9.3). No database and no server-only
 * imports. ad-rules-core.ts calls in here for every creative whose campaign
 * objective resolves to leads; the database half (mirror, insights, Klaviyo)
 * is ad-rules.server.ts.
 *
 * Why a second rule set: R1, R3, R5 and R6 judge a creative on orders or 7-day
 * ROAS, and a lead campaign's orders land 7 to 30 days after the lead. On a
 * lead ad those rules kill healthy list building on day one. A lead campaign
 * gets L1 to L8 plus R2 (on outbound CTR when known) and R7. Sales campaigns
 * and anything the mirror cannot place keep R1 to R8 exactly as before.
 *
 * The CPL ceiling is the owner's list-building price (ads_lead_cpl_ceiling_cents,
 * $8 by default), never break-even CPL: break-even at this AOV is under $1 a
 * lead, and a rule pegged to it pauses everything (plan section 9.1).
 *
 * Every rule here RECOMMENDS, the same as R1 to R6: a firing becomes an
 * ad_rule_events row with applied_by null and the owner taps it. Cooldowns use
 * the same mechanism as R5 and R6, applied (and not undone) rows inside the
 * window. "One-shot" means the rule never fires again for that creative once a
 * row of it was applied, undone or not, which is R4's rule.
 *
 * Inputs the store cannot read yet stay quiet, never guessed:
 *   - L3 reads hourly health samples (ad_health_samples, phase 2d). Until that
 *     table exists the loader passes an empty list and L3 never fires.
 *   - L6 needs email-1 click or reveal-to-cart rate per utm_content. The lead
 *     funnel report does not expose either, so the loader passes null and L6
 *     never fires.
 *   - L4 needs landing page views. Meta reports them as the landing_page_view
 *     action; without an insights row for the ad L4 stays quiet.
 */
import {
  cappedScalePct,
  type CreativeRuleInput, type RuleAction, type RuleEventHistory, type RuleFired, type RuleInputs, type RulesSettings,
} from '~/lib/ad-rules-core'
import {
  ctrPct, formatMoney, resolveCreativeId, sumWindow,
  type CreativeIndex,
} from '~/lib/ad-metrics-core'
import type { FunnelLead, FunnelOrder } from '~/lib/lead-funnel-report'

export type LeadRuleId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'
export const LEAD_RULE_IDS: readonly LeadRuleId[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']

/** The fixed numbers of plan section 9.3. The CPL ceiling is the one owner-set input. */
export const LEAD_RULE_DEFAULTS = {
  l1SpendCeilingMultiple: 3,
  l1MinImpressions: 1000,
  l1MinHours: 48,
  l2CplCeilingMultiple: 1.5,
  l2MinLeads: 5,
  l2MinSpendCeilingMultiple: 5,
  l2BrakePct: 30,
  l2CooldownHours: 72,
  l3MinLandingViews: 30,
  l3WindowHours: 6,
  l3HelloFailures: 2,
  l4MinClicks: 50,
  l4MinLandingRate: 0.6,
  l4CooldownHours: 7 * 24,
  l5CplCeilingMultiple: 0.7,
  l5MinLeads: 10,
  l5MinAccountLeadToOrder: 0.03,
  l5UpPct: 20,
  l5CooldownHours: 72,
  l6MinLeads: 20,
  l6MinAgeDays: 7,
  l6MedianFactor: 0.5,
  l6CooldownHours: 14 * 24,
  l7MinLeads: 40,
  l7MinAgeDays: 30,
  l7CplContributionMultiple: 3,
  l8MinLeads: 10,
  l8MinDays: 7,
  l8CtrDropPct: 30,
  l8CplRisePct: 50,
  l8CooldownHours: 7 * 24,
} as const

// ---------------------------------------------------------------------------
// Objective lookup through the mirror
// ---------------------------------------------------------------------------

/** Which rule set a creative gets. `other` and `unknown` keep R1 to R8. */
export type CampaignObjective = 'leads' | 'sales' | 'other' | 'unknown'

const LEAD_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION'])
const SALES_OBJECTIVES = new Set(['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'])

export function classifyObjective(raw: string | null | undefined): CampaignObjective {
  const v = (raw ?? '').trim().toUpperCase()
  if (!v) return 'unknown'
  if (LEAD_OBJECTIVES.has(v)) return 'leads'
  if (SALES_OBJECTIVES.has(v)) return 'sales'
  return 'other'
}

/** The slice of an ad_platform_entities row the lookup needs. */
export interface MirrorEntity {
  platform: string
  level: string
  externalId: string
  parentExternalId: string | null
  objective: string | null
  creativeId: number | null
}

export interface ObjectiveResolution {
  objective: CampaignObjective
  /** The objective string as the platform reported it, null when not found. */
  rawObjective: string | null
  adExternalId: string | null
  adsetExternalId: string | null
  campaignExternalId: string | null
  /** Why the answer is what it is, for the run summary. */
  note: string
}

/**
 * Resolve each creative's campaign objective: ad (by external_ad_id, else by the
 * mirror's creative_id link) to its parent ad set to its parent campaign, where
 * the objective lives. Anything missing on the way is `unknown`.
 */
export function resolveObjectives(
  creatives: ReadonlyArray<{ creativeId: number; externalAdId: string | null }>,
  mirror: readonly MirrorEntity[],
): Map<number, ObjectiveResolution> {
  const key = (platform: string, id: string) => `${platform}\u0000${id}`
  const byExternal = new Map<string, MirrorEntity>()
  const adsByExternalId = new Map<string, MirrorEntity>()
  const adsByCreative = new Map<number, MirrorEntity>()
  for (const e of mirror) {
    byExternal.set(key(e.platform, e.externalId), e)
    if (e.level !== 'ad') continue
    if (!adsByExternalId.has(e.externalId)) adsByExternalId.set(e.externalId, e)
    if (e.creativeId != null && !adsByCreative.has(e.creativeId)) adsByCreative.set(e.creativeId, e)
  }
  const out = new Map<number, ObjectiveResolution>()
  for (const c of creatives) {
    const none = (note: string, ad: MirrorEntity | null = null, adset: MirrorEntity | null = null): ObjectiveResolution => ({
      objective: 'unknown', rawObjective: null, adExternalId: ad?.externalId ?? c.externalAdId ?? null,
      adsetExternalId: adset?.externalId ?? ad?.parentExternalId ?? null, campaignExternalId: adset?.parentExternalId ?? null, note,
    })
    const ad = (c.externalAdId ? adsByExternalId.get(c.externalAdId) : undefined) ?? adsByCreative.get(c.creativeId) ?? null
    if (!ad) { out.set(c.creativeId, none(c.externalAdId ? 'ad not in the mirror' : 'no external_ad_id')); continue }
    const adset = ad.parentExternalId ? byExternal.get(key(ad.platform, ad.parentExternalId)) ?? null : null
    if (!adset) { out.set(c.creativeId, none('ad set not in the mirror', ad)); continue }
    const campaign = adset.parentExternalId ? byExternal.get(key(adset.platform, adset.parentExternalId)) ?? null : null
    if (!campaign) { out.set(c.creativeId, none('campaign not in the mirror', ad, adset)); continue }
    const objective = classifyObjective(campaign.objective)
    out.set(c.creativeId, {
      objective, rawObjective: campaign.objective ?? null,
      adExternalId: ad.externalId, adsetExternalId: adset.externalId, campaignExternalId: campaign.externalId,
      note: objective === 'unknown' ? 'campaign has no objective' : `campaign objective ${campaign.objective}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Lead inputs
// ---------------------------------------------------------------------------

/** One creative's lead-side numbers for one day. Null means "not read", never zero. */
export interface LeadDay {
  day: string
  /** ad_creative_daily_metrics.leads (platform-reported, migration 129). */
  leads: number | null
  /** Insights link clicks (Meta inline_link_clicks), the outbound-click proxy. */
  linkClicks: number | null
  /** Insights landing_page_view action count. */
  landingViews: number | null
}

/** One Klaviyo lead attributed to the creative by utm_content. */
export interface CohortLead {
  capturedAt: string
  converted: boolean
  revenueCents: number
}

/** L6 inputs. The lead funnel report does not expose these yet, so the loader passes null. */
export interface LeadQualityInput {
  /** This creative's email-1 click rate or reveal-to-cart rate, 0 to 1. */
  rate: number
  /** The account median of the same rate. */
  accountMedian: number
  metric: 'email1_click' | 'reveal_to_cart'
}

export interface LeadCreativeSignals {
  days: LeadDay[]
  /** Klaviyo leads for this creative inside the read window. Null when Klaviyo was not read. */
  cohort: CohortLead[] | null
  quality: LeadQualityInput | null
}

/** An hourly health counter (phase 2d, ad_health_samples). */
export interface HealthSample {
  sampledAt: string
  /** landing_views | lead_posts_ok | hello_status */
  key: string
  value: number
}

export interface LeadAccountInputs {
  /** Account lead-to-order over leads captured in the last 14 days, 0 to 1. Null when Klaviyo was not read. */
  leadToOrder14d: number | null
  leads14d: number | null
  /** Empty until phase 2d builds ad_health_samples. */
  healthSamples: HealthSample[]
}

// ---------------------------------------------------------------------------
// Cohorts from the Klaviyo read
// ---------------------------------------------------------------------------

/**
 * Attribute Klaviyo leads to creatives by utm_content (the Meta {{ad.id}} macro,
 * a destination utm_content or the creative id), and mark each converted when the
 * same profile placed an order after capture, as the lead funnel report counts it.
 */
export function buildLeadCohorts(
  leads: readonly FunnelLead[],
  orders: readonly FunnelOrder[],
  index: CreativeIndex,
): Map<number, CohortLead[]> {
  const ordersByProfile = new Map<string, FunnelOrder[]>()
  for (const o of orders) {
    const list = ordersByProfile.get(o.profileId) ?? []
    list.push(o)
    ordersByProfile.set(o.profileId, list)
  }
  const out = new Map<number, CohortLead[]>()
  for (const l of leads) {
    const id = resolveCreativeId(index, [l.utmContent])
    if (id == null) continue
    const cap = Date.parse(l.capturedAt)
    if (!Number.isFinite(cap)) continue
    let revenue = 0
    let converted = false
    for (const o of ordersByProfile.get(l.profileId) ?? []) {
      const at = Date.parse(o.at)
      if (Number.isFinite(at) && at > cap) { converted = true; revenue += Number.isFinite(o.value) ? o.value : 0 }
    }
    const list = out.get(id) ?? []
    list.push({ capturedAt: l.capturedAt, converted, revenueCents: Math.round(revenue * 100) })
    out.set(id, list)
  }
  return out
}

/** Account lead-to-order over leads captured in the trailing `days`. */
export function accountLeadToOrder(
  leads: readonly FunnelLead[],
  orders: readonly FunnelOrder[],
  now: Date,
  days = 14,
): { rate: number | null; leads: number; converted: number } {
  const since = now.getTime() - days * DAY_MS
  const buyers = new Map<string, number[]>()
  for (const o of orders) {
    const at = Date.parse(o.at)
    if (!Number.isFinite(at)) continue
    const list = buyers.get(o.profileId) ?? []
    list.push(at)
    buyers.set(o.profileId, list)
  }
  let n = 0
  let converted = 0
  for (const l of leads) {
    const cap = Date.parse(l.capturedAt)
    if (!Number.isFinite(cap) || cap < since || cap > now.getTime()) continue
    n += 1
    if ((buyers.get(l.profileId) ?? []).some(at => at > cap)) converted += 1
  }
  return { rate: n > 0 ? converted / n : null, leads: n, converted }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR = 3_600_000
const DAY_MS = 86_400_000

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }

function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function applied(events: RuleEventHistory[], pred: (e: RuleEventHistory) => boolean): RuleEventHistory[] {
  return events.filter(e => e.appliedAt != null && !e.undone && pred(e))
}

function appliedWithin(events: RuleEventHistory[], now: Date, hours: number, pred: (e: RuleEventHistory) => boolean): boolean {
  return applied(events, pred).some(e => now.getTime() - new Date(e.appliedAt!).getTime() < hours * HOUR)
}

/** One-shot: a row of this rule was applied once, undone or not. */
function everApplied(events: RuleEventHistory[], ruleId: LeadRuleId): boolean {
  return events.some(e => e.ruleId === ruleId && e.appliedAt != null)
}

function pct(n: number): string { return `${Math.round(n * 100)}%` }

function fire(c: CreativeRuleInput, ruleId: LeadRuleId, action: RuleAction, sentence: string, inputs: RuleInputs, held = false): RuleFired {
  return { ruleId, creativeKey: c.key, creativeId: c.creativeId, action, sentence, inputs: { ruleSet: 'leads', ...inputs }, ...(held ? { held: true } : {}) }
}

export function leadCeilingCents(s: RulesSettings): number {
  const v = s.leadCplCeilingCents
  return typeof v === 'number' && v > 0 ? v : 800
}

interface LeadCount {
  /** The larger of the platform count and the Klaviyo count: both are counts of the same leads. */
  leads: number
  platformLeads: number | null
  klaviyoLeads: number | null
  /** False when neither source was read for this window. */
  known: boolean
}

function countLeads(c: CreativeRuleInput, from: string, to: string): LeadCount {
  const sig = c.lead
  let platform: number | null = null
  for (const d of sig?.days ?? []) {
    if (d.day < from || d.day > to || d.leads == null) continue
    platform = (platform ?? 0) + d.leads
  }
  let klaviyo: number | null = null
  if (sig?.cohort) {
    klaviyo = 0
    for (const l of sig.cohort) {
      const day = l.capturedAt.slice(0, 10)
      if (day >= from && day <= to) klaviyo += 1
    }
  }
  const known = platform != null || klaviyo != null
  return { leads: Math.max(platform ?? 0, klaviyo ?? 0), platformLeads: platform, klaviyoLeads: klaviyo, known }
}

function sumLeadDays(c: CreativeRuleInput, from: string, to: string, field: 'linkClicks' | 'landingViews'): number | null {
  let v: number | null = null
  for (const d of c.lead?.days ?? []) {
    if (d.day < from || d.day > to || d[field] == null) continue
    v = (v ?? 0) + d[field]!
  }
  return v
}

function hoursLiveOf(c: CreativeRuleInput, now: Date): number {
  const firstDay = c.days.filter(d => d.spendCents > 0 || d.impressions > 0).map(d => d.day).sort()[0] ?? null
  const startMs = c.launchedAt ? new Date(c.launchedAt).getTime() : firstDay ? new Date(`${firstDay}T00:00:00Z`).getTime() : null
  return startMs == null ? 0 : Math.max(0, (now.getTime() - startMs) / HOUR)
}

// ---------------------------------------------------------------------------
// Per-creative evaluation
// ---------------------------------------------------------------------------

/** An L2 breach, decided per ad set by the caller: pause the ad, or brake the set when every ad in it breaches. */
export interface L2Candidate {
  creative: CreativeRuleInput
  cplCents: number | null
  leads7: number
  spend7Cents: number
}

export interface LeadCreativeResult {
  firings: RuleFired[]
  l2: L2Candidate | null
}

/**
 * Evaluate one lead-campaign creative against L1, L2 (candidacy only), L4 to L8
 * and R2 on outbound CTR. L3 is account level and R7 stays in the core.
 */
export function evaluateLeadCreative(c: CreativeRuleInput, s: RulesSettings, now: Date, acct: LeadAccountInputs | null = null): LeadCreativeResult {
  const L = LEAD_RULE_DEFAULTS
  const ceiling = leadCeilingCents(s)
  const today = ymd(now)
  const from7 = minusDays(today, 6)
  const out: RuleFired[] = []

  const lifeSpend = c.days.reduce((a, d) => a + (d.day <= today ? d.spendCents : 0), 0)
  const lifeImpr = c.days.reduce((a, d) => a + (d.day <= today ? d.impressions : 0), 0)
  const w7 = sumWindow(c.days, today, 7)
  const life = countLeads(c, '0000-01-01', today)
  const l7 = countLeads(c, from7, today)
  const hoursLive = hoursLiveOf(c, now)
  const lifeDays = Math.max(1, Math.round(hoursLive / 24))

  // ---- L7 cohort verdict (needs the Klaviyo cohort) --------------------------
  const cohortCut = now.getTime() - L.l7MinAgeDays * DAY_MS
  const cohort = (c.lead?.cohort ?? []).filter(l => Date.parse(l.capturedAt) <= cohortCut)
  let l7Verdict: null | { kind: 'pause' | 'revive'; inputs: RuleInputs; cplCents: number; contribCents: number } = null
  if (c.lead?.cohort && cohort.length >= L.l7MinLeads && !everApplied(c.events, 'L7')) {
    const cutDay = ymd(new Date(cohortCut))
    const spendBefore = c.days.reduce((a, d) => a + (d.day <= cutDay ? d.spendCents : 0), 0)
    const revenue = cohort.reduce((a, l) => a + l.revenueCents, 0)
    const cplCents = Math.round(spendBefore / cohort.length)
    const contribCents = Math.round((revenue * (s.breakEven.marginPct / 100)) / cohort.length)
    const inputs: RuleInputs = {
      cohortLeads: cohort.length, cohortConverted: cohort.filter(l => l.converted).length, cohortSpendCents: spendBefore,
      cohortRevenueCents: revenue, cplCents, contributionPerLeadCents: contribCents, marginPct: s.breakEven.marginPct,
      minAgeDays: L.l7MinAgeDays, multiple: L.l7CplContributionMultiple,
    }
    if (cplCents > L.l7CplContributionMultiple * contribCents) l7Verdict = { kind: 'pause', inputs, cplCents, contribCents }
    else if (contribCents >= cplCents) l7Verdict = { kind: 'revive', inputs, cplCents, contribCents }
  }

  if (c.paused) {
    if (l7Verdict?.kind === 'revive') {
      out.push(fire(c, 'L7', 'revive',
        `Revive: the ${cohort.length}-lead cohort from ${L.l7MinAgeDays}d ago earns ${formatMoney(l7Verdict.contribCents)} a lead against a ${formatMoney(l7Verdict.cplCents)} CPL, L7. It can revive this once.`,
        l7Verdict.inputs))
    }
    return { firings: out, l2: null }
  }

  // ---- Pause family -----------------------------------------------------------
  // L1 zero-lead kill. One-shot: once applied it never fires again; L7 is the way back.
  if (
    life.known && life.leads === 0 && lifeSpend >= L.l1SpendCeilingMultiple * ceiling
    && lifeImpr >= L.l1MinImpressions && hoursLive >= L.l1MinHours && !everApplied(c.events, 'L1')
  ) {
    out.push(fire(c, 'L1', 'pause',
      `Pause: ${formatMoney(lifeSpend)} spent in ${lifeDays}d with 0 leads, past ${L.l1SpendCeilingMultiple}x the ${formatMoney(ceiling)} CPL ceiling, L1`,
      {
        spendCents: lifeSpend, leads: 0, platformLeads: life.platformLeads, klaviyoLeads: life.klaviyoLeads,
        ceilingCents: ceiling, multiple: L.l1SpendCeilingMultiple, impressions: lifeImpr, hoursLive: Math.round(hoursLive),
      }))
  }

  // R2 broken creative, on outbound CTR when the insights carry link clicks.
  const th = s.thresholds
  let ctrClicks = 0
  let ctrImpr = 0
  let outbound = false
  for (const d of c.days) {
    if (d.day > today) continue
    const ld = c.lead?.days.find(x => x.day === d.day)
    if (ld?.linkClicks != null) { outbound = true; ctrClicks += ld.linkClicks; ctrImpr += d.impressions }
  }
  if (!outbound) { ctrClicks = c.days.reduce((a, d) => a + d.clicks, 0); ctrImpr = lifeImpr }
  const lifeCtr = ctrPct(ctrClicks, ctrImpr)
  if (ctrImpr >= th.ads_rule_r2_min_impressions && lifeCtr != null && lifeCtr < th.ads_rule_r2_min_ctr_pct) {
    out.push({
      ruleId: 'R2', creativeKey: c.key, creativeId: c.creativeId, action: 'pause',
      sentence: `Pause: ${ctrImpr.toLocaleString('en-US')} impressions in ${lifeDays}d at ${lifeCtr.toFixed(2)}% ${outbound ? 'outbound ' : ''}CTR, R2`,
      inputs: {
        ruleSet: 'leads', impressions: ctrImpr, ctrPct: Number(lifeCtr.toFixed(3)), minCtrPct: th.ads_rule_r2_min_ctr_pct,
        ctrBasis: outbound ? 'outbound' : 'clicks', days: lifeDays,
      },
    })
  }

  // L7 pause on a cohort that cost over 3x what it earns.
  if (l7Verdict?.kind === 'pause') {
    out.push(fire(c, 'L7', 'pause',
      `Pause: the ${cohort.length}-lead cohort from ${L.l7MinAgeDays}d ago cost ${formatMoney(l7Verdict.cplCents)} a lead and earns ${formatMoney(l7Verdict.contribCents)} a lead, over ${L.l7CplContributionMultiple}x, L7`,
      l7Verdict.inputs))
  }
  if (out.length > 0) return { firings: out, l2: null }

  // L2 CPL ceiling: a candidate here, pause or brake decided per ad set by the caller.
  const cpl7 = l7.leads > 0 ? Math.round(w7.spendCents / l7.leads) : null
  const l2Floor = l7.leads >= L.l2MinLeads || w7.spendCents >= L.l2MinSpendCeilingMultiple * ceiling
  const l2Breach = l7.known && w7.spendCents > 0 && (cpl7 == null || cpl7 > L.l2CplCeilingMultiple * ceiling)
  if (l2Floor && l2Breach) {
    return { firings: out, l2: { creative: c, cplCents: cpl7, leads7: l7.leads, spend7Cents: w7.spendCents } }
  }

  // ---- L5 scale -----------------------------------------------------------------
  if (
    cpl7 != null && cpl7 <= L.l5CplCeilingMultiple * ceiling && l7.leads >= L.l5MinLeads
    && acct?.leadToOrder14d != null && acct.leadToOrder14d >= L.l5MinAccountLeadToOrder
    && !appliedWithin(c.events, now, L.l5CooldownHours, e => e.action === 'scale')
  ) {
    const avgDaily = w7.spendCents / 7
    const cap = cappedScalePct(avgDaily, s.dailyCapCents, L.l5UpPct)
    const base = {
      cplCents: cpl7, leads: l7.leads, ceilingCents: ceiling, leadToOrder14d: Number(acct.leadToOrder14d.toFixed(4)),
      leads14d: acct.leads14d, avgDailyCents: Math.round(avgDaily), dailyCapCents: s.dailyCapCents,
    }
    const why = `7d CPL ${formatMoney(cpl7)} on ${l7.leads} leads is under ${L.l5CplCeilingMultiple}x the ${formatMoney(ceiling)} ceiling, and ${pct(acct.leadToOrder14d)} of the account's 14d leads ordered`
    if (cap.held) {
      out.push(fire(c, 'L5', 'none', `Scale held: ${why}, but this ad already spends the ${formatMoney(s.dailyCapCents)} daily cap, L5`, { ...base, upPct: 0, held: true }, true))
    } else {
      const capped = cap.pct < L.l5UpPct
      out.push(fire(c, 'L5', 'scale',
        `Scale +${cap.pct}%: ${why}, L5${capped ? ` (the most the ${formatMoney(s.dailyCapCents)} daily cap allows)` : ''}`,
        { ...base, upPct: cap.pct, capped }))
    }
  }

  // ---- L4 click leak ------------------------------------------------------------
  const clicks7 = sumLeadDays(c, from7, today, 'linkClicks')
  const views7 = sumLeadDays(c, from7, today, 'landingViews')
  if (
    clicks7 != null && views7 != null && clicks7 >= L.l4MinClicks && views7 / clicks7 < L.l4MinLandingRate
    && !appliedWithin(c.events, now, L.l4CooldownHours, e => e.ruleId === 'L4')
  ) {
    out.push(fire(c, 'L4', 'flag',
      `Check landing speed: ${views7} landing views from ${clicks7} outbound clicks over 7d is ${pct(views7 / clicks7)}, under ${pct(L.l4MinLandingRate)}, L4`,
      { outboundClicks: clicks7, landingViews: views7, landingRate: Number((views7 / clicks7).toFixed(3)), minRate: L.l4MinLandingRate }))
  }

  // ---- L6 lead quality ----------------------------------------------------------
  const l6 = evaluateLeadQuality(c, now)
  if (l6) out.push(l6)

  // ---- L8 lead fatigue ----------------------------------------------------------
  const l8 = evaluateLeadFatigue(c, now, life.leads, hoursLive, cpl7)
  if (l8) out.push(l8)

  return { firings: out, l2: null }
}

/**
 * L6. Fires only when the quality input exists: email-1 click or reveal-to-cart
 * under half the account median on a cohort of at least 20 leads, 7 days old.
 */
export function evaluateLeadQuality(c: CreativeRuleInput, now: Date): RuleFired | null {
  const L = LEAD_RULE_DEFAULTS
  const q = c.lead?.quality
  if (!q || !c.lead?.cohort) return null
  const cut = now.getTime() - L.l6MinAgeDays * DAY_MS
  const cohort = c.lead.cohort.filter(l => Date.parse(l.capturedAt) <= cut)
  if (cohort.length < L.l6MinLeads || !(q.accountMedian > 0)) return null
  if (q.rate >= L.l6MedianFactor * q.accountMedian) return null
  if (appliedWithin(c.events, now, L.l6CooldownHours, e => e.ruleId === 'L6')) return null
  const label = q.metric === 'email1_click' ? 'email-1 click' : 'reveal-to-cart'
  return fire(c, 'L6', 'refresh',
    `Deprioritize and refresh the brief: ${label} rate ${pct(q.rate)} on a ${cohort.length}-lead cohort is under half the ${pct(q.accountMedian)} account median, L6`,
    { metric: q.metric, rate: Number(q.rate.toFixed(4)), accountMedian: Number(q.accountMedian.toFixed(4)), cohortLeads: cohort.length, factor: L.l6MedianFactor })
}

/** L8: CTR down 30% from the first 3 days, or CPL up 50% from the first 10 leads. */
function evaluateLeadFatigue(c: CreativeRuleInput, now: Date, lifeLeads: number, hoursLive: number, cpl7: number | null): RuleFired | null {
  const L = LEAD_RULE_DEFAULTS
  if (lifeLeads < L.l8MinLeads || hoursLive < L.l8MinDays * 24) return null
  if (appliedWithin(c.events, now, L.l8CooldownHours, e => e.action === 'refresh')) return null
  const today = ymd(now)
  const sorted = c.days.filter(d => d.impressions > 0 && d.day <= today).sort((a, b) => a.day.localeCompare(b.day))
  const first3 = sorted.slice(0, 3).reduce((a, d) => ({ i: a.i + d.impressions, k: a.k + d.clicks }), { i: 0, k: 0 })
  const w7 = sumWindow(c.days, today, 7)
  const ctrFirst = ctrPct(first3.k, first3.i)
  const ctrNow = ctrPct(w7.clicks, w7.impressions)
  const ctrDrop = ctrFirst && ctrNow != null ? (ctrFirst - ctrNow) / ctrFirst : null

  // CPL of the first 10 leads: spend through the day the running lead count reached 10.
  let firstCpl: number | null = null
  {
    const leadsByDay = new Map<string, number>()
    for (const d of c.lead?.days ?? []) if (d.leads != null) leadsByDay.set(d.day, Math.max(leadsByDay.get(d.day) ?? 0, d.leads))
    for (const l of c.lead?.cohort ?? []) {
      const day = l.capturedAt.slice(0, 10)
      leadsByDay.set(`k:${day}`, (leadsByDay.get(`k:${day}`) ?? 0) + 1)
    }
    let spend = 0
    let leads = 0
    for (const d of [...c.days].sort((a, b) => a.day.localeCompare(b.day))) {
      if (d.day > today) break
      spend += d.spendCents
      leads += Math.max(leadsByDay.get(d.day) ?? 0, leadsByDay.get(`k:${d.day}`) ?? 0)
      if (leads >= L.l8MinLeads) { firstCpl = Math.round(spend / leads); break }
    }
  }
  const cplRise = firstCpl && cpl7 != null ? (cpl7 - firstCpl) / firstCpl : null

  const ctrLeg = ctrDrop != null && ctrDrop >= L.l8CtrDropPct / 100
  const cplLeg = cplRise != null && cplRise >= L.l8CplRisePct / 100
  if (!ctrLeg && !cplLeg) return null
  const parts: string[] = []
  if (ctrLeg) parts.push(`CTR down ${Math.round(ctrDrop! * 100)}% from its first 3 days`)
  if (cplLeg) parts.push(`CPL up ${Math.round(cplRise! * 100)}% from its first ${L.l8MinLeads} leads (${formatMoney(firstCpl!)} to ${formatMoney(cpl7!)})`)
  return fire(c, 'L8', 'refresh', `Refresh: ${parts.join(', and ')}, L8`, {
    leads: lifeLeads,
    ctrFirstPct: ctrFirst == null ? null : Number(ctrFirst.toFixed(3)),
    ctrNowPct: ctrNow == null ? null : Number(ctrNow.toFixed(3)),
    ctrDropPct: ctrDrop == null ? null : Math.round(ctrDrop * 100),
    firstCplCents: firstCpl, cpl7Cents: cpl7,
    cplRisePct: cplRise == null ? null : Math.round(cplRise * 100),
  })
}

// ---------------------------------------------------------------------------
// L2 per ad set
// ---------------------------------------------------------------------------

/**
 * Decide each L2 candidate: pause the ad, or, when every live ad in its ad set
 * breaches, brake the set 30% (one brake row per ad, since budgets move per
 * creative today). The 72h cooldown is per ad set: an applied L2 row on any ad
 * in the set holds the whole set.
 */
export function resolveL2(
  candidates: readonly L2Candidate[],
  leadCreatives: readonly CreativeRuleInput[],
  s: RulesSettings,
  now: Date,
): RuleFired[] {
  const L = LEAD_RULE_DEFAULTS
  const ceiling = leadCeilingCents(s)
  const setOf = (c: CreativeRuleInput) => c.adsetExternalId ? `set:${c.adsetExternalId}` : `ad:${c.key}`
  const bySet = new Map<string, L2Candidate[]>()
  for (const cand of candidates) {
    const k = setOf(cand.creative)
    bySet.set(k, [...(bySet.get(k) ?? []), cand])
  }
  const out: RuleFired[] = []
  for (const [setKey, list] of bySet) {
    const members = leadCreatives.filter(c => setOf(c) === setKey)
    const cooling = members.some(m => appliedWithin(m.events, now, L.l2CooldownHours, e => e.ruleId === 'L2'))
    if (cooling) continue
    const liveMembers = members.filter(m => !m.paused)
    const everyAd = setKey.startsWith('set:') && liveMembers.length > 0 && liveMembers.every(m => list.some(x => x.creative.key === m.key))
    for (const cand of list) {
      const c = cand.creative
      const cplText = cand.cplCents == null
        ? `${formatMoney(cand.spend7Cents)} spent over 7d with 0 leads`
        : `7d CPL ${formatMoney(cand.cplCents)} on ${cand.leads7} leads`
      const inputs: RuleInputs = {
        cplCents: cand.cplCents, leads: cand.leads7, spend7Cents: cand.spend7Cents, ceilingCents: ceiling,
        multiple: L.l2CplCeilingMultiple, adsetExternalId: c.adsetExternalId ?? null, adsInSet: liveMembers.length,
      }
      if (everyAd) {
        out.push(fire(c, 'L2', 'brake',
          `Brake the ad set ${L.l2BrakePct}%: every live ad in it is over ${L.l2CplCeilingMultiple}x the ${formatMoney(ceiling)} CPL ceiling, this one at ${cplText}, L2`,
          { ...inputs, downPct: L.l2BrakePct, scope: 'adset' }))
      } else {
        out.push(fire(c, 'L2', 'pause',
          `Pause: ${cplText}, over ${L.l2CplCeilingMultiple}x the ${formatMoney(ceiling)} CPL ceiling, L2`,
          { ...inputs, scope: 'ad' }))
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// L3 funnel break
// ---------------------------------------------------------------------------

export interface FunnelBreak {
  trigger: 'no_lead_posts' | 'hello_down' | 'both'
  sentence: string
  inputs: RuleInputs
}

/**
 * L3 on hourly health samples: at least 30 landing views in a rolling 6h with 0
 * successful lead POSTs, or /hello non-200 on 2 consecutive probes. Pure. The
 * lead-post leg needs at least one lead_posts_ok sample in the window, so a
 * counter that is not reporting reads as unknown rather than zero.
 */
export function evaluateFunnelBreak(samples: readonly HealthSample[], now: Date): FunnelBreak | null {
  const L = LEAD_RULE_DEFAULTS
  const from = now.getTime() - L.l3WindowHours * HOUR
  const inWindow = samples.filter(x => {
    const t = Date.parse(x.sampledAt)
    return Number.isFinite(t) && t > from && t <= now.getTime()
  })
  const views = inWindow.filter(x => x.key === 'landing_views')
  const posts = inWindow.filter(x => x.key === 'lead_posts_ok')
  const viewSum = views.reduce((a, x) => a + x.value, 0)
  const postSum = posts.reduce((a, x) => a + x.value, 0)
  const postLeg = posts.length > 0 && viewSum >= L.l3MinLandingViews && postSum === 0

  const hello = samples
    .filter(x => x.key === 'hello_status' && Number.isFinite(Date.parse(x.sampledAt)) && Date.parse(x.sampledAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.sampledAt) - Date.parse(a.sampledAt))
    .slice(0, L.l3HelloFailures)
  const helloLeg = hello.length === L.l3HelloFailures && hello.every(x => x.value !== 200)

  if (!postLeg && !helloLeg) return null
  const parts: string[] = []
  if (postLeg) parts.push(`${viewSum} landing views in ${L.l3WindowHours}h and 0 successful lead posts`)
  if (helloLeg) parts.push(`/hello failed ${L.l3HelloFailures} probes in a row (${hello.map(x => x.value).join(', ')})`)
  return {
    trigger: postLeg && helloLeg ? 'both' : postLeg ? 'no_lead_posts' : 'hello_down',
    sentence: `Pause all: ${parts.join(', and ')}, L3`,
    inputs: {
      ruleSet: 'leads', landingViews6h: viewSum, leadPostsOk6h: posts.length ? postSum : null,
      helloStatuses: hello.map(x => x.value).join(',') || null, windowHours: L.l3WindowHours,
    },
  }
}

/** L3 as firings: one pause per live lead creative, so each lands as a tappable row. */
export function funnelBreakFirings(fb: FunnelBreak, leadCreatives: readonly CreativeRuleInput[]): RuleFired[] {
  return leadCreatives.filter(c => !c.paused).map(c => ({
    ruleId: 'L3' as const, creativeKey: c.key, creativeId: c.creativeId, action: 'pause' as const,
    sentence: fb.sentence, inputs: { ...fb.inputs, trigger: fb.trigger },
  }))
}
