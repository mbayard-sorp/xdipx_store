import { describe, expect, it, vi } from 'vitest'

// The module imports the drizzle client, whose module-level neon() call needs a
// DATABASE_URL. The pure logic is exercised directly; computeTicketLoopHealth
// is exercised through the db and GitHub mocks below.
const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

const githubConfiguredMock = vi.hoisted(() => vi.fn(() => false))
const getPullRequestMock = vi.hoisted(() => vi.fn())
const listOpenPullRequestsMock = vi.hoisted(() => vi.fn())
const listPullRequestFilesMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/github.server', () => ({
  isGithubConfigured: githubConfiguredMock,
  getPullRequest: getPullRequestMock,
  listOpenPullRequests: listOpenPullRequestsMock,
  listPullRequestFiles: listPullRequestFilesMock,
  // Shape-compatible stand-in for the real classifier (which has its own
  // tests): protected iff any filename mentions 'protected'.
  classifyChangedFiles: (files: Array<{ filename?: string }> | null | undefined) => ({
    protected: (files ?? []).some(f => String(f?.filename ?? '').includes('protected')),
  }),
}))

// The orphan reconcile must go THROUGH the fenced transition machinery, so the
// test asserts both the transition call and that it ran inside the
// runWithOutOfBandReconcile wrapper.
const transitionSuggestionMock = vi.hoisted(() => vi.fn(async () => ({})))
const reconcileScopeDepth = vi.hoisted(() => ({ current: 0, seenInside: [] as number[] }))
vi.mock('~/lib/team.server', () => ({
  transitionSuggestion: (...args: unknown[]) => {
    reconcileScopeDepth.seenInside.push(reconcileScopeDepth.current)
    return (transitionSuggestionMock as unknown as (...a: unknown[]) => unknown)(...args)
  },
  runWithOutOfBandReconcile: async (fn: () => Promise<unknown>) => {
    reconcileScopeDepth.current += 1
    try {
      return await fn()
    } finally {
      reconcileScopeDepth.current -= 1
    }
  },
}))

const sendOwnerEmailMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/owner-alerts.server', () => ({ sendOwnerEmail: sendOwnerEmailMock }))

const kvSetNXMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('~/lib/kv.server', () => ({ kvSetNX: kvSetNXMock }))

