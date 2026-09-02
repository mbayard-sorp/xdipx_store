/**
 * Ticket #5431(b): an auto-expired team run must surface to log-monitor
 * instead of sitting as a silent `failed` row, and it must report the phase
 * it died in when one was recorded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `rows` are the expiries inside the window. `classCounts` is the fortnight
// recurrence tally the filter now consults; it defaults to "every class has
// recurred" so the pre-existing cases still exercise what they were written for.
const world = vi.hoisted(() => ({ rows: [] as any[], classCounts: null as any[] | null }))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const p: any = Promise.resolve(world.rows)
          // Only the recurrence query chains .groupBy; the window query awaits
          // the thenable directly.
          p.groupBy = () => Promise.resolve(
            world.classCounts
              ?? world.rows.map(r => ({ team: r.team, runType: r.runType, n: 3 })),
          )
          return p
        },
      }),
    }),
  },
}))

import { fetchExpiredRunGroups } from './log-monitor.server'

beforeEach(() => {
  world.rows = []
  world.classCounts = null
})

describe('fetchExpiredRunGroups', () => {
  it('reports the phase a run died in when one was recorded', async () => {
    world.rows = [{
      id: 501,
      team: 'social',
      runType: 'social',
      currentPhase: 'step-4-draft',
      currentAgent: 'social-media-manager',
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
      finishedAt: new Date('2026-08-25T11:00:00.000Z'),
      error: 'auto-expired: no recorded activity for 60 minutes',
    }]

    // now is 2h past finishedAt, well beyond the recovery grace.
    const now = new Date('2026-08-25T13:00:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.priority).toBe('P1')
    expect(groups[0]!.title).toContain('social run #501')
    expect(groups[0]!.title).toContain('step-4-draft')
    expect(groups[0]!.excerpt).toContain('phase=step-4-draft')
    expect(groups[0]!.excerpt).toContain('agent=social-media-manager')
    expect(groups[0]!.likelyCause).toContain('step-4-draft')
  })

  it('still reports an old run with no phase ever recorded, without throwing', async () => {
    world.rows = [{
      id: 140,
      team: 'social',
      runType: 'social',
      currentPhase: null,
      currentAgent: null,
      startedAt: new Date('2026-08-10T10:00:00.000Z'),
      finishedAt: new Date('2026-08-10T14:00:00.000Z'),
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    const now = new Date('2026-08-10T16:00:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toContain('phase: unknown')
    expect(groups[0]!.excerpt).toContain('phase=NULL')
    expect(groups[0]!.likelyCause).toMatch(/no phase ever recorded/)
  })

  it('returns an empty list when nothing expired in the window', async () => {
    world.rows = []
    const groups = await fetchExpiredRunGroups(15)
    expect(groups).toEqual([])
  })

  // #5632: a long, quiet-but-alive run (content run #517: podcast-reviewer)
  // tripped the 240-min idle reaper, was marked failed, then completed
  // successfully ~37 min later. log-monitor must not page a P1 for a run that
  // was auto-expired only moments ago -- give it a grace window to recover.
  it('suppresses a run auto-expired within the recovery grace window', async () => {
    world.rows = [{
      id: 517,
      team: 'content',
      runType: 'manual',
      currentPhase: 'run-start',
      currentAgent: null,
      startedAt: new Date('2026-08-26T10:14:34.000Z'),
      finishedAt: new Date('2026-08-26T14:14:00.000Z'),
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    // Only 6 min after the auto-expiry -- inside the grace window.
    const now = new Date('2026-08-26T14:20:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toEqual([])
  })

  // Ticket #6760: verified against 6 real blocked tickets that the earlier
  // per-run-id title hash produced 6 separate rows for 6 DIFFERENT teams'
  // runs (video #507, content #569, social #595, strategy #603, homepage
  // #599) rather than repeat occurrences of one incident -- so the fix here
  // is a STABLE key per (team, runType), not a dismissal of those rows (each
  // is a genuinely distinct incident). This locks in that two different runs
  // of the SAME (team, runType) collapse onto one dedupeKey, while a
  // different runType (or team) gets its own.
  it('gives two different runs of the same (team, runType) the same dedupeKey', async () => {
    world.rows = [
      {
        id: 603, team: 'strategy', runType: 'strategy', currentPhase: 'run-start', currentAgent: null,
        startedAt: new Date('2026-08-24T10:00:00.000Z'), finishedAt: new Date('2026-08-24T14:00:00.000Z'),
        error: 'auto-expired: no recorded activity for 120 minutes',
      },
      {
        id: 700, team: 'strategy', runType: 'strategy', currentPhase: 'run-start', currentAgent: null,
        startedAt: new Date('2026-08-31T10:00:00.000Z'), finishedAt: new Date('2026-08-31T14:00:00.000Z'),
        error: 'auto-expired: no recorded activity for 120 minutes',
      },
    ]
    const now = new Date('2026-08-31T16:00:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(2)
    expect(groups[0]!.title).not.toBe(groups[1]!.title) // titles still differ (embed the run id)
    expect(groups[0]!.dedupeKey).toBeDefined()
    expect(groups[0]!.dedupeKey).toBe(groups[1]!.dedupeKey) // but the dedupe identity is stable
  })

  it('gives a different (team, runType) pair a different dedupeKey', async () => {
    world.rows = [
      {
        id: 507, team: 'video', runType: 'video', currentPhase: 'run-start', currentAgent: null,
        startedAt: new Date('2026-08-24T10:00:00.000Z'), finishedAt: new Date('2026-08-24T14:00:00.000Z'),
        error: 'auto-expired: no recorded activity for 240 minutes',
      },
      {
        id: 603, team: 'strategy', runType: 'strategy', currentPhase: 'run-start', currentAgent: null,
        startedAt: new Date('2026-08-31T10:00:00.000Z'), finishedAt: new Date('2026-08-31T14:00:00.000Z'),
        error: 'auto-expired: no recorded activity for 120 minutes',
      },
    ]
    const now = new Date('2026-08-31T16:00:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(2)
    expect(groups[0]!.dedupeKey).not.toBe(groups[1]!.dedupeKey)
  })

  it('surfaces a run once it has stayed auto-expired past the grace window', async () => {
    world.rows = [{
      id: 517,
      team: 'content',
      runType: 'manual',
      currentPhase: 'run-start',
      currentAgent: null,
      startedAt: new Date('2026-08-26T10:14:34.000Z'),
      finishedAt: new Date('2026-08-26T14:14:00.000Z'),
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    // 66 min after the auto-expiry -- past the 60-min grace, still failed.
    const now = new Date('2026-08-26T15:20:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toContain('content run #517')
  })
})

/**
 * One auto-expiry is an event, not a defect, and it belongs to the lane whose
 * run died. Filing on the first occurrence, at the storefront default team,
 * produced eight P1 rows in nine days — #5475, #5954, #6262, #6553, #6706,
 * #6707, and #6936/#6950 filed while this was being written — for runs
 * belonging to video, strategy, content and social. Six went `blocked`; two
 * are still sitting `approved` at the wrong desk.
 */
