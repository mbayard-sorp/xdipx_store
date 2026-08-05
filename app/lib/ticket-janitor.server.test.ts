import { describe, expect, it, vi } from 'vitest'

// The module imports the drizzle client, whose module-level neon() call needs a
// DATABASE_URL. The IO entry points are not exercised here; the pure logic is.
const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

import {
  ROUTINE_CADENCES,
  SLA,
  TERMINAL_STATUSES,
  checkRoutineLiveness,
  classifyOrphans,
  classifySlaBreaches,
  computeNetPerDay,
  parsePrNumber,
  type JanitorTicketRow,
  type OrphanCandidate,
} from '~/lib/ticket-janitor.server'

const NOW = new Date('2026-08-05T18:00:00Z')

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 3_600_000)
}

function row(overrides: Partial<JanitorTicketRow>): JanitorTicketRow {
  return {
    id: 1,
    status: 'approved',
    kind: 'code',
    priority: 3,
    suggestion: 'do the thing',
    lastError: null,
    noteRef: null,
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
    ...overrides,
  }
}

describe('classifySlaBreaches', () => {
  it('flags pr_open only past 24h, measured on updatedAt', () => {
    const out = classifySlaBreaches([
      row({ id: 10, status: 'pr_open', updatedAt: hoursAgo(23) }),
      row({ id: 11, status: 'pr_open', updatedAt: hoursAgo(25) }),
    ], NOW)
    expect(out.prOpen.map(r => r.id)).toEqual([11])
    expect(out.prOpen[0]!.ageHours).toBe(25)
  })

  it('flags in_review past 12h', () => {
    const out = classifySlaBreaches([
      row({ id: 20, status: 'in_review', updatedAt: hoursAgo(11) }),
      row({ id: 21, status: 'in_review', updatedAt: hoursAgo(13) }),
    ], NOW)
    expect(out.inReview.map(r => r.id)).toEqual([21])
  })

  it('flags approved code past 7 days on createdAt, with count and oldest, and ignores non-code kinds', () => {
    const out = classifySlaBreaches([
      row({ id: 30, status: 'approved', kind: 'code', createdAt: hoursAgo(6 * 24) }),
      row({ id: 31, status: 'approved', kind: 'code', createdAt: hoursAgo(8 * 24) }),
      row({ id: 32, status: 'approved', kind: 'code', createdAt: hoursAgo(21 * 24) }),
      row({ id: 33, status: 'approved', kind: 'process', createdAt: hoursAgo(30 * 24) }),
    ], NOW)
    expect(out.approvedCode.count).toBe(2)
    expect(out.approvedCode.oldest?.id).toBe(32)
    expect(out.approvedCode.rows.map(r => r.id)).toEqual([32, 31])
  })

  it('flags proposed past 72h', () => {
    const out = classifySlaBreaches([
      row({ id: 40, status: 'proposed', createdAt: hoursAgo(71) }),
      row({ id: 41, status: 'proposed', createdAt: hoursAgo(73) }),
    ], NOW)
    expect(out.proposed.map(r => r.id)).toEqual([41])
  })

  it('lists every blocked row regardless of age and flags empty reasons', () => {
    const out = classifySlaBreaches([
      row({ id: 50, status: 'blocked', lastError: null, noteRef: null, updatedAt: hoursAgo(1) }),
      row({ id: 51, status: 'blocked', lastError: '   ', noteRef: null }),
      row({ id: 52, status: 'blocked', lastError: 'needs a schema change', noteRef: null }),
      row({ id: 53, status: 'blocked', lastError: null, noteRef: 'superseded by PR #429' }),
    ], NOW)
    expect(out.blocked).toHaveLength(4)
    const byId = new Map(out.blocked.map(b => [b.id, b.emptyReason]))
    expect(byId.get(50)).toBe(true)
    expect(byId.get(51)).toBe(true)
    expect(byId.get(52)).toBe(false)
    expect(byId.get(53)).toBe(false)
  })

  it('exports the thresholds the docs quote', () => {
    expect(SLA).toEqual({ prOpenHours: 24, inReviewHours: 12, approvedCodeDays: 7, proposedHours: 72 })
  })
})

describe('classifyOrphans', () => {
  const cand = (o: Partial<OrphanCandidate>): OrphanCandidate => ({
    ticketId: 120,
    status: 'approved',
    prRef: 'https://github.com/o/r/pull/436',
    pr: { merged: true, state: 'closed' },
    ...o,
  })

  it('classifies a live ticket with a merged PR as orphaned', () => {
    const out = classifyOrphans([cand({})])
    expect(out).toEqual([
      { ticketId: 120, status: 'approved', prRef: 'https://github.com/o/r/pull/436', prOutcome: 'merged' },
    ])
  })

  it('classifies a closed-unmerged PR as orphaned with outcome closed', () => {
    const out = classifyOrphans([cand({ ticketId: 7, pr: { merged: false, state: 'closed' } })])
    expect(out[0]).toMatchObject({ ticketId: 7, prOutcome: 'closed' })
  })

  it('never classifies terminal tickets, open PRs, or unreadable PRs', () => {
    expect(classifyOrphans([cand({ status: 'applied' })])).toEqual([])
    expect(classifyOrphans([cand({ status: 'dismissed' })])).toEqual([])
    expect(classifyOrphans([cand({ pr: { merged: false, state: 'open' } })])).toEqual([])
    expect(classifyOrphans([cand({ pr: null })])).toEqual([])
    expect(TERMINAL_STATUSES).toEqual(['applied', 'dismissed'])
  })
})

