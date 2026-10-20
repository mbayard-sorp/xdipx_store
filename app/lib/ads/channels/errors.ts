/**
 * Errors shared by every channel adapter. Client-safe.
 */
import type { ChannelId, ChannelNotReadyReason } from './types'

/**
 * Thrown by an adapter method that exists on the interface but is switched
 * off for that channel, such as Meta's update_creative.
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
  | 'spend_disabled'
  | 'already_applied'

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

/**
 * Thrown by an adapter read when the platform answers but the account behind
 * it cannot be used yet, such as a Microsoft account still Pending in the
 * Adult Advertising Program. The token is fine, so this is not a token
 * problem, and nothing is broken on our side, so it is not a failure: the
 * sync and insights crons record the channel as skipped with the reason.
 */
export class ChannelNotReadyError extends Error {
  readonly kind = 'not_ready' as const
  constructor(readonly channel: ChannelId, readonly reason: ChannelNotReadyReason, message: string) {
    super(message)
    this.name = 'ChannelNotReadyError'
  }
}

/** Duck-typed so an error from another bundle copy of this module still counts. */
export function isChannelNotReady(e: unknown): e is ChannelNotReadyError {
  if (e instanceof ChannelNotReadyError) return true
  if (!e || typeof e !== 'object') return false
  const o = e as { name?: unknown; kind?: unknown; reason?: unknown }
  return o.name === 'ChannelNotReadyError' && o.kind === 'not_ready' && typeof o.reason === 'string'
}

/**
 * How a not-ready reason rides in ad_channel_health.error, so the Channels
 * page can show it without a schema change. The row's state stays whatever
 * the token reading says (ok, for a pending Microsoft account).
 */
export const NOT_READY_ERROR_PREFIX = 'not_ready:'

const NOT_READY_REASONS: readonly ChannelNotReadyReason[] = ['account_inactive']

export function notReadyHealthError(reason: ChannelNotReadyReason): string {
  return `${NOT_READY_ERROR_PREFIX}${reason}`
}

/** The reason stored in an ad_channel_health.error value, or null when it holds none. */
export function notReadyFromHealthError(error: string | null | undefined): ChannelNotReadyReason | null {
  if (!error || !error.startsWith(NOT_READY_ERROR_PREFIX)) return null
  const reason = error.slice(NOT_READY_ERROR_PREFIX.length) as ChannelNotReadyReason
  return NOT_READY_REASONS.includes(reason) ? reason : null
}
