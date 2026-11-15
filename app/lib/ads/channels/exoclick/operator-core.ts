/**
 * The pure half of the ExoClick write path (ticket #19412). No I/O: the
 * switch, the cap, the brake/gas split and the spend projection are decided
 * here so they test without a database or a network.
 *
 * Two settings, both in pipeline_settings, both owner-written:
 *   exoclick_operator_enabled   a missing row reads as off.
 *   exoclick_total_cap_cents    a missing row reads as 0, which means nothing
 *                               that can increase spend is allowed.
 * They are separate from ads_spend_enabled on purpose: that valve also gates
 * Meta, and turning on ExoClick must not turn on anything else.
 *
 * Brakes (pause, block a site, lower a budget) are allowed whenever the
 * operator switch is on. Gas (resume, create, raise a budget, upload a
 * banner) is allowed only when the switch is on AND the projected total
 * spend stays under the cap.
 */
import type { MutationVerb } from '../types'

export const EXO_SETTING_KEYS = {
  operatorEnabled: 'exoclick_operator_enabled',
  totalCapCents: 'exoclick_total_cap_cents',
} as const

export const EXO_OPERATOR_ENABLED_DEFAULT = false
export const EXO_TOTAL_CAP_CENTS_DEFAULT = 0

/** ExoClick's own floor: a daily or total budget under $20 is refused by the API. */
export const EXO_MIN_BUDGET_CENTS = 2000

export interface ExoOperatorSettings {
  operatorEnabled: boolean
  totalCapCents: number
}

export function parseExoBool(raw: string | null | undefined): boolean {
  if (raw == null) return EXO_OPERATOR_ENABLED_DEFAULT
  const v = raw.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'on'
}

export function parseExoCapCents(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return EXO_TOTAL_CAP_CENTS_DEFAULT
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : EXO_TOTAL_CAP_CENTS_DEFAULT
}

export type ExoVerbKind = 'brake' | 'gas'

/**
 * Brake or gas. A budget change is a brake only when the new amount is below
 * the current one; equal, higher or unreadable is gas, because the safe guess
 * about an unknown direction is that it can spend.
 */
export function classifyExoVerb(
  verb: MutationVerb | 'create_paused',
  params: unknown,
  currentDailyBudgetCents: number | null,
): ExoVerbKind {
  switch (verb) {
    case 'pause':
    case 'halt_all':
    case 'block_placement':
      return 'brake'
    case 'set_budget': {
      const p = (params ?? {}) as Record<string, unknown>
      const proposed = typeof p['dailyBudgetCents'] === 'number' ? p['dailyBudgetCents'] : null
      if (proposed == null || currentDailyBudgetCents == null) return 'gas'
      return proposed < currentDailyBudgetCents ? 'brake' : 'gas'
    }
    default:
      // resume, update_creative (banner upload), create_paused
      return 'gas'
  }
}

/** One campaign's money, in cents, as the live API reports it. */
export interface ExoCampaignMoney {
  id: string
  /** 'ACTIVE' | 'PAUSED' | 'ARCHIVED' */
  status: string
  dailyBudgetCents: number | null
  totalBudgetCents: number | null
  spentCents: number
}

/**
 * What a campaign can still spend if left running: what remains of its total
 * budget when it has one, else one day of its daily budget.
 */
export function remainingCommitmentCents(c: ExoCampaignMoney): number {
  if (c.totalBudgetCents != null && c.totalBudgetCents > 0) return Math.max(0, c.totalBudgetCents - c.spentCents)
  return Math.max(0, c.dailyBudgetCents ?? 0)
}

export interface SpendAddition {
  /** A campaign that is not running now but would be: resumed, or newly created and then resumed. */
  campaign?: ExoCampaignMoney
  /** A flat amount for something not in the campaign list, in cents. */
  extraCents?: number
}

/**
 * Everything ever spent plus everything the running campaigns could still
 * spend, plus what the action adds. A budget raise is modelled as the target
 * campaign carrying its new budget, so it is not counted twice.
 */
export function projectTotalSpendCents(campaigns: readonly ExoCampaignMoney[], add: SpendAddition = {}): number {
  const addId = add.campaign?.id
  const spent = campaigns.reduce((n, c) => n + c.spentCents, 0)
  const committed = campaigns
    .filter(c => c.status === 'ACTIVE' && c.id !== addId)
    .reduce((n, c) => n + remainingCommitmentCents(c), 0)
  const added = add.campaign ? remainingCommitmentCents(add.campaign) : 0
  // A campaign that is in the list already has its spend counted; one that is not adds its own.
  const addedSpend = add.campaign && !campaigns.some(c => c.id === addId) ? add.campaign.spentCents : 0
  return spent + addedSpend + committed + added + (add.extraCents ?? 0)
}

export type ExoGateCode = 'not_enabled' | 'cap_not_set' | 'over_cap'

export interface ExoGate {
  allowed: boolean
  code: ExoGateCode | null
  reason: string | null
}

export interface ExoGateInput {
  kind: ExoVerbKind
  settings: ExoOperatorSettings
  /** Required for gas. Null for gas means the projection could not be made, which refuses. */
  projectedTotalCents: number | null
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** The first reason that applies wins: the switch, then the cap, then the projection. */
export function evaluateExoGate(g: ExoGateInput): ExoGate {
  if (!g.settings.operatorEnabled) {
    return { allowed: false, code: 'not_enabled', reason: `${EXO_SETTING_KEYS.operatorEnabled} is off` }
  }
  if (g.kind === 'brake') return { allowed: true, code: null, reason: null }
  if (!(g.settings.totalCapCents > 0)) {
    return { allowed: false, code: 'cap_not_set', reason: `${EXO_SETTING_KEYS.totalCapCents} is 0 or missing, so nothing that can raise spend is allowed` }
  }
  if (g.projectedTotalCents == null) {
    return { allowed: false, code: 'over_cap', reason: 'projected total spend could not be computed, so the cap cannot be checked' }
  }
  if (g.projectedTotalCents > g.settings.totalCapCents) {
    return {
      allowed: false,
      code: 'over_cap',
      reason: `projected total spend ${dollars(g.projectedTotalCents)} is over ${EXO_SETTING_KEYS.totalCapCents} (${dollars(g.settings.totalCapCents)})`,
    }
  }
  return { allowed: true, code: null, reason: null }
}

// -- Hostnames -----------------------------------------------------------------

/** Most hostnames sent in one block call. ExoClick documents no limit; stay well under any request-size cap. */
export const MAX_BLOCK_HOSTNAMES_PER_CALL = 100

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/

/**
 * A hostname as ExoClick reports it in site_hostname: lower case, no scheme,
 * no path. Returns null for anything that is not a plain hostname, so a
 * malformed or hostile string never reaches the block list.
 */
export function normalizeHostname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const h = raw.trim().toLowerCase()
  return HOSTNAME_RE.test(h) ? h : null
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
