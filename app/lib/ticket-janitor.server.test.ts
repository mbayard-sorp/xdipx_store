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
  BLOCKED_DIGEST_KV_PREFIX,
  CONFLICTED_PR_EXPLANATION,
  ELIGIBLE_BRANCH_PREFIXES,
  REASON_UNKNOWN,
  ROUTINE_CADENCES,
  SLA,
  TERMINAL_STATUSES,
  buildBlockedDigest,
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
  deriveUnblockQuestion,
  describeSupersededEvidence,
  extractCitedPrNumbers,
  parsePrNumber,
  renderBlockedDigestEmail,
  runBlockedTicketDigest,
  weekBucketKey,
  type BlockedTicket,
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
      'null|pricing',
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
    ].sort())
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

describe('deriveUnblockQuestion', () => {
  const blk = (over: Partial<BlockedTicket>): BlockedTicket => ({
    id: 1, kind: 'code', priority: 3, ageHours: 10, suggestion: 'stuck',
    lastError: null, noteRef: null, emptyReason: true,
    ...over,
  })

  it('returns REASON_UNKNOWN when there is no last_error and no note', () => {
    expect(deriveUnblockQuestion(blk({}))).toBe(REASON_UNKNOWN)
  })

  it('names a protected-path block as needing an owner-authored change', () => {
    const q = deriveUnblockQuestion(blk({ noteRef: 'Protected path: db/schema.ts', emptyReason: false }))
    expect(q).toContain('Owner-authored change needed')
  })

  it('names a migration ask', () => {
    const q = deriveUnblockQuestion(blk({ lastError: 'needs migration 068 applied', emptyReason: false }))
    expect(q).toContain('Owner needs to apply a migration')
  })

  it('names an explicit owner ask', () => {
    const q = deriveUnblockQuestion(blk({ lastError: 'the owner needs to flip the valve', emptyReason: false }))
    expect(q).toContain('Needs an owner decision')
  })

  it('falls back to the raw reason, clipped, when no known pattern matches', () => {
    const q = deriveUnblockQuestion(blk({ lastError: 'weird custom failure text', emptyReason: false }))
    expect(q).toBe('weird custom failure text')
  })
})

describe('buildBlockedDigest', () => {
  const blk = (over: Partial<BlockedTicket>): BlockedTicket => ({
    id: 1, kind: 'code', priority: 3, ageHours: 10, suggestion: 'stuck',
    lastError: null, noteRef: null, emptyReason: true,
    ...over,
  })

  it('represents every row exactly once, grouped by priority ascending, oldest first within a group', () => {
    const rows = [
      blk({ id: 1, priority: 1, ageHours: 5, lastError: 'needs migration', emptyReason: false }),
      blk({ id: 2, priority: 1, ageHours: 50 }),
      blk({ id: 3, priority: 4, ageHours: 20, noteRef: 'Protected path: team.server.ts', emptyReason: false }),
    ]
    const digest = buildBlockedDigest(rows, NOW)
    expect(digest.totalCount).toBe(3)
    expect(digest.reasonUnknownCount).toBe(1)
    expect(digest.byPriority.map(g => g.priority)).toEqual([1, 4])
    expect(digest.byPriority[0]!.rows.map(r => r.id)).toEqual([2, 1]) // oldest (50h) first
  })

  it('never drops a row, however many are blocked', () => {
    // This is the exact failure #2863 exists to fix: a blocked row invisible
    // to every check. The digest must account for all of them.
    const rows = Array.from({ length: 15 }, (_, i) => blk({ id: 100 + i, priority: (i % 4) + 1 }))
    const digest = buildBlockedDigest(rows, NOW)
    expect(digest.totalCount).toBe(15)
    const allIds = digest.byPriority.flatMap(g => g.rows.map(r => r.id))
    expect(allIds.sort((a, b) => a - b)).toEqual(rows.map(r => r.id).sort((a, b) => a - b))
  })

  it('reports zero for an empty parking lot', () => {
    const digest = buildBlockedDigest([], NOW)
    expect(digest.totalCount).toBe(0)
    expect(digest.reasonUnknownCount).toBe(0)
    expect(digest.byPriority).toEqual([])
  })
})

