/**
 * Ticket #5943: enqueueVideoJob refuses a job whose estimate exceeds the video
 * team's remaining daily budget, before the job row is inserted. The decision
 * is a pure predicate (estimateExceedsRemainingBudget) so the boundary is a
 * direct unit test rather than a fully-mocked enqueue, mirroring how
 * team-image-cap.test.ts tests imageCapRefusesRun.
 */
import { describe, it, expect } from 'vitest'
import { estimateExceedsRemainingBudget } from '~/lib/video-pipeline.server'

describe('estimateExceedsRemainingBudget (ticket #5943)', () => {
  // $20 daily budget, $14 already spent -> $6.00 remaining.
  const daily = 2000
  const spent = 1400 // remaining = 600 cents

  it('an estimate equal to the remaining budget passes (not refused)', () => {
    expect(estimateExceedsRemainingBudget(6.0, daily, spent)).toBe(false)
  })

  it('one cent over the remaining budget is refused', () => {
    expect(estimateExceedsRemainingBudget(6.01, daily, spent)).toBe(true)
  })

  it('a comfortably-affordable estimate passes', () => {
    expect(estimateExceedsRemainingBudget(0.5, daily, spent)).toBe(false)
  })

  it('floating-point dollar math does not nudge the boundary (integer cents)', () => {
    // 0.1 + 0.2 style drift: $0.50 estimate against exactly $0.50 remaining.
    expect(estimateExceedsRemainingBudget(0.5, 100, 50)).toBe(false)
    expect(estimateExceedsRemainingBudget(0.5, 100, 51)).toBe(true) // remaining 49c
  })

  it('remaining is clamped at zero when the day is already over budget', () => {
    expect(estimateExceedsRemainingBudget(0.01, 2000, 2000)).toBe(true)
    expect(estimateExceedsRemainingBudget(0.01, 2000, 2500)).toBe(true)
    // a zero-cost job still passes even at zero remaining.
    expect(estimateExceedsRemainingBudget(0, 2000, 2000)).toBe(false)
  })
})
