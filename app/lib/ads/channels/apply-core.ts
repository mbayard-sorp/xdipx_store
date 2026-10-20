/**
 * The pure half of the ledger dispatcher (plan §5 and §9.4, ticket #16429).
 * No database, no platform, no settings read: channels/apply.server.ts loads
 * those and asks these functions what to do with them.
 *
 * The one invariant lives in classifyTier. An action that can raise spend is
 * never tier auto, whoever proposed it.
 */
import type { AdActionStatus, AdActionTier } from '../../../../db/schema'
import type { EntityLevel, EntityRef } from './types'

/**
 * What a caller may ask the dispatcher for. The ledger's own verbs, plus the
 * rules engine's scale and brake, which are budget changes in a direction.
 */
export type DispatchVerb =
  | 'pause' | 'resume' | 'set_budget' | 'update_creative' | 'halt_all'
  | 'scale' | 'brake'

/** The budget fields a set_budget compares. Cents, as the mirror stores them. */
export interface BudgetValues {
  dailyBudgetCents?: number | null
  lifetimeBudgetCents?: number | null
}

/** The current budget and the proposed one, whichever field the owner carries. */
export interface BudgetChange {
  current: number | null
  proposed: number | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Reads the current and proposed budget out of before and params. Daily wins
 * when both are present, because that is the field Meta's set_budget writes
 * on an ad set or a CBO campaign.
 */
export function budgetChangeOf(params: unknown, before: Record<string, unknown> | null): BudgetChange {
  const p = (params ?? {}) as Record<string, unknown>
  const b = before ?? {}
  if (num(p['dailyBudgetCents']) != null) {
    return { current: num(b['dailyBudgetCents']), proposed: num(p['dailyBudgetCents']) }
  }
  if (num(p['lifetimeBudgetCents']) != null) {
    return { current: num(b['lifetimeBudgetCents']), proposed: num(p['lifetimeBudgetCents']) }
  }
  return { current: null, proposed: null }
}

/**
 * Spend-decreasing is auto, spend-increasing is approve, everything else is
 * owner (plan §5).
 *
 * - pause, halt_all: auto. Stopping delivery cannot raise spend.
 * - resume: approve. Restarting delivery raises spend.
 * - set_budget: auto when the new amount is below the current one, approve
 *   when above. Equal, or a side that cannot be read, is owner: the
 *   classifier will not guess a direction.
 * - scale: approve, always.
 * - brake: auto, unless its own numbers say the budget goes up or stays put,
 *   in which case it is judged as the set_budget it really is.
 * - update_creative and anything unknown: owner.
 */
export function classifyTier(
  verb: string,
  params: unknown,
  before: Record<string, unknown> | null,
): AdActionTier {
  switch (verb) {
    case 'pause':
    case 'halt_all':
      return 'auto'
    case 'resume':
    case 'scale':
      return 'approve'
    case 'set_budget': {
      const { current, proposed } = budgetChangeOf(params, before)
      if (current == null || proposed == null) return 'owner'
      if (proposed < current) return 'auto'
      if (proposed > current) return 'approve'
      return 'owner'
    }
    case 'brake': {
      const { current, proposed } = budgetChangeOf(params, before)
      if (current == null || proposed == null) return 'auto'
      if (proposed < current) return 'auto'
      if (proposed > current) return 'approve'
      return 'owner'
    }
    default:
      return 'owner'
  }
}

/**
 * True when the move from current to proposed is at most maxStepPct of
 * current, in either direction. A missing or zero current budget is never
 * within step, since there is nothing to take a percentage of.
 */
export function budgetWithinStep(current: number | null, proposed: number | null, maxStepPct: number): boolean {
  if (current == null || proposed == null || !(current > 0) || proposed < 0) return false
  const stepPct = (Math.abs(proposed - current) / current) * 100
  // A hair of tolerance so a 20% step computed through rounding still counts as 20%.
  return stepPct <= maxStepPct + 1e-9
}

/** True while today's automatic actions are under the per-day cap. */
export function withinDailyActionCap(countToday: number, max: number): boolean {
  return countToday < max
}

/**
 * The proposers whose halt_all is a spend guard (plan §9.4, ticket #16648):
 * R7 is the account spend guard, L3 its lead-campaign twin.
 */
export const SPEND_GUARD_PROPOSERS: ReadonlySet<string> = new Set(['rule:R7', 'rule:L3'])

/** Written into the reason of a spend-guard halt that the caps let through. */
export const SPEND_GUARD_CAP_EXEMPT_REASON = 'spend guard: cap exempt'

/**
 * True for a halt_all proposed by R7 or L3. Owner decision 2026-10-20: a
 * spend-guard halt always applies, so it is exempt from
 * ads_auto_actions_max_per_day and from the 3-a-day automatic pause cap.
 * The valves still hold it. A halt from anyone else (the owner, the buyer)
 * is an ordinary automatic action.
 */
export function isSpendGuardHalt(verb: string, proposedBy: string | null | undefined): boolean {
  return verb === 'halt_all' && !!proposedBy && SPEND_GUARD_PROPOSERS.has(proposedBy)
}

/** The slice of an ad_platform_entities row the dispatcher reads. */
export interface MirrorBudgetRow {
  platform: string
  level: EntityLevel
  externalId: string
  parentExternalId: string | null
  status?: string | null
  effectiveStatus?: string | null
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
}

function hasBudget(row: MirrorBudgetRow): boolean {
  return (row.dailyBudgetCents ?? 0) > 0 || (row.lifetimeBudgetCents ?? 0) > 0
}

/**
 * The entity that owns an ad's budget. Under CBO the campaign carries a daily
 * or lifetime budget and owns it; under ABO the campaign has none and the ad
 * set owns it. Null when the ad or its ad set is not in the mirror.
 */
export function resolveBudgetOwner(mirrorRows: readonly MirrorBudgetRow[], adExternalId: string): EntityRef | null {
  const ad = mirrorRows.find(r => r.level === 'ad' && r.externalId === adExternalId)
  if (!ad?.parentExternalId) return null
  const adset = mirrorRows.find(r => r.level === 'adset' && r.externalId === ad.parentExternalId)
  if (!adset) return null
  const campaign = adset.parentExternalId
    ? mirrorRows.find(r => r.level === 'campaign' && r.externalId === adset.parentExternalId)
    : undefined
  const owner = campaign && hasBudget(campaign) ? campaign : adset
  return { platform: owner.platform as EntityRef['platform'], level: owner.level, externalId: owner.externalId }
}

export interface DispatchGateInput {
  tier: AdActionTier
  spendEnabled: boolean
  autoApplyEnabled: boolean
  autoActionsToday: number
  autoActionsMaxPerDay: number
  /** Only set for a budget change. True when the step is inside ads_budget_max_step_pct. */
  budgetStepOk?: boolean | undefined
  budgetMaxStepPct?: number | undefined
  /** The request's verb and proposer. A spend-guard halt (isSpendGuardHalt) skips the daily cap. */
  verb?: string | undefined
  proposedBy?: string | null | undefined
}

export interface DispatchGate {
  /** proposed means the row goes on to be applied now; dry_run means it stops at the ledger. */
  status: Extract<AdActionStatus, 'proposed' | 'dry_run'>
  /** Why it stopped, null when it goes ahead. */
  dryRunReason: string | null
}

/**
 * Whether a classified action may reach the platform now. The first reason
 * that applies wins, valves before tier before caps, so the reason on a row
 * names the outermost thing holding it.
 *
 * A spend-guard halt (halt_all from rule:R7 or rule:L3) skips the daily
 * action cap: the owner decided on 2026-10-20 that a spend guard always
 * applies once both valves are on, however many automatic actions ran first.
 */
export function gateDispatch(g: DispatchGateInput): DispatchGate {
  const hold = (dryRunReason: string): DispatchGate => ({ status: 'dry_run', dryRunReason })
  if (!g.spendEnabled) return hold('ads_spend_enabled is off')
  if (!g.autoApplyEnabled) return hold('ads_auto_apply_enabled is off')
  if (g.tier === 'approve') return hold('tier approve: this can raise spend, so it waits for a tap')
  if (g.tier === 'owner') return hold('tier owner: only the owner makes this change')
  const capExempt = g.verb != null && isSpendGuardHalt(g.verb, g.proposedBy)
  if (!capExempt && !withinDailyActionCap(g.autoActionsToday, g.autoActionsMaxPerDay)) {
    return hold(`daily cap reached: ${g.autoActionsToday} automatic actions today, cap ${g.autoActionsMaxPerDay}`)
  }
  if (g.budgetStepOk === false) {
    return hold(`budget step is over ads_budget_max_step_pct (${g.budgetMaxStepPct ?? '?'}%)`)
  }
  return { status: 'proposed', dryRunReason: null }
}