import {
  ALREADY_COVERED_STATUSES,
  CONFLICTED_PR_EXPLANATION,
  ELIGIBLE_BRANCH_PREFIXES,
  ROUTINE_CADENCES,
  SLA,
  TERMINAL_STATUSES,
  checkRoutineLiveness,
  classifyConflictedPrs,
  classifyOrphanReconcile,
  classifyOrphans,
  reconcileOrphanedTickets,
  RECONCILABLE_ORPHAN_STATUSES,
  classifySlaBreaches,
  classifySupersededApprovedCode,
  computeNetPerDay,
  computeTicketLoopHealth,
  describeSupersededEvidence,
  extractCitedPrNumbers,
  parsePrNumber,
  pickReplacementAdoptions,
  type ConflictCandidate,
  type JanitorTicketRow,
  type OrphanCandidate,
  type SupersededCandidate,
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

describe('pickReplacementAdoptions', () => {
  const pr = (number: number, headRef: string) => ({
    number,
    headRef,
    htmlUrl: `https://github.com/mbayard-sorp/xdipx_store/pull/${number}`,
  })

  it('adopts the open ticket/<id> PR when a closed link is replaced (the #844->#848 case)', () => {
    // Ticket 4878's autofiled link pointed at PR 844 (agents/ branch), now closed;
    // the work re-landed on branch ticket/4878 as PR 848.
    const picks = pickReplacementAdoptions(
      [{ suggestionId: 4878, closedNumber: 844 }],
      [pr(848, 'ticket/4878'), pr(999, 'ticket/1234')],
      new Map(),
    )
    expect(picks).toEqual([
      { suggestionId: 4878, number: 848, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/848' },
    ])
  })

  it('does not adopt when no open PR sits on the ticket branch', () => {
    expect(
      pickReplacementAdoptions([{ suggestionId: 4878, closedNumber: 844 }], [pr(848, 'ticket/9999')], new Map()),
    ).toEqual([])
  })

  it('never re-links a PR the ticket already links', () => {
    expect(
      pickReplacementAdoptions(
        [{ suggestionId: 4878, closedNumber: 844 }],
        [pr(848, 'ticket/4878')],
        new Map([[4878, new Set([848])]]),
      ),
    ).toEqual([])
  })

  it('skips a branch PR that is the same number as the closed link', () => {
    // Defensive: a link marked closed whose own PR is still the ticket-branch PR
    // must not be re-adopted as its own replacement.
    expect(
      pickReplacementAdoptions([{ suggestionId: 848, closedNumber: 848 }], [pr(848, 'ticket/848')], new Map()),
    ).toEqual([])
  })

  it('requires an exact branch match (ticket/48 does not satisfy ticket/4878)', () => {
    expect(
      pickReplacementAdoptions([{ suggestionId: 4878, closedNumber: 844 }], [pr(848, 'ticket/48')], new Map()),
    ).toEqual([])
  })

  it('dedupes within one pass and picks the first open PR per branch', () => {
    const picks = pickReplacementAdoptions(
      [
        { suggestionId: 4878, closedNumber: 844 },
        { suggestionId: 4878, closedNumber: 844 },
      ],
      [pr(848, 'ticket/4878'), pr(870, 'ticket/4878')],
      new Map(),
    )
    expect(picks).toEqual([
      { suggestionId: 4878, number: 848, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/848' },
    ])
  })
})

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
    // Identify each lane by team|runType and assert the expected SET, not a
    // hand-maintained `.length` integer (ticket #3033). Adding a routine then
    // appends one line to this list instead of bumping a shared count literal,
    // so sibling per-routine additions from the coverage-audit generator no
    // longer collide on this one line and can be authored as independent PRs.
    const keys = ROUTINE_CADENCES.map(c => `${c.team}|${c.runType}`)
    // No two lanes share an identity (guards the silent-drop-one merge hazard).
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([
      'ads|ads',
      'email|email',
      'homepage|design',
      'content|content',
      'content|manual',
      'content|seo-curation',
      'content|trend-scout',
      'homepage|merchandise',
      'product|enrich',
      'product|product',
      'social|research',
      'social|social',
      'social|social-trend-scout',
      'strategy|apply',
      'strategy|cost-review',
      'strategy|dev',
      'strategy|offsite',
      'strategy|qa',
      'strategy|strategy',
      'support|support',
      // Added 2026-09-02. Both were found by findUnwatchedLanes on its first
      // run: the triggers were created 2026-08-27 and had been producing runs,
      // and GPU spend, with nothing watching either of them.
      'video|writers-room',
      'video|video-render',
    ].sort())
    for (const c of ROUTINE_CADENCES) {
      expect(c.routine.length).toBeGreaterThan(0)
      expect(c.runType.length).toBeGreaterThan(0)
      expect(['four-times-daily', 'thrice-daily', 'twice-daily', 'daily', 'twice-weekly', 'weekly'])
        .toContain(c.kind)
      expect(c.maxGapHours).toBeGreaterThan(0)
      expect(c.schedule.length).toBeGreaterThan(0)
    }
    // Every lane names a team. The pricing sweep used to be the one exception
    // and was removed 2026-08-24: it has no team gate and has never written a
    // run row of any runType, so its entry could only ever false-flag.
    expect(ROUTINE_CADENCES.filter(c => c.team === null)).toEqual([])
    expect(ROUTINE_CADENCES.some(c => c.runType === 'pricing')).toBe(false)
    // R-DEV runs three passes, R-QA four (both since 2026-08-21).
    expect(ROUTINE_CADENCES.find(c => c.runType === 'dev')?.kind).toBe('thrice-daily')
    expect(ROUTINE_CADENCES.find(c => c.runType === 'qa')?.kind).toBe('four-times-daily')
    // R-ENRICH (routine 24) and the daily support review (routine 21) are
    // watched. Both were unwatched until 2026-08-24, which is why R-ENRICH
    // could fail outright two days running without anything noticing.
    const enrich = ROUTINE_CADENCES.find(c => c.runType === 'enrich')
    expect(enrich?.team).toBe('product')
    expect(enrich?.kind).toBe('daily')
    const support = ROUTINE_CADENCES.find(c => c.runType === 'support')
    expect(support?.team).toBe('support')
    expect(support?.kind).toBe('daily')
    // Routine 20 (Weekly social trend scout) has a liveness watch now that its
    // trigger is enabled: team social, runType matching what its playbook writes.
    const scout = ROUTINE_CADENCES.find(c => c.runType === 'social-trend-scout')
    expect(scout).toBeDefined()
    expect(scout?.team).toBe('social')
    expect(scout?.kind).toBe('weekly')
    expect(scout?.maxGapHours).toBe(194)
    // Ads Proposals (manifest row 4, Tue 13:00) has a liveness watch; team and
    // runType match the POST /api/team/run call in routine-ads-weekly.md.
    const ads = ROUTINE_CADENCES.find(c => c.runType === 'ads')
    expect(ads).toBeDefined()
    expect(ads?.team).toBe('ads')
    expect(ads?.kind).toBe('weekly')
    expect(ads?.maxGapHours).toBe(194)
    // Email Briefs (manifest row 5, Tue 15:00) has a liveness watch; team and
    // runType match the POST /api/team/run call in routine-email-weekly.md.
    const email = ROUTINE_CADENCES.find(c => c.runType === 'email')
    expect(email).toBeDefined()
    expect(email?.team).toBe('email')
    expect(email?.kind).toBe('weekly')
    expect(email?.maxGapHours).toBe(194)
    // Design Cycle / Routine B (manifest row 8, Wed 14:00) has a liveness
    // watch; team and runType match the POST /api/homepage-team/run call in
    // routine-design-cycle.md.
    const design = ROUTINE_CADENCES.find(c => c.runType === 'design')
    expect(design).toBeDefined()
    expect(design?.team).toBe('homepage')
    expect(design?.kind).toBe('weekly')
    expect(design?.maxGapHours).toBe(194)
  })

  it('sizes each gap against the lane\'s real cron, not its nominal kind', () => {
    const byType = new Map(ROUTINE_CADENCES.map(c => [`${c.team}|${c.runType}`, c]))
    // R-DEV fires 10:00, 15:00 and 20:00 UTC, so its longest interval is the
    // 14h overnight gap (20:00 to the next 10:00), not the 5h daytime ones.
    // Was 20 while the table still described a retired 14:00/20:00 pair, which
    // made a lost single pass invisible for most of a day.
    expect(byType.get('strategy|dev')?.maxGapHours).toBe(16)
    // R-QA fires 03:30, 11:30, 16:30 and 21:30; longest interval is 21:30 to
    // the next 03:30, 6h, plus the 2h daily grace.
    expect(byType.get('strategy|qa')?.maxGapHours).toBe(8)
    expect(byType.get('product|enrich')?.maxGapHours).toBe(26)
    expect(byType.get('support|support')?.maxGapHours).toBe(26)
    expect(byType.get('content|content')?.maxGapHours).toBe(26)
    expect(byType.get('strategy|strategy')?.maxGapHours).toBe(194)
    expect(byType.get('strategy|apply')?.maxGapHours).toBe(122)
  })
})

