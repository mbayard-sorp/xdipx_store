/**
 * Max-subscription source labels must cost zero.
 *
 * Regression guard for 2026-08-21: a single `api_token_log` row with
 * source='anthropic-max' booked $43.50 of cost and closed the social team's
 * daily budget gate, when the team's real spend that day was about four cents.
 * The tokens were billed to a Max subscription; no money moved. Only the
 * literal 'agent-sdk' had been zero-rated, so every other Max label fell
 * through to Opus list pricing.
 */
import { describe, it, expect } from 'vitest'
import { estimateCostUsd, MAX_SUBSCRIPTION_SOURCES } from '~/lib/model-pricing.server'

const BIG = { model: 'claude-opus-4-8', inputTokens: 1_250_000, outputTokens: 330_000, cacheCreationTokens: 0, cacheReadTokens: 0 }

describe('Max-subscription sources are free', () => {
  it.each([...MAX_SUBSCRIPTION_SOURCES])('source %s costs 0', src => {
    expect(estimateCostUsd({ ...BIG, source: src })).toBe(0)
  })

  it('reproduces the exact $43.50 phantom charge under the old behaviour', () => {
    // Same row priced as an API-key call: 1.25M in at $15/M + 330k out at $75/M.
    expect(estimateCostUsd({ ...BIG, source: 'sync' })).toBeCloseTo(43.5, 2)
    // ...and free once recognised as Max-billed, which is what it always was.
    expect(estimateCostUsd({ ...BIG, source: 'anthropic-max' })).toBe(0)
  })

  it('still charges real API-key sources, so the fix cannot blind a budget gate', () => {
    expect(estimateCostUsd({ ...BIG, source: 'sync' })).toBeGreaterThan(0)
    expect(estimateCostUsd({ ...BIG, source: 'batch' })).toBeGreaterThan(0)
  })

  it('prices an unrecognised source at the premium tier rather than free', () => {
    // Unknown must never silently become free; that would loosen every gate.
    expect(estimateCostUsd({ ...BIG, source: 'something-new' })).toBeGreaterThan(0)
  })
})
