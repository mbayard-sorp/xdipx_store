/**
 * Errors shared by every channel adapter. Client-safe.
 */
import type { ChannelId } from './types'

/**
 * Thrown by an adapter method that exists on the interface but is switched
 * off for that channel. Meta's createPaused and mutate throw this until
 * phases 5a and 6a ship them behind the ledger.
 */
export class ChannelNotEnabledError extends Error {
  readonly kind = 'not_enabled' as const
  constructor(readonly channel: ChannelId, readonly operation: string) {
    super(`${operation} is not enabled for channel ${channel}.`)
    this.name = 'ChannelNotEnabledError'
  }
}

export type MutationRefusalCode =
  | 'm4_resume_refused'
  | 'daily_cap_exceeded'
  | 'budget_step_exceeded'
  | 'approval_required'
  | 'bad_target'
  | 'bad_params'
  | 'not_configured'

/**
 * Thrown by an adapter's mutate when it refuses a change before calling the
 * platform: a resume M4 forbids, a budget past the daily cap, a step past
 * ads_budget_max_step_pct. The dispatcher writes `code: message` into
 * ad_actions.error and marks the row failed.
 */
export class MutationRefusedError extends Error {
  readonly kind = 'refused' as const
  constructor(readonly channel: ChannelId, readonly code: MutationRefusalCode, message: string) {
    super(message)
    this.name = 'MutationRefusedError'
  }
}
