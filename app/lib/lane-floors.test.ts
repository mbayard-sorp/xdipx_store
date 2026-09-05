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
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { LANE_FLOORS } from '~/lib/lane-floors.server'

// Used only by the socialGateOpen regression suite below, hoisted to the top
// level per vitest's own mocking contract (a vi.mock/vi.hoisted call nested
// inside a describe block still runs first, but vitest warns and says this
// will become an error).
const executeMock = vi.hoisted(() => vi.fn())
const getPipelineSettingMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: getPipelineSettingMock }))

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

describe('the social gate reads only the per-platform valves (#7608 QA bounce)', () => {
  // docs/store-team/routine-social-daily.md: "social_team_autopost /
  // autopostValve gates nothing on the publish path ... must never be used to
  // decide posture, only platformValves.instagram and platformValves.x." Ticket
  // #5413 (run 500, 2026-08-25) is the incident that documented exactly this
  // wrong read. ANDing the legacy team valve into socialGateOpen() would report
  // the social lane closed whenever `social_team_autopost` happens to be false,
  // even while a real platform valve is genuinely on -- the same
  // check-that-cannot-fail shape the lane floors exist to catch, just arriving
  // through the gate read instead of the threshold.
  beforeEach(() => {
    executeMock.mockReset()
    getPipelineSettingMock.mockReset()
    // indexnow / outreach staleness queries: report "never seen", which is a
    // harmless breached:null for both and keeps this test's focus on social.
    executeMock.mockResolvedValue({ rows: [{ days: null }] })
  })

  it('treats the lane as open on a real platform valve alone, with the legacy team valve OFF', async () => {
    getPipelineSettingMock.mockImplementation(async (key: string) => {
      if (key === 'social_team_autopost') return 'false'
      if (key === 'instagram_autopublish_enabled') return 'true'
      if (key === 'x_autopublish_enabled') return 'false'
      return null
    })
    // The social count query specifically; every other db.execute call in this
    // run is a days-since lookup already stubbed to { days: null } above.
    const dialect = new PgDialect()
    executeMock.mockImplementation(async (query: unknown) => {
      const { sql: text } = dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0])
      if (text.includes('social_posts')) return { rows: [{ n: 2 }] }
      return { rows: [{ days: null }] }
    })

    const { checkLaneFloors } = await import('~/lib/lane-floors.server')
    const verdicts = await checkLaneFloors()
    const social = verdicts.find(v => v.lane === 'social')!

    expect(social.measured).toBe(2)
    expect(social.breached).toBe(false)
    expect(social.detail).not.toContain('gates closed')
  })

  it('treats the lane as closed when every real platform valve is off, team valve notwithstanding', async () => {
    getPipelineSettingMock.mockImplementation(async (key: string) => {
      if (key === 'social_team_autopost') return 'true'
      if (key === 'instagram_autopublish_enabled') return 'false'
      if (key === 'x_autopublish_enabled') return 'false'
      return null
    })

    const { checkLaneFloors } = await import('~/lib/lane-floors.server')
    const verdicts = await checkLaneFloors()
    const social = verdicts.find(v => v.lane === 'social')!

    expect(social.measured).toBeNull()
    expect(social.breached).toBeNull()
    expect(social.detail).toContain('gates closed')
  })
})
