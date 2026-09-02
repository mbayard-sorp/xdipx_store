import { describe, expect, it } from 'vitest'

import {
  LANE_COVERAGE_EXEMPT,
  ROUTINE_CADENCES,
  findUnwatchedLanes,
} from '~/lib/ticket-janitor.server'

const lane = (team: string, runType: string, runs = 1) => ({
  team, runType, runs, lastRunAt: '2026-09-02T12:00:00.000Z',
})

describe('finding lanes nothing watches', () => {
  it('reports a lane that runs with no cadence entry', () => {
    // The failure this exists for. A routine created after ROUTINE_CADENCES was
    // last curated is not late, it is absent, and absence from a hand-kept list
    // looks exactly like health. It has now happened twice: R-ENRICH in August,
    // and the whole video program by 2026-09-02.
    expect(findUnwatchedLanes([lane('video', 'brand-new-lane', 4)])).toEqual([
      { team: 'video', runType: 'brand-new-lane', runs: 4, lastRunAt: '2026-09-02T12:00:00.000Z' },
    ])
  })

  it('says nothing about a lane that has a cadence entry', () => {
    expect(findUnwatchedLanes([lane('strategy', 'dev', 101)])).toEqual([])
  })

  it('says nothing about a lane that is exempt on the record', () => {
    // Exemption is by name with a written reason, never by pattern: the
    // alternative to writing the reason down is the lane quietly rejoining the
    // unwatched set with nobody able to say whether that was intended.
    expect(findUnwatchedLanes([lane('video', 'video', 3)])).toEqual([])
  })

  it('honours a cadence entry with a null team as covering every team', () => {
    const cadences = [{ routine: 'anything', team: null, runType: 'manual', kind: 'weekly' as const, schedule: 'x', maxGapHours: 1 }]
    expect(findUnwatchedLanes([lane('content', 'manual')], cadences, [])).toEqual([])
  })

  it('puts the busiest unwatched lane first', () => {
    const out = findUnwatchedLanes([lane('a', 'x', 2), lane('b', 'y', 40), lane('c', 'z', 9)])
    expect(out.map(o => o.runType)).toEqual(['y', 'z', 'x'])
  })

  it('makes every exemption say why', () => {
    for (const e of LANE_COVERAGE_EXEMPT) {
      expect(e.why.length, `${e.team}/${e.runType} is exempt for no stated reason`).toBeGreaterThan(30)
    }
  })
})

describe('the cadence list itself', () => {
  it('watches the video program, which cost real GPU money unwatched for six days', () => {
    const keys = new Set(ROUTINE_CADENCES.map(c => `${c.team}|${c.runType}`))
    expect(keys.has('video|writers-room')).toBe(true)
    expect(keys.has('video|video-render')).toBe(true)
  })

  it('has no duplicate team/runType pairs, which would double-flag one lane', () => {
    const keys = ROUTINE_CADENCES.map(c => `${c.team}|${c.runType}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never both watches and exempts the same lane', () => {
    // Doing both is not redundancy, it is two people disagreeing in code about
    // whether a lane is supposed to exist.
    const watched = new Set(ROUTINE_CADENCES.map(c => `${c.team}|${c.runType}`))
    for (const e of LANE_COVERAGE_EXEMPT) {
      expect(watched.has(`${e.team}|${e.runType}`), `${e.team}/${e.runType} is both watched and exempt`).toBe(false)
    }
  })
})
