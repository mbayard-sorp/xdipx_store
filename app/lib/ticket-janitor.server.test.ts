import { describe, expect, it, vi } from 'vitest'

// The module imports the drizzle client, whose module-level neon() call needs a
// DATABASE_URL. The pure logic is exercised directly; computeTicketLoopHealth
// is exercised through the db and GitHub mocks below.
const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

const githubConfiguredMock = vi.hoisted(() => vi.fn(() => false))
const getPullRequestMock = vi.hoisted(() => vi.fn())
const listOpenPullRequestsMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/github.server', () => ({
  isGithubConfigured: githubConfiguredMock,
  getPullRequest: getPullRequestMock,
  listOpenPullRequests: listOpenPullRequestsMock,
}))

import {
  CONFLICTED_PR_EXPLANATION,
  ELIGIBLE_BRANCH_PREFIXES,
  ROUTINE_CADENCES,
  SLA,
  TERMINAL_STATUSES,
  checkRoutineLiveness,
  classifyConflictedPrs,
  classifyOrphans,
  classifySlaBreaches,
  computeNetPerDay,
  computeTicketLoopHealth,
  parsePrNumber,
  type ConflictCandidate,
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
    // The note text must survive to the row so a renderer can show it; a
    // note-only block (#53) is exactly the common R-DEV case.
    expect(out.blocked.find(b => b.id === 53)?.noteRef).toBe('superseded by PR #429')
    expect(out.blocked.find(b => b.id === 52)?.lastError).toBe('needs a schema change')
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

describe('classifyConflictedPrs', () => {
  const candidate = (over: Partial<ConflictCandidate> = {}): ConflictCandidate => ({
    number: 494,
    title: 'fix the rail',
    branch: 'ticket/494',
    mergeable: false,
    mergeableState: 'dirty',
    ...over,
  })

  it('flags a dirty PR with the fixed explanation and passes clean ones', () => {
    const out = classifyConflictedPrs([
      candidate(),
      candidate({ number: 500, branch: 'fix/nav', mergeable: true, mergeableState: 'clean' }),
    ])
    expect(out).toEqual([{
      number: 494,
      title: 'fix the rail',
      branch: 'ticket/494',
      explanation: CONFLICTED_PR_EXPLANATION,
    }])
    // The explanation is the point: zero workflow runs is documented GitHub
    // behavior, and without the sentence the next incident gets re-investigated.
    expect(CONFLICTED_PR_EXPLANATION).toContain('CI cannot run')
    expect(CONFLICTED_PR_EXPLANATION).toContain('zero pull_request workflow runs')
    expect(CONFLICTED_PR_EXPLANATION).toContain('origin/main')
  })

  it('never classifies an unknown mergeability as conflicted', () => {
    // GitHub computes mergeability lazily; unknown must never read as broken.
    const out = classifyConflictedPrs([candidate({ mergeable: null, mergeableState: 'unknown' })])
    expect(out).toEqual([])
  })

  it('covers every engine-eligible branch prefix, revert lane included', () => {
    expect(ELIGIBLE_BRANCH_PREFIXES).toEqual(
      ['agents/', 'ticket/', 'claude/', 'phase1/', 'tonight/', 'fix/', 'pm/', 'revert/pr-'])
  })
})

describe('computeTicketLoopHealth conflicted-PR scan', () => {
  it('leaves conflictedPrs empty without throwing when GitHub is unconfigured', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })
    githubConfiguredMock.mockReturnValue(false)
    getPullRequestMock.mockReset()
    listOpenPullRequestsMock.mockReset()

    const health = await computeTicketLoopHealth()

    expect(health.conflictedPrs).toEqual([])
    expect(health.orphanScanSkipped).toBe(true)
    expect(listOpenPullRequestsMock).not.toHaveBeenCalled()
    expect(getPullRequestMock).not.toHaveBeenCalled()
  })

  it('reads mergeable state per open eligible PR and reports the dirty ones', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })
    githubConfiguredMock.mockReturnValue(true)
    getPullRequestMock.mockReset()
    listOpenPullRequestsMock.mockReset()
    listOpenPullRequestsMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ number: 494, title: 'fix the rail', headRef: 'ticket/494' }],
    })
    // The list endpoint omits mergeable_state, so the scan must do the
    // individual read to see the conflict.
    getPullRequestMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        number: 494, title: 'fix the rail', headRef: 'ticket/494', state: 'open',
        merged: false, mergeable: false, mergeableState: 'dirty',
      },
    })

    const health = await computeTicketLoopHealth()

    expect(health.conflictedPrs).toEqual([{
      number: 494,
      title: 'fix the rail',
      branch: 'ticket/494',
      explanation: CONFLICTED_PR_EXPLANATION,
    }])
    expect(getPullRequestMock).toHaveBeenCalledTimes(1)
  })
})