describe('checkRoutineLiveness', () => {
  it('flags a routine whose last run is past cadence plus grace, and not one inside it', () => {
    // dev is past its 16h bar, qa is inside its 8h one.
    const flags = checkRoutineLiveness([
      { team: 'strategy', runType: 'dev', startedAt: hoursAgo(21) },
      { team: 'strategy', runType: 'qa', startedAt: hoursAgo(4) },
    ], NOW, ROUTINE_CADENCES.filter(c => c.runType === 'dev' || c.runType === 'qa'))
    expect(flags.map(f => f.runType)).toEqual(['dev'])
    expect(flags[0]!.hoursSince).toBe(21)
  })

  it('does not flag R-DEV inside its 14h overnight gap, but does past it', () => {
    const devOnly = ROUTINE_CADENCES.filter(c => c.runType === 'dev')
    // 20:00 to the next 10:00 is 14h; with grace the bar is 16h.
    expect(checkRoutineLiveness(
      [{ team: 'strategy', runType: 'dev', startedAt: hoursAgo(14) }], NOW, devOnly)).toEqual([])
    // 18h of silence means a pass was actually missed. Under the retired
    // 14:00/20:00 table this was the expected overnight quiet and went
    // unflagged, which is how the lost 20:00 pass on 2026-08-24 stayed
    // invisible. Three passes a day makes 18h a real gap.
    expect(checkRoutineLiveness(
      [{ team: 'strategy', runType: 'dev', startedAt: hoursAgo(18) }], NOW, devOnly)).toHaveLength(1)
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

  it('matches a no-team lane on runType alone', () => {
    // No production cadence uses team:null today, but the matching rule is
    // still part of the contract, so it is exercised with a synthetic lane
    // rather than by keeping a permanently-false-flagging real one.
    const noTeam = [{
      routine: 'Synthetic no-team lane', team: null, runType: 'pricing',
      kind: 'daily' as const, schedule: '14:37 daily', maxGapHours: 26,
    }]
    expect(checkRoutineLiveness(
      [{ team: 'ops', runType: 'pricing', startedAt: hoursAgo(3) }], NOW, noTeam)).toEqual([])
    expect(checkRoutineLiveness(
      [{ team: 'ops', runType: 'pricing', startedAt: hoursAgo(30) }], NOW, noTeam)).toHaveLength(1)
  })

  it('flags R-ENRICH after a day of silence (the 2026-08-23/24 outage shape)', () => {
    // R-ENRICH failed before writing any run row on both days, so the runs
    // table showed its last row as 08-22. With no cadence entry nothing looked.
    const enrichOnly = ROUTINE_CADENCES.filter(c => c.runType === 'enrich')
    expect(enrichOnly).toHaveLength(1)
    expect(checkRoutineLiveness(
      [{ team: 'product', runType: 'enrich', startedAt: hoursAgo(30) }], NOW, enrichOnly)).toHaveLength(1)
    expect(checkRoutineLiveness(
      [{ team: 'product', runType: 'enrich', startedAt: hoursAgo(12) }], NOW, enrichOnly)).toEqual([])
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

describe('extractCitedPrNumbers', () => {
  it('reads a single "PR #N" citation', () => {
    expect(extractCitedPrNumbers('already shipped and merged in PR #654 (ticket #3196, applied)')).toEqual([654])
  })

  it('reads a "+"-joined list after the first PR mention (ticket #253 convention)', () => {
    expect(extractCitedPrNumbers('#88 by PR #324 + #349, and #77 by PR #319')).toEqual([319, 324, 349])
  })

  it('never picks up a bare "#N" that is not preceded by the word PR', () => {
    // The whole safety property: a ticket id mentioned in prose (#3196, #3204)
    // must not be mistaken for a cited fix PR.
    expect(extractCitedPrNumbers('duplicate of #3204 and #3260, tracked as ticket #3196')).toEqual([])
  })

  it('is case-insensitive and de-duplicates', () => {
    expect(extractCitedPrNumbers('prs #665, PR #665 again')).toEqual([665])
  })

  it('returns nothing when the text cites no PR', () => {
    expect(extractCitedPrNumbers('add a new feature, no prior art')).toEqual([])
  })
})

describe('classifySupersededApprovedCode', () => {
  const cand = (o: Partial<SupersededCandidate>): SupersededCandidate => ({
    ticketId: 1,
    suggestion: 'do the thing',
    dedupeMatch: null,
    citedPrs: [],
    ...o,
  })

  it('flags a ticket whose dedupe key matches an already-applied row', () => {
    const out = classifySupersededApprovedCode([
      cand({ ticketId: 3204, dedupeMatch: { ticketId: 3196, status: 'applied' } }),
    ])
    expect(out).toEqual([{
      ticketId: 3204,
      suggestion: 'do the thing',
      evidence: [{ kind: 'dedupe-key', matchedTicketId: 3196, matchedStatus: 'applied' }],
    }])
  })

  it('flags a ticket whose cited PR GitHub reports merged', () => {
    const out = classifySupersededApprovedCode([
      cand({ ticketId: 1704, citedPrs: [{ prNumber: 542, merged: true }] }),
    ])
    expect(out).toEqual([{
      ticketId: 1704,
      suggestion: 'do the thing',
      evidence: [{ kind: 'cited-pr-merged', prNumber: 542 }],
    }])
  })

  it('never flags a ticket whose cited PR is not merged, or unread', () => {
    // The safety property: an open, closed-unmerged, or unreadable cited PR is
    // never evidence.
    expect(classifySupersededApprovedCode([cand({ citedPrs: [{ prNumber: 700, merged: false }] })])).toEqual([])
    expect(classifySupersededApprovedCode([cand({ citedPrs: [{ prNumber: 701, merged: null }] })])).toEqual([])
  })

  it('never flags a ticket with no evidence at all', () => {
    expect(classifySupersededApprovedCode([cand({})])).toEqual([])
  })

  it('carries both evidence kinds when both apply', () => {
    const out = classifySupersededApprovedCode([
      cand({
        ticketId: 9,
        dedupeMatch: { ticketId: 8, status: 'pr_open' },
        citedPrs: [{ prNumber: 100, merged: true }],
      }),
    ])
    expect(out[0]!.evidence).toEqual([
      { kind: 'dedupe-key', matchedTicketId: 8, matchedStatus: 'pr_open' },
      { kind: 'cited-pr-merged', prNumber: 100 },
    ])
  })
})

describe('describeSupersededEvidence', () => {
  it('renders each evidence kind as one readable line', () => {
    expect(describeSupersededEvidence({ kind: 'dedupe-key', matchedTicketId: 5, matchedStatus: 'applied' }))
      .toBe('shares a dedupe key with #5 (applied)')
    expect(describeSupersededEvidence({ kind: 'cited-pr-merged', prNumber: 654 }))
      .toBe('cites PR #654, which GitHub reports merged')
  })
})

describe('ALREADY_COVERED_STATUSES', () => {
  it('names exactly the statuses meaning QA has it or it already shipped', () => {
    expect([...ALREADY_COVERED_STATUSES].sort()).toEqual(['applied', 'in_review', 'pr_open', 'verified'])
    // approved and blocked deliberately absent: neither means the work is
    // tracked or done, so neither is evidence a sibling row is superseded.
    expect(ALREADY_COVERED_STATUSES).not.toContain('approved')
    expect(ALREADY_COVERED_STATUSES).not.toContain('blocked')
  })
})

describe('computeTicketLoopHealth superseded-approved scan', () => {
  it('flags a cited-PR match end to end when GitHub confirms the PR merged', async () => {
    executeMock.mockReset()
    githubConfiguredMock.mockReturnValue(false) // orphan/conflict scans skip entirely, no execute calls
    getPullRequestMock.mockReset()
    listOpenPullRequestsMock.mockReset()

    executeMock
      .mockResolvedValueOnce({ rows: [] }) // gatherSlaRows
      .mockResolvedValueOnce({ rows: [] }) // gatherBacklog
      .mockResolvedValueOnce({ rows: [] }) // gatherRoutineFlags
      .mockResolvedValueOnce({
        rows: [{ id: 3204, suggestion: 'already shipped and merged in PR #654', dedupe_key: null }],
      }) // gatherSupersededApprovedCode: approved-code select (no dedupe_key, no second query)

    getPullRequestMock.mockResolvedValue({
      ok: true, status: 200, data: { number: 654, merged: true, state: 'closed' },
    })

    const health = await computeTicketLoopHealth()

    expect(health.supersededApproved).toEqual([{
      ticketId: 3204,
      suggestion: 'already shipped and merged in PR #654',
      evidence: [{ kind: 'cited-pr-merged', prNumber: 654 }],
    }])
  })

  it('does not flag a ticket whose cited PR GitHub reports as not merged', async () => {
    executeMock.mockReset()
    githubConfiguredMock.mockReturnValue(false)
    getPullRequestMock.mockReset()
    listOpenPullRequestsMock.mockReset()

    executeMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 99, suggestion: 'in progress, PR #700 not merged yet', dedupe_key: null }],
      })

    getPullRequestMock.mockResolvedValue({
      ok: true, status: 200, data: { number: 700, merged: false, state: 'open' },
    })

    const health = await computeTicketLoopHealth()

    expect(health.supersededApproved).toEqual([])
  })

  it('degrades to an empty list without throwing when the query fails', async () => {
    executeMock.mockReset()
    executeMock.mockRejectedValue(new Error('db down'))
    githubConfiguredMock.mockReturnValue(false)
    getPullRequestMock.mockReset()
    listOpenPullRequestsMock.mockReset()

    const health = await computeTicketLoopHealth()

    expect(health.supersededApproved).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Orphan reconcile (#3582)
// ---------------------------------------------------------------------------

describe('classifyOrphanReconcile', () => {
  const clean = { ok: true, protected: false }
  it('applies only a merged orphan in a reconcilable status with a clean file list', () => {
    for (const status of RECONCILABLE_ORPHAN_STATUSES) {
      expect(classifyOrphanReconcile({ status, prOutcome: 'merged' }, clean)).toBe('apply')
    }
  })

  it('never applies a closed-unmerged PR, whatever the status', () => {
    for (const status of [...RECONCILABLE_ORPHAN_STATUSES, 'proposed', 'in_progress']) {
      expect(classifyOrphanReconcile({ status, prOutcome: 'closed' }, clean)).toBe('skip-closed')
    }
  })

  it('skips statuses outside the fenced reconcile edges', () => {
    for (const status of ['proposed', 'in_progress', 'verified']) {
      expect(classifyOrphanReconcile({ status, prOutcome: 'merged' }, clean)).toBe('skip-status')
    }
  })

  it('skips protected-path PRs and unreadable file lists (unknown never classifies)', () => {
    expect(classifyOrphanReconcile({ status: 'approved', prOutcome: 'merged' },
      { ok: true, protected: true })).toBe('skip-protected')
    expect(classifyOrphanReconcile({ status: 'approved', prOutcome: 'merged' },
      { ok: false, protected: false })).toBe('skip-unknown')
  })
})

describe('reconcileOrphanedTickets', () => {
  function resetAll() {
    executeMock.mockReset()
    githubConfiguredMock.mockReset()
    getPullRequestMock.mockReset()
    listPullRequestFilesMock.mockReset()
    transitionSuggestionMock.mockReset()
    transitionSuggestionMock.mockResolvedValue({})
    reconcileScopeDepth.current = 0
    reconcileScopeDepth.seenInside = []
  }

  it('does nothing when GitHub is unconfigured', async () => {
    resetAll()
    githubConfiguredMock.mockReturnValue(false)
    const res = await reconcileOrphanedTickets()
    expect(res.skipped).toBe(true)
    expect(executeMock).not.toHaveBeenCalled()
    expect(transitionSuggestionMock).not.toHaveBeenCalled()
  })

  it('applies a merged-PR orphan through the fenced reconcile, and leaves a still-open PR alone', async () => {
    resetAll()
    githubConfiguredMock.mockReturnValue(true)
    // gatherOrphans candidate rows: one merged orphan, one still-open control.
    executeMock.mockResolvedValue({ rows: [
      { id: 1258, status: 'approved', ref: 'https://github.com/o/r/pull/671' },
      { id: 2000, status: 'pr_open', ref: 'https://github.com/o/r/pull/700' },
    ] })
    getPullRequestMock.mockImplementation(async (num: number) => ({
      ok: true, status: 200,
      data: num === 671
        ? { number: 671, merged: true, state: 'closed' }
        : { number: 700, merged: false, state: 'open' },
    }))
    listPullRequestFilesMock.mockResolvedValue({
      ok: true, status: 200, data: [{ filename: 'app/lib/ticket-janitor.server.ts' }],
    })

    const res = await reconcileOrphanedTickets()

    expect(res.applied).toEqual([1258])
    expect(res.errors).toEqual([])
    expect(transitionSuggestionMock).toHaveBeenCalledTimes(1)
    const [id, to, actor, opts] = transitionSuggestionMock.mock.calls[0] as unknown as [
      number, string, string, { links: Array<{ kind: string; ref: string; state: string }> },
    ]
    expect([id, to, actor]).toEqual([1258, 'applied', 'system'])
    expect(opts.links).toEqual([
      { kind: 'pr', ref: 'https://github.com/o/r/pull/671', state: 'merged' },
    ])
    // The transition ran inside runWithOutOfBandReconcile, not as a plain call.
    expect(reconcileScopeDepth.seenInside).toEqual([1])
  })

  it('skips a merged orphan whose PR touched a protected path', async () => {
    resetAll()
    githubConfiguredMock.mockReturnValue(true)
    executeMock.mockResolvedValue({ rows: [
      { id: 2071, status: 'blocked', ref: 'https://github.com/o/r/pull/800' },
    ] })
    getPullRequestMock.mockResolvedValue({
      ok: true, status: 200, data: { number: 800, merged: true, state: 'closed' },
    })
    listPullRequestFilesMock.mockResolvedValue({
      ok: true, status: 200, data: [{ filename: 'app/lib/protected-thing.server.ts' }],
    })

    const res = await reconcileOrphanedTickets()

    expect(res.applied).toEqual([])
    expect(res.skippedProtected).toEqual([2071])
    expect(transitionSuggestionMock).not.toHaveBeenCalled()
  })

  it('skips when the changed-file list cannot be read: unknown never classifies as safe', async () => {
    resetAll()
    githubConfiguredMock.mockReturnValue(true)
    executeMock.mockResolvedValue({ rows: [
      { id: 3, status: 'approved', ref: 'https://github.com/o/r/pull/801' },
    ] })
    getPullRequestMock.mockResolvedValue({
      ok: true, status: 200, data: { number: 801, merged: true, state: 'closed' },
    })
    listPullRequestFilesMock.mockResolvedValue({ ok: false, status: 500, error: 'boom' })

    const res = await reconcileOrphanedTickets()

    expect(res.applied).toEqual([])
    expect(transitionSuggestionMock).not.toHaveBeenCalled()
  })

  it('swallows the 409 race when something else moved the row first', async () => {
    resetAll()
    githubConfiguredMock.mockReturnValue(true)
    executeMock.mockResolvedValue({ rows: [
      { id: 4, status: 'in_review', ref: 'https://github.com/o/r/pull/802' },
    ] })
    getPullRequestMock.mockResolvedValue({
      ok: true, status: 200, data: { number: 802, merged: true, state: 'closed' },
    })
    listPullRequestFilesMock.mockResolvedValue({ ok: true, status: 200, data: [{ filename: 'docs/a.md' }] })
    transitionSuggestionMock.mockRejectedValue(new Error('409 Conflict: moved'))

    const res = await reconcileOrphanedTickets()

    expect(res.applied).toEqual([])
    expect(res.errors).toEqual([])
  })
})
