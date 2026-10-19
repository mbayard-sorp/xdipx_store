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
