/**
 * conversation-summary-bridge.test.ts
 *
 * Regression tests for bridgeSummary in conversation.server.ts.
 *
 * Every 24h session rotation re-prefixed the stored summary, so a returning
 * caller's row accumulated the bridge phrase once per rotation. A live
 * conversation row carried six stacked copies ahead of a summary that was
 * itself months stale, all of it injected into the model's context block.
 */
import { describe, it, expect } from 'vitest'
import { bridgeSummary } from '../conversation.server'

describe('bridgeSummary', () => {
  it('prefixes a fresh summary once', () => {
    expect(bridgeSummary('Customer is shopping for a couples vibrator.')).toBe(
      'From a previous conversation: Customer is shopping for a couples vibrator.',
    )
  })

  it('does not stack the prefix on an already-bridged summary', () => {
    const once = bridgeSummary('Customer likes quiet toys.')
    const twice = bridgeSummary(once)
    const thrice = bridgeSummary(twice)
    expect(thrice).toBe('From a previous conversation: Customer likes quiet toys.')
  })

  it('collapses a summary that already accumulated several prefixes', () => {
    const stacked =
      'From a previous conversation: From a previous conversation: From a previous conversation: Customer previously used a plug.'
    expect(bridgeSummary(stacked)).toBe(
      'From a previous conversation: Customer previously used a plug.',
    )
  })

  it('returns null for an absent summary rather than bridging nothing', () => {
    expect(bridgeSummary(null)).toBeNull()
    expect(bridgeSummary(undefined)).toBeNull()
    expect(bridgeSummary('')).toBeNull()
    expect(bridgeSummary('   ')).toBeNull()
  })

  it('returns null when the summary is nothing but stacked prefixes', () => {
    expect(bridgeSummary('From a previous conversation: From a previous conversation:')).toBeNull()
  })
})
