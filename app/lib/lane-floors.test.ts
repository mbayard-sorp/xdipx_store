/**
 * The floors themselves: are the bounds derived from anything.
 *
 * A threshold nobody chose from data is a guess, and a guess that fires is
 * indistinguishable from a fault. The plan these implement said to seed every
 * floor at its lane's observed p10, and measuring first is what showed that
 * would not work: p10 is zero for all three lanes here, so a rate floor at p10
 * is a check that cannot fail. These assertions lock in the shape that
 * measurement produced instead.
 */
import { describe, expect, it } from 'vitest'
import { LANE_FLOORS } from '~/lib/lane-floors.server'

describe('every floor is derived, not guessed', () => {
  it('states why its bound is that number', () => {
    for (const f of LANE_FLOORS) {
      expect(f.rationale.length, f.lane).toBeGreaterThan(80)
    }
  })

  it('names a team that will receive the ticket', () => {
    // Invariant 3: a lane breach files at the lane, never at the owner. A floor
    // with no team has nowhere to file, which silently becomes "drop it".
    for (const f of LANE_FLOORS) {
      expect(f.team, f.lane).toBeTruthy()
    }
  })

  it('uses a positive threshold, so no floor is vacuous', () => {
    // A rate floor of 0 always passes and a staleness bound of 0 always fires.
    // Either one is a check that reports nothing about the lane.
    for (const f of LANE_FLOORS) {
      expect(f.threshold, f.lane).toBeGreaterThan(0)
    }
  })

  it('has a unique lane id, since the dedupe key is built from it', () => {
    const ids = LANE_FLOORS.map(f => f.lane)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the kind matches the lane shape it was measured against', () => {
  it('gives the sporadic lanes a staleness bound, not a rate', () => {
    // indexnow pushed nothing on 26 of 30 days and 1,588 on one of them;
    // outreach sent once in eight weeks. "How much today" is unanswerable for
    // both; "how long since anything" is not.
    for (const lane of ['indexnow', 'outreach']) {
      expect(LANE_FLOORS.find(f => f.lane === lane)?.kind, lane).toBe('staleness')
    }
  })

  it('gives the one regular lane a rate bound', () => {
    // social: 18 of 30 days active, median 2 on an active day.
    expect(LANE_FLOORS.find(f => f.lane === 'social')?.kind).toBe('rate')
  })

  it('sets the social floor below its configured frequency', () => {
    // social_freq_* is 2 per platform. The floor catches a STOPPED lane, not a
    // slow one: at the configured rate it would breach on ordinary variance and
    // become the permanent-WARN class the manifest warns about.
    expect(LANE_FLOORS.find(f => f.lane === 'social')?.threshold).toBeLessThan(2)
  })
})