describe('fetchExpiredRunGroups: recurrence and routing', () => {
  const expiry = (over: Record<string, unknown> = {}) => ({
    id: 601,
    team: 'video',
    runType: 'video-render',
    currentPhase: 'run-start',
    currentAgent: null,
    startedAt: new Date('2026-08-25T10:00:00.000Z'),
    finishedAt: new Date('2026-08-25T11:00:00.000Z'),
    error: 'auto-expired: no recorded activity for 60 minutes',
    ...over,
  })
  const now = new Date('2026-08-25T13:00:00.000Z').getTime()

  it('stays silent on a first, one-off expiry', async () => {
    world.rows = [expiry()]
    world.classCounts = [{ team: 'video', runType: 'video-render', n: 1 }]

    expect(await fetchExpiredRunGroups(15, now)).toEqual([])
  })

  it('stays silent below the recurrence threshold', async () => {
    world.rows = [expiry()]
    world.classCounts = [{ team: 'video', runType: 'video-render', n: 2 }]

    expect(await fetchExpiredRunGroups(15, now)).toEqual([])
  })

  it('files once the same (team, runType) class has expired three times', async () => {
    world.rows = [expiry()]
    world.classCounts = [{ team: 'video', runType: 'video-render', n: 3 }]

    const groups = await fetchExpiredRunGroups(15, now)
    expect(groups).toHaveLength(1)
  })

  it('routes to the team whose run died, not the storefront default', async () => {
    world.rows = [expiry({ team: 'social', runType: 'social' })]
    world.classCounts = [{ team: 'social', runType: 'social', n: 3 }]

    const groups = await fetchExpiredRunGroups(15, now)
    expect(groups[0]!.targetTeam).toBe('social')
  })

  it('files as process, which the detector can close, not as an owner-only code row', async () => {
    world.rows = [expiry()]
    world.classCounts = [{ team: 'video', runType: 'video-render', n: 3 }]

    const groups = await fetchExpiredRunGroups(15, now)
    // `code` has no agent-reachable close edge; `process` is in
    // DETECTOR_SELF_CLOSE_KINDS, so the detector that raised it can close it.
    expect(groups[0]!.kind).toBe('process')
  })

  it('leaves targetTeam unset for a team value that is not a real team id', async () => {
    // `homepage_team_runs.team` is a free varchar. A legacy or typo'd value
    // must fall back to the default rather than route at a team that cannot exist.
    world.rows = [expiry({ team: 'not-a-team' })]
    world.classCounts = [{ team: 'not-a-team', runType: 'video-render', n: 5 }]

    const groups = await fetchExpiredRunGroups(15, now)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.targetTeam).toBeUndefined()
  })

  it('counts each class independently', async () => {
    world.rows = [
      expiry({ id: 1, team: 'video', runType: 'video-render' }),
      expiry({ id: 2, team: 'social', runType: 'social' }),
    ]
    world.classCounts = [
      { team: 'video', runType: 'video-render', n: 3 },
      { team: 'social', runType: 'social', n: 1 },
    ]

    const groups = await fetchExpiredRunGroups(15, now)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.targetTeam).toBe('video')
  })
})
