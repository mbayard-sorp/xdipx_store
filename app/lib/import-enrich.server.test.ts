import { describe, it, expect } from 'vitest'
import {
  decideEnrichFailure,
  isBatchClaimStuck,
  ENRICH_MAX_ATTEMPTS,
  STUCK_BATCH_MAX_HOURS,
} from './import-enrich.server'

// These pure helpers back the stuck-batch recovery guard in
// collectEnrichmentBatch: a single un-retrievable or never-ending Anthropic
// batch must never freeze the whole enrich->publish tick. They are extracted so
// the retry-vs-park and age-out decisions are verified without a database.

describe('decideEnrichFailure', () => {
  it('re-queues (retry) on the first failure, below the cap', () => {
    // currentAttempts 0 -> enrichAttempts 1, and 1 < ENRICH_MAX_ATTEMPTS (2)
    expect(decideEnrichFailure(0)).toEqual({ action: 'retry', enrichAttempts: 1 })
  })

  it('parks once the attempt reaches the cap', () => {
    // currentAttempts 1 -> enrichAttempts 2, not below the cap
    expect(decideEnrichFailure(1)).toEqual({ action: 'park', enrichAttempts: 2 })
  })

  it('parks for any attempt at or beyond the cap', () => {
    expect(decideEnrichFailure(2).action).toBe('park')
    expect(decideEnrichFailure(5).action).toBe('park')
  })

  it('matches the retry/park boundary implied by ENRICH_MAX_ATTEMPTS', () => {
    // The last retry is the attempt that lands exactly at the cap.
    const lastRetry = decideEnrichFailure(ENRICH_MAX_ATTEMPTS - 2)
    const firstPark = decideEnrichFailure(ENRICH_MAX_ATTEMPTS - 1)
    expect(lastRetry.action).toBe('retry')
    expect(firstPark.action).toBe('park')
    expect(firstPark.enrichAttempts).toBe(ENRICH_MAX_ATTEMPTS)
  })
})

describe('isBatchClaimStuck', () => {
  const now = new Date('2026-08-02T20:00:00.000Z')

  it('is not stuck when the batch was just claimed', () => {
    const claimedAt = new Date(now.getTime() - 60 * 60 * 1000) // 1h ago
    expect(isBatchClaimStuck(claimedAt, now)).toBe(false)
  })

  it('is not stuck just inside the SLA window', () => {
    const claimedAt = new Date(now.getTime() - (STUCK_BATCH_MAX_HOURS - 1) * 3_600_000)
    expect(isBatchClaimStuck(claimedAt, now)).toBe(false)
  })

  it('is stuck once past STUCK_BATCH_MAX_HOURS', () => {
    const claimedAt = new Date(now.getTime() - (STUCK_BATCH_MAX_HOURS + 1) * 3_600_000)
    expect(isBatchClaimStuck(claimedAt, now)).toBe(true)
  })

  it('treats the exact threshold as stuck', () => {
    const claimedAt = new Date(now.getTime() - STUCK_BATCH_MAX_HOURS * 3_600_000)
    expect(isBatchClaimStuck(claimedAt, now)).toBe(true)
  })

  it('never treats a missing anchor as stuck', () => {
    expect(isBatchClaimStuck(null, now)).toBe(false)
    expect(isBatchClaimStuck(undefined, now)).toBe(false)
  })

  it('honours a caller-supplied maxHours override', () => {
    const claimedAt = new Date(now.getTime() - 3 * 3_600_000) // 3h ago
    expect(isBatchClaimStuck(claimedAt, now, 2)).toBe(true)
    expect(isBatchClaimStuck(claimedAt, now, 4)).toBe(false)
  })
})
