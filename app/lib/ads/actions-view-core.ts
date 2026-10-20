/**
 * Client-safe tabs and labels for the ads console's actions view (ticket
 * #16430). The route component renders these, so they live outside the
 * .server module; React Router strips server code only from loader and
 * action exports.
 */
import type { AdActionStatus, AdActionTier, AdActionVerb } from './ledger-core'

export type ActionsTab = 'pending' | 'dry_run' | 'applied' | 'failed'

export const ACTIONS_TABS: readonly ActionsTab[] = ['pending', 'dry_run', 'applied', 'failed']

/**
 * Which ledger statuses each tab shows. Applied also carries approved rows,
 * the ones waiting for the applier, so a tap never makes a row vanish from
 * every tab. Failed carries everything that ended without reaching the
 * platform: failed, rejected and expired, each labelled.
 */
export const TAB_STATUSES: Readonly<Record<ActionsTab, readonly AdActionStatus[]>> = {
  pending: ['proposed'],
  dry_run: ['dry_run'],
  applied: ['applied', 'approved'],
  failed: ['failed', 'rejected', 'expired'],
}

export const TAB_LABELS: Readonly<Record<ActionsTab, string>> = {
  pending: 'Pending',
  dry_run: 'Dry run',
  applied: 'Applied',
  failed: 'Failed',
}

export function parseTab(value: string | null | undefined): ActionsTab {
  return ACTIONS_TABS.includes(value as ActionsTab) ? (value as ActionsTab) : 'pending'
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Readonly<Record<AdActionStatus, string>> = {
  proposed: 'Waiting for you',
  dry_run: 'Dry run',
  approved: 'Approved, waiting for the applier',
  applied: 'Applied',
  failed: 'Failed',
  rejected: 'Rejected',
  expired: 'Expired',
}

/** Plan §9.4 names the tiers A, B and C; the ledger stores auto, approve, owner. */
export const TIER_LABELS: Readonly<Record<AdActionTier, string>> = {
  auto: 'A: machine alone',
  approve: 'B: one tap',
  owner: 'C: owner only',
}

export const VERB_LABELS: Readonly<Record<AdActionVerb, string>> = {
  pause: 'Pause',
  resume: 'Resume',
  set_budget: 'Set budget',
  update_creative: 'Swap creative',
  halt_all: 'Halt everything',
}