describe('parsePrNumber', () => {
  it('reads the number from a PR URL and rejects non-PR refs', () => {
    expect(parsePrNumber('https://github.com/o/r/pull/436')).toBe(436)
    expect(parsePrNumber('https://github.com/o/r/pull/436/files')).toBe(436)
    expect(parsePrNumber('https://api.github.com/repos/o/r/pulls/12')).toBe(12)
    expect(parsePrNumber('https://github.com/o/r/issues/9')).toBeNull()
    expect(parsePrNumber('not a url')).toBeNull()
  })
})

describe('ROUTINE_CADENCES', () => {
  it('carries every expected lane with a complete shape', () => {
    expect(ROUTINE_CADENCES.length).toBe(15)
    for (const c of ROUTINE_CADENCES) {
      expect(c.routine.length).toBeGreaterThan(0)
      expect(c.runType.length).toBeGreaterThan(0)
      expect(['twice-daily', 'daily', 'twice-weekly', 'weekly']).toContain(c.kind)
      expect(c.maxGapHours).toBeGreaterThan(0)
      expect(c.schedule.length).toBeGreaterThan(0)
    }
    // The one no-team lane is the pricing sweep; everything else has a team.
    expect(ROUTINE_CADENCES.filter(c => c.team === null).map(c => c.runType)).toEqual(['pricing'])
    // The two twice-daily lanes are dev and qa.
    expect(ROUTINE_CADENCES.filter(c => c.kind === 'twice-daily').map(c => c.runType).sort()).toEqual(['dev', 'qa'])
  })

  it('sizes grace at 2h for dailies and 26h for weeklies', () => {
    const byType = new Map(ROUTINE_CADENCES.map(c => [`${c.team}|${c.runType}`, c]))
    expect(byType.get('strategy|dev')?.maxGapHours).toBe(14)
    expect(byType.get('content|content')?.maxGapHours).toBe(26)
    expect(byType.get('strategy|strategy')?.maxGapHours).toBe(194)
    expect(byType.get('strategy|apply')?.maxGapHours).toBe(122)
  })
})

describe('checkRoutineLiveness', () => {
  it('flags a routine whose last run is past cadence plus grace, and not one inside it', () => {
    const flags = checkRoutineLiveness([
      { team: 'strategy', runType: 'dev', startedAt: hoursAgo(15) },
      { team: 'strategy', runType: 'qa', startedAt: hoursAgo(13) },
    ], NOW, ROUTINE_CADENCES.filter(c => c.kind === 'twice-daily'))
    expect(flags.map(f => f.runType)).toEqual(['dev'])
    expect(flags[0]!.hoursSince).toBe(15)
  })

  it('flags a routine with no run row at all as never-run', () => {
    const flags = checkRoutineLiveness([], NOW, ROUTINE_CADENCES.filter(c => c.runType === 'research'))
    expect(flags).toHaveLength(1)
    expect(flags[0]!.lastRunAt).toBeNull()
    expect(flags[0]!.hoursSince).toBeNull()
  })

  it('matches the no-team pricing lane on runType alone', () => {
    const pricingOnly = ROUTINE_CADENCES.filter(c => c.runType === 'pricing')
    const alive = checkRoutineLiveness(
      [{ team: 'ops', runType: 'pricing', startedAt: hoursAgo(3) }], NOW, pricingOnly)
    expect(alive).toEqual([])
    const dead = checkRoutineLiveness(
      [{ team: 'ops', runType: 'pricing', startedAt: hoursAgo(30) }], NOW, pricingOnly)
    expect(dead).toHaveLength(1)
  })

  it('uses the newest run row when several exist', () => {
    const devOnly = ROUTINE_CADENCES.filter(c => c.runType === 'dev')
    const flags = checkRoutineLiveness([
      { team: 'strategy', runType: 'dev', startedAt: hoursAgo(40) },
      { team: 'strategy', runType: 'dev', startedAt: hoursAgo(2) },
    ], NOW, devOnly)
    expect(flags).toEqual([])
  })
})

describe('computeNetPerDay', () => {
  it('computes the signed daily net to one decimal', () => {
    expect(computeNetPerDay(56, 14)).toBe(6)
    expect(computeNetPerDay(10, 24)).toBe(-2)
    expect(computeNetPerDay(1, 0)).toBe(0.1)
    expect(computeNetPerDay(5, 5)).toBe(0)
  })
})