describe('renderBlockedDigestEmail', () => {
  it('reports an empty parking lot plainly', () => {
    expect(renderBlockedDigestEmail(buildBlockedDigest([], NOW))).toContain('empty')
  })

  it('renders every row with its unblock question under a priority heading', () => {
    const rows = [{
      id: 1, kind: 'code', priority: 1, ageHours: 5, suggestion: 'fix checkout',
      lastError: 'needs migration 070', noteRef: null, emptyReason: false,
    }]
    const html = renderBlockedDigestEmail(buildBlockedDigest(rows, NOW))
    expect(html).toContain('Priority 1')
    expect(html).toContain('#1')
    expect(html).toContain('fix checkout')
    expect(html).toContain('Owner needs to apply a migration')
  })
})

describe('weekBucketKey', () => {
  it('is stable within the same calendar week and changes across a week boundary', () => {
    const mon = new Date('2026-08-10T09:00:00Z')
    const wed = new Date('2026-08-12T20:00:00Z')
    const nextMon = new Date('2026-08-17T09:00:00Z')
    expect(weekBucketKey(mon)).toBe(weekBucketKey(wed))
    expect(weekBucketKey(mon)).not.toBe(weekBucketKey(nextMon))
  })
})

describe('runBlockedTicketDigest', () => {
  it('sends nothing when the weekly guard says this week is already sent', async () => {
    kvSetNXMock.mockReset()
    kvSetNXMock.mockResolvedValueOnce(false)
    sendOwnerEmailMock.mockReset()

    const res = await runBlockedTicketDigest({ now: NOW })

    expect(res).toEqual({
      sent: false,
      skipped: 'already sent this week (pass force=true to re-send)',
      totalCount: 0,
      reasonUnknownCount: 0,
    })
    expect(sendOwnerEmailMock).not.toHaveBeenCalled()
  })

  it('guards on the expected weekly key', async () => {
    kvSetNXMock.mockReset()
    kvSetNXMock.mockResolvedValueOnce(true)
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })

    await runBlockedTicketDigest({ now: NOW })

    expect(kvSetNXMock).toHaveBeenCalledWith(
      `${BLOCKED_DIGEST_KV_PREFIX}${weekBucketKey(NOW)}`,
      expect.any(String),
      expect.any(Number),
    )
  })

  it('sends nothing, but does not error, when there are no blocked tickets', async () => {
    kvSetNXMock.mockReset()
    kvSetNXMock.mockResolvedValueOnce(true)
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })
    sendOwnerEmailMock.mockReset()

    const res = await runBlockedTicketDigest({ now: NOW })

    expect(res).toEqual({ sent: false, skipped: 'no blocked tickets', totalCount: 0, reasonUnknownCount: 0 })
    expect(sendOwnerEmailMock).not.toHaveBeenCalled()
  })

  it('sends the digest with every blocked row represented when tickets exist', async () => {
    kvSetNXMock.mockReset()
    kvSetNXMock.mockResolvedValueOnce(true)
    executeMock.mockReset()
    executeMock.mockResolvedValue({
      rows: [
        {
          id: 1, status: 'blocked', kind: 'code', priority: 1, suggestion: 'p1 blocked',
          last_error: 'needs a migration', created_at: hoursAgo(200).toISOString(),
          updated_at: hoursAgo(200).toISOString(), note_ref: null,
        },
        {
          id: 2, status: 'blocked', kind: 'code', priority: 2, suggestion: 'p2 blocked',
          last_error: null, created_at: hoursAgo(10).toISOString(),
          updated_at: hoursAgo(10).toISOString(), note_ref: null,
        },
      ],
    })
    sendOwnerEmailMock.mockReset()
    sendOwnerEmailMock.mockResolvedValueOnce({ sent: true })

    const res = await runBlockedTicketDigest({ now: NOW })

    expect(res.sent).toBe(true)
    expect(res.totalCount).toBe(2)
    expect(res.reasonUnknownCount).toBe(1)
    expect(sendOwnerEmailMock).toHaveBeenCalledTimes(1)
    const call = sendOwnerEmailMock.mock.calls[0] as [string, string]
    expect(call[0]).toContain('2 row')
    expect(call[1]).toContain('#1')
    expect(call[1]).toContain('#2')
  })

  it('force bypasses the weekly guard entirely', async () => {
    kvSetNXMock.mockReset()
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })

    const res = await runBlockedTicketDigest({ force: true, now: NOW })

    expect(kvSetNXMock).not.toHaveBeenCalled()
    expect(res.skipped).toBe('no blocked tickets')
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
