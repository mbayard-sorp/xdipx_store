/**
 * The seam between the rules engine and the ad platforms (Ad Studio v2).
 * PROTECTED PATH: the owner merges every change to this file.
 *
 * PR-H records every pause, resume, scale and brake in ad_rule_events and in
 * ad_creatives. Since phase 4c (ticket #16429) the default applier hands each
 * one to the ledger dispatcher in app/lib/ads/channels/apply.server.ts, which
 * writes an ad_actions row for it and is the only code that may call a
 * platform mutation. With either ads_spend_enabled or ads_auto_apply_enabled
 * off, the row is dry_run and nothing reaches a platform.
 *
 * `halt` (ticket #16432) is R7's account-wide stop. It becomes one halt_all
 * ledger row per channel instead of one pause per ad, so it counts as one
 * action and the automatic pause cap (3 a day) cannot swallow a spend guard.
 *
 * setPlatformApplier registers a test override. An override keeps the old
 * contract exactly: with spendEnabled false, platformApply returns without
 * calling it, so a registered fake cannot be reached by accident.
 */
import type { ChannelId, EntityRef } from '~/lib/ads/channels/types'
import type { DispatchVerb } from '~/lib/ads/channels/apply-core'

export type PlatformAction = 'pause' | 'resume' | 'scale' | 'brake' | 'refresh' | 'halt'

export interface PlatformApplyRequest {
  /** The creative the action is about. Null for halt, which is about the whole account. */
  creativeId: number | null
  externalAdId: string | null
  lane: string | null
  action: PlatformAction
  /** The creative's budget multiplier after this action (scale and brake). */
  budgetMultiplier: number
  /** The multiplier before this action. scale and brake move the platform budget by after over before. */
  previousBudgetMultiplier?: number
  reason: string
  /** An explicit platform entity. Without it the dispatcher resolves one from externalAdId and the mirror. */
  target?: EntityRef
  /** The ad_rule_events row behind this action, stored on the ledger row. */
  ruleEventId?: number | null
  /** rule:R1, owner, or the admin's email. Defaults to owner. */
  proposedBy?: string
}

export interface PlatformApplyResult {
  /** True only when a platform call really changed something. */
  applied: boolean
  note: string
  error?: boolean
  /** The ad_actions row the dispatcher wrote or found, when there is one. */
  actionId?: number | null
  /** That row's status: dry_run, applied, failed, or skipped when no row could be written. */
  ledgerStatus?: string
}

export type PlatformApplier = (req: PlatformApplyRequest) => Promise<PlatformApplyResult>

const VERB: Record<PlatformAction, DispatchVerb> = {
  pause: 'pause', resume: 'resume', scale: 'scale', brake: 'brake', refresh: 'update_creative', halt: 'halt_all',
}

/** Ad Studio lanes that are also channel ids. */
const LANE_CHANNELS = new Set<string>(['meta', 'microsoft', 'google', 'snap'])

function budgetFactor(req: PlatformApplyRequest): number | undefined {
  if (req.action !== 'scale' && req.action !== 'brake') return undefined
  const prev = req.previousBudgetMultiplier
  if (prev == null || !(prev > 0) || !Number.isFinite(req.budgetMultiplier)) return undefined
  return req.budgetMultiplier / prev
}

async function dispatchApplier(req: PlatformApplyRequest, spendEnabled: boolean): Promise<PlatformApplyResult> {
  const { dispatch } = await import('~/lib/ads/channels/apply.server')
  const r = await dispatch({
    verb: VERB[req.action],
    adExternalId: req.externalAdId,
    target: req.target,
    platform: req.lane && LANE_CHANNELS.has(req.lane) ? (req.lane as ChannelId) : null,
    budgetFactor: budgetFactor(req),
    proposedBy: req.proposedBy ?? 'owner',
    reason: req.reason,
    ruleEventId: req.ruleEventId ?? null,
    spendEnabledHint: spendEnabled,
  })
  return { applied: r.applied, note: r.note, ...(r.error ? { error: true } : {}), actionId: r.actionId, ledgerStatus: r.status }
}

let override: PlatformApplier | null = null

/** Tests register fakes here. null restores the ledger dispatcher. */
export function setPlatformApplier(fn: PlatformApplier | null): void {
  override = fn
}

export async function platformApply(
  req: PlatformApplyRequest,
  opts: { spendEnabled: boolean },
): Promise<PlatformApplyResult> {
  try {
    if (override) {
      if (!opts.spendEnabled) return { applied: false, note: 'Simulation: no platform call.' }
      return await override(req)
    }
    // The dispatcher always runs, valve or not: with a valve off it writes the
    // dry_run row and stops there.
    return await dispatchApplier(req, opts.spendEnabled)
  } catch (err) {
    console.error('[ad-platform-apply] applier threw', req.creativeId, req.action, err)
    return { applied: false, error: true, note: err instanceof Error ? err.message : 'Platform call failed.' }
  }
}