describe('ROUTINE_CADENCES', () => {
  it('carries every expected lane with a complete shape', () => {
    expect(ROUTINE_CADENCES.length).toBe(17)
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
    // Routine 20 (Weekly social trend scout) has a liveness watch now that its
    // trigger is enabled: team social, runType matching what its playbook writes.
    const scout = ROUTINE_CADENCES.find(c => c.runType === 'social-trend-scout')
    expect(scout).toBeDefined()
    expect(scout?.team).toBe('social')
    expect(scout?.kind).toBe('weekly')
    expect(scout?.maxGapHours).toBe(194)

    // R-BLOCK: the daily blocker scout. Added with the owner blocker list so
    // the routine that watches for blockers is itself watched, which the
    // coverage audit would otherwise flag as a lane with no liveness entry.
    const blocker = ROUTINE_CADENCES.find(c => c.runType === 'blocker-scout')
    expect(blocker).toBeDefined()
    expect(blocker?.team).toBe('strategy')
    expect(blocker?.kind).toBe('daily')
  })

  it('sizes each gap against the lane\'s real cron, not its nominal kind', () => {
    const byType = new Map(ROUTINE_CADENCES.map(c => [`${c.team}|${c.runType}`, c]))
    // R-DEV fires 14:00 and 20:00 UTC, so its longest interval is the 18h
    // overnight gap, not the 12h a symmetric twice-daily would have. The 13:00
    // digest runs 17h after the 20:00 pass; a 14h gap would flag it daily.
    expect(byType.get('strategy|dev')?.maxGapHours).toBe(20)
    // R-QA's passes (03:30 and 15:30) are symmetric, so 12h plus 2h grace holds.
    expect(byType.get('strategy|qa')?.maxGapHours).toBe(14)
    expect(byType.get('content|content')?.maxGapHours).toBe(26)
    expect(byType.get('strategy|strategy')?.maxGapHours).toBe(194)
    expect(byType.get('strategy|apply')?.maxGapHours).toBe(122)
  })
})

describe('checkRoutineLiveness', () => {
  it('flags a routine whose last run is past cadence plus grace, and not one inside it', () => {
    const flags = checkRoutineLiveness([
      { team: 'strategy', runType: 'dev', startedAt: hoursAgo(21) },
      { team: 'strategy', runType: 'qa', startedAt: hoursAgo(13) },
    ], NOW, ROUTINE_CADENCES.filter(c => c.kind === 'twice-daily'))
    expect(flags.map(f => f.runType)).toEqual(['dev'])
    expect(flags[0]!.hoursSince).toBe(21)
  })

  it('does not flag R-DEV across its 18h overnight gap (20:00 to the next 14:00)', () => {
    const flags = checkRoutineLiveness([
      { team: 'strategy', runType: 'dev', startedAt: hoursAgo(18) },
    ], NOW, ROUTINE_CADENCES.filter(c => c.runType === 'dev'))
    expect(flags).toEqual([])
  })

  it('flags a routine with no run row at all as never-run', () => {
    const flags = checkRoutineLiveness([], NOW, ROUTINE_CADENCES.filter(c => c.runType === 'research'))
    expect(flags).toHaveLength(1)
    expect(flags[0]!.lastRunAt).toBeNull()
    expect(flags[0]!.hoursSince).toBeNull()
  })

  it('flags the social trend scout when its last run is stale, and not when fresh', () => {
    const scoutOnly = ROUTINE_CADENCES.filter(c => c.runType === 'social-trend-scout')
    const stale = checkRoutineLiveness(
      [{ team: 'social', runType: 'social-trend-scout', startedAt: hoursAgo(200) }], NOW, scoutOnly)
    expect(stale).toHaveLength(1)
    expect(stale[0]!.runType).toBe('social-trend-scout')
    const fresh = checkRoutineLiveness(
      [{ team: 'social', runType: 'social-trend-scout', startedAt: hoursAgo(24) }], NOW, scoutOnly)
    expect(fresh).toEqual([])
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
