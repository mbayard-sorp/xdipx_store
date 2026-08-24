import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

// Several gatherers (countStaleUndecidedOwnerAsks, etc.) run raw SQL, so we mock
// the db client and assert the query they emit. `db.execute` is captured through a
// hoisted mock so vi.mock (which vitest lifts above the imports) can wire it before
// owner-digest.server loads.
const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

// runOwnerDigest is exercised end-to-end below (the reconcile-before-health
// ordering), so every collaborator with IO is mocked at the module boundary.
const reconcileMock = vi.hoisted(() => vi.fn())
const loopHealthMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/ticket-janitor.server', () => ({
  computeTicketLoopHealth: loopHealthMock,
  reconcilePrLinkStates: reconcileMock,
  describeSupersededEvidence: (e: { kind: string; matchedTicketId?: number; matchedStatus?: string; prNumber?: number }) =>
    e.kind === 'dedupe-key'
      ? `shares a dedupe key with #${e.matchedTicketId} (${e.matchedStatus})`
      : `cites PR #${e.prNumber}, which GitHub reports merged`,
}))
vi.mock('~/lib/kv.server', () => ({
  kvGet: vi.fn(async () => null),
  kvSetNX: vi.fn(async () => true),
  kvDel: vi.fn(async () => undefined),
}))
vi.mock('~/lib/team.server', () => ({
  gate: vi.fn(),
  getValve: vi.fn(async () => false),
  TEAM_IDS: [],
  // The owner-decision queue derives its kinds by excluding these (PR #789 put
  // campaign/promo here alongside process/strategy, leaving program owner-only).
  RUN_CLOSE_KINDS: ['process', 'strategy', 'campaign', 'promo'],
}))
vi.mock('~/lib/team-keys', () => ({ VALVE_KEYS: {}, VIDEO_EXTRA_KEYS: { frameReview: 'video_frame_review' } }))
vi.mock('~/lib/tracker.server', () => ({
  getTrackers: () => [],
  latestOwnerAsks: () => null,
}))
vi.mock('~/lib/owner-alerts.server', () => ({
  sendOwnerEmail: vi.fn(async () => ({ sent: true })),
}))
vi.mock('~/lib/profit.server', () => ({
  getProfitReconciliation: vi.fn(async () => null),
}))
vi.mock('~/lib/seo-daily.server', () => ({
  getLatestSeoDaily: vi.fn(async () => null),
}))
vi.mock('~/lib/homepage-payload.server', () => ({
  readHomepagePayloadB: vi.fn(async () => null),
}))

import {
  MAX_TICKET_ATTEMPTS,
  countStaleUndecidedOwnerAsks,
  parseRenderTruth,
  renderEscalationsSection,
  renderHomepageNowSection,
  renderOpsWatchSection,
  renderOwnerQueueSection,
  OWNER_DECISION_KINDS,
  STALE_OWNER_ROW_KINDS,
  renderNeedsMikeSection,
  renderShippedSection,
  renderTicketLoopSection,
  renderTicketsSection,
  renderAdCampaignQueueSection,
  runOwnerDigest,
  type AdCampaignQueueRow,
  type EscalationFacts,
  type HomepageNowFacts,
  type NeedsMikeFacts,
  type OpsWatchFacts,
  type OwnerQueueRow,
  type TicketMetrics,
} from '~/lib/owner-digest.server'
import type { BlockedTicket, TicketLoopHealth } from '~/lib/ticket-janitor.server'

/** BlockedTicket fixture with sane defaults; override just the field under test. */
function blocked(over: Partial<BlockedTicket> = {}): BlockedTicket {
  const lastError = over.lastError ?? null
  const noteRef = over.noteRef ?? null
  return {
    id: 1, kind: 'code', ageHours: 6, suggestion: 'blocked row',
    lastError, noteRef,
    emptyReason: !lastError?.trim() && !noteRef?.trim(),
    ...over,
  }
}

/**
 * The digest's KV guard is keyed on the UTC date, so triggering the cron to
 * "see it work" burns the day's slot and suppresses the real 13:00 send. These
 * exercise the section builders as the pure functions they are instead.
 */

const liveFacts: NonNullable<HomepageNowFacts['live']> = {
  heroHandle: 'satisfyer-pro-2',
  heroHeadline: 'The one that keeps getting picked',
  railTitles: ['Most picked, right now', 'Quiet enough for a shared wall'],
  tileHeadlines: ['From the Notebook', 'How to pick a first vibrator'],
  builtAt: Date.UTC(2026, 6, 27, 12, 30),
}

describe('renderShippedSection', () => {
  it('says nothing merged when the day was quiet', () => {
    expect(renderShippedSection([])).toContain('Nothing merged in the last 24 hours')
  })

  it('lists the ticket id, kind, and a PR number parsed from the ref', () => {
    const html = renderShippedSection([
      { ticketId: 412, kind: 'code', title: 'Footer falls back to XD Inc', ref: 'https://github.com/o/r/pull/346', at: null },
    ])
    expect(html).toContain('#412')
    expect(html).toContain('code')
    expect(html).toContain('Footer falls back to XD Inc')
    expect(html).toContain('PR #346')
    expect(html).toContain('href="https://github.com/o/r/pull/346"')
  })

  it('omits the ticket id when the merge could not be traced to one', () => {
    const html = renderShippedSection([
      { ticketId: 0, kind: 'code', title: 'untracked merge', ref: '', at: null },
    ])
    expect(html).not.toContain('#0')
  })

  it('escapes ticket text rather than emitting it as markup', () => {
    const html = renderShippedSection([
      { ticketId: 1, kind: 'code', title: '<script>alert(1)</script>', ref: '', at: null },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('renderHomepageNowSection', () => {
  it('reports the hero, rails, and tiles that are live', () => {
    const html = renderHomepageNowSection({ live: liveFacts, renderTruth: null, renderTickets: [] })
    expect(html).toContain('satisfyer-pro-2')
    expect(html).toContain('Most picked, right now')
    expect(html).toContain('From the Notebook')
  })

  it('never implies a pass when render-truth has not reported', () => {
    const html = renderHomepageNowSection({ live: liveFacts, renderTruth: null, renderTickets: [] })
    expect(html).toContain('No render-truth result available')
    expect(html).toContain('This is not a pass')
    expect(html).not.toContain('Render-truth passed')
  })

  it('reports both gate verdicts when a snapshot exists', () => {
    const html = renderHomepageNowSection({
      live: liveFacts,
      renderTruth: { checkedAt: '2026-07-27T12:31:00Z', ok: true, themeGate: 'pass', freshnessGate: 'fail', problems: [] },
      renderTickets: [],
    })
    expect(html).toContain('Render-truth passed')
    expect(html).toContain('theme gate: pass')
    expect(html).toContain('freshness gate: fail')
  })

  it('calls out a failure with its problems', () => {
    const html = renderHomepageNowSection({
      live: liveFacts,
      renderTruth: { checkedAt: null, ok: false, themeGate: 'fail', freshnessGate: 'unknown', problems: ['rail "Quiet enough" missing from live HTML'] },
      renderTickets: [{ id: 91, status: 'approved', suggestion: 'render:hero mismatch' }],
    })
    expect(html).toContain('Render-truth FAILED')
    expect(html).toContain('missing from live HTML')
    expect(html).toContain('1 open render ticket')
    expect(html).toContain('freshness gate: not reported')
  })

  it('says the blob is cold instead of inventing homepage content', () => {
    const html = renderHomepageNowSection({ live: null, renderTruth: null, renderTickets: [] })
    expect(html).toContain('precomputed storefront blob is cold')
  })

  it('flags an unpublished rail slate rather than staying silent', () => {
    const html = renderHomepageNowSection({
      live: { ...liveFacts, railTitles: [], tileHeadlines: [] },
      renderTruth: null,
      renderTickets: [],
    })
    expect(html).toContain('No curated rail is published')
    expect(html).toContain('No editorial tiles published')
  })
})

describe('parseRenderTruth', () => {
  it('returns null for absent or unrecognisable input', () => {
    expect(parseRenderTruth(null)).toBeNull()
    expect(parseRenderTruth('nope')).toBeNull()
    expect(parseRenderTruth({ unrelated: 1 })).toBeNull()
  })

  it('reads a nested gates object', () => {
    const f = parseRenderTruth({ ok: true, checkedAt: '2026-07-27T12:00:00Z', gates: { theme: true, freshness: 'fail' } })
    expect(f).toEqual({
      checkedAt: '2026-07-27T12:00:00Z',
      ok: true,
      themeGate: 'pass',
      freshnessGate: 'fail',
      problems: [],
    })
  })

  it('reads flat gate fields, epoch timestamps, and a missing[] list', () => {
    const f = parseRenderTruth({ ok: false, ts: Date.UTC(2026, 6, 27), themeOk: false, missing: ['hero handle', 7] })
    expect(f?.ok).toBe(false)
    expect(f?.themeGate).toBe('fail')
    expect(f?.freshnessGate).toBe('unknown')
    expect(f?.checkedAt).toBe(new Date(Date.UTC(2026, 6, 27)).toISOString())
    expect(f?.problems).toEqual(['hero handle'])
  })
})

describe('renderTicketsSection', () => {
  const base: TicketMetrics = {
    opened: { code: 3, process: 1 },
    closed: { code: 2 },
    blocked: {},
    oldestApproved: { id: 77, ageDays: 5, suggestion: 'Wire the Compass CTA to /discover' },
    finalAttempt: [],
    blockedRows: [],
    statusCounts: 'proposed: 4 &middot; approved: 2',
  }

  it('counts opened, closed, and blocked by kind', () => {
    const html = renderTicketsSection(base)
    expect(html).toContain('Opened 4 (code 3 &middot; process 1)')
    expect(html).toContain('Closed 2 (code 2)')
    expect(html).toContain('Blocked 0 (none)')
  })

  it('names the oldest approved ticket and its age', () => {
    expect(renderTicketsSection(base)).toContain('#77</strong>, 5 days old')
  })

  it('says so plainly when the approved queue is empty', () => {
    expect(renderTicketsSection({ ...base, oldestApproved: null })).toContain('Nothing sitting in approved')
  })

  it('surfaces tickets on their final attempt with the last error', () => {
    const html = renderTicketsSection({
      ...base,
      finalAttempt: [{ id: 88, status: 'in_progress', kind: 'code', attemptCount: MAX_TICKET_ATTEMPTS - 1, lastError: 'typecheck failed in StorefrontHome', suggestion: 'Fix the tile grid' }],
    })
    expect(html).toContain('On the last attempt')
    expect(html).toContain('#88')
    expect(html).toContain('typecheck failed in StorefrontHome')
  })

  it('keeps the legacy status-count line', () => {
    expect(renderTicketsSection(base)).toContain('proposed: 4')
  })

  it('names blocked tickets and why, not just how many', () => {
    // A count tells the owner a number; only the rows tell him whether the
    // block is his to clear (protected path) or the agent's to retry.
    const html = renderTicketsSection({
      ...base,
      blocked: { code: 1 },
      blockedRows: [blocked({ id: 91, lastError: 'touches app/lib/checkout-probe.server.ts', suggestion: 'Fix the browser checkout probe' })],
    })
    expect(html).toContain('#91')
    expect(html).toContain('touches app/lib/checkout-probe.server.ts')
  })

  it('renders the reason for a block whose reason lives only in a note', () => {
    // R-DEV blocks with a note and no last_error, so the reason is on the
    // suggestion_links note (surfaced by the janitor as noteRef). It must still
    // render, not leave a bare id under a header that promises a reason.
    const html = renderTicketsSection({
      ...base,
      blocked: { code: 1 },
      blockedRows: [blocked({ id: 92, lastError: null, noteRef: 'Requires a change to db/schema.ts (protected path). Needs an owner-authored migration.', suggestion: 'Add the wishlist column' })],
    })
    expect(html).toContain('#92')
    expect(html).toContain('Requires a change to db/schema.ts')
    expect(html).not.toContain('no reason')
  })

  it('flags a block that carries no reason anywhere', () => {
    const html = renderTicketsSection({
      ...base,
      blocked: { code: 1 },
      blockedRows: [blocked({ id: 93, lastError: null, noteRef: null, emptyReason: true, suggestion: 'stuck row' })],
    })
    expect(html).toContain('#93')
    expect(html).toContain('no reason')
  })
})

describe('OWNER_DECISION_KINDS (#4356)', () => {
  it('excludes every kind an agent lane can close (RUN_CLOSE_KINDS)', () => {
    // The decision queue is owner-only work. process/strategy/campaign/promo all
    // have an agent close edge now (PR #789), so only program remains.
    for (const k of ['process', 'strategy', 'campaign', 'promo']) {
      expect(OWNER_DECISION_KINDS).not.toContain(k)
    }
    expect(OWNER_DECISION_KINDS).toContain('program')
  })
})

describe('STALE_OWNER_ROW_KINDS (#4453)', () => {
  it('excludes kinds an agent lane can close, so the Needs Mike list stays owner-only', () => {
    // Same fix as #4356 for OWNER_DECISION_KINDS, on the Needs Mike / stale-owner
    // surface: campaign/promo gained an agent close edge (PR #789), so they no
    // longer belong here. Only program, which has no automated executor, remains.
    for (const k of ['campaign', 'promo']) {
      expect(STALE_OWNER_ROW_KINDS).not.toContain(k)
    }
    expect(STALE_OWNER_ROW_KINDS).toContain('program')
  })
})

describe('renderOwnerQueueSection', () => {
  const row = (over: Partial<OwnerQueueRow> = {}): OwnerQueueRow => ({
    id: 52, kind: 'process', team: 'strategy', targetTeam: 'homepage',
    ageDays: 9, suggestion: 'Swap the out-of-stock SKU out of the hero rail',
    autoApproved: true, ...over,
  })

  it('says plainly when nothing needs a decision', () => {
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, staleUndecided: 0 })
    expect(html).toContain('Nothing waiting on a decision')
  })

  it('lists every waiting row, not just the oldest one', () => {
    // The line this replaced named only the oldest row while 52 others sat
    // behind it, including live merchandising defects.
    const html = renderOwnerQueueSection({
      rows: [row({ id: 52 }), row({ id: 53 }), row({ id: 54 })],
      totalCount: 3,
      staleUndecided: 0,
    })
    expect(html).toContain('#52')
    expect(html).toContain('#53')
    expect(html).toContain('#54')
    expect(html).toContain('3 rows need a decision')
  })

  it('flags rows older than a week and marks auto-approved ones', () => {
    const html = renderOwnerQueueSection({ rows: [row({ ageDays: 9 })], totalCount: 1, staleUndecided: 0 })
    expect(html).toContain('1 older than 7 days')
    expect(html).toContain('9d')
    expect(html).toContain('(auto)')
  })

  it('shows the routing when a row was filed at another team', () => {
    const html = renderOwnerQueueSection({
      rows: [row({ team: 'strategy', targetTeam: 'homepage' })], totalCount: 1, staleUndecided: 0,
    })
    expect(html).toContain('strategy&rarr;homepage')
  })

  it('reports the overflow rather than silently truncating', () => {
    const html = renderOwnerQueueSection({ rows: [row()], totalCount: 31, staleUndecided: 0 })
    expect(html).toContain('and 30 more')
  })

  it('escalates stale undecided asks WITHOUT dismissing them (#4356)', () => {
    // The old behaviour silently auto-dismissed these. An owner ask must never
    // exit undecided: the digest surfaces the count and reaps nothing.
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, staleUndecided: 4 })
    expect(html).toContain('4 process/strategy asks')
    expect(html).toContain('past 21 days')
    expect(html).toContain('Nothing was auto-dismissed')
    expect(html).not.toContain('aged out')
  })

  it('stays silent on a forced send (count not computed), reporting no escalation', () => {
    // null means "not computed this run" (a forced test send), distinct from a
    // real zero. Either way there is no escalation line and no dismissal claim.
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, staleUndecided: null })
    expect(html).not.toContain('past 21 days')
    expect(html).not.toContain('auto-dismissed')
  })

  it('stays silent when nothing is stale', () => {
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, staleUndecided: 0 })
    expect(html).not.toContain('past 21 days')
    expect(html).not.toContain('auto-dismissed')
  })
})

describe('renderOpsWatchSection', () => {
  const base: OpsWatchFacts = {
    socialDrafts: { count: 0, oldestDays: null },
    pricingBatchRows: 4900,
    enrichmentAgeHours: 6,
    strandedVerified: 0,
    agentRetired: [],
    tokenWriteFailures: 0,
    purchaseCapiWriteFailures: 0,
  }

  it('warns that a social backlog stops the team drafting', () => {
    const html = renderOpsWatchSection({ ...base, socialDrafts: { count: 18, oldestDays: 15 } })
    expect(html).toContain('18 social drafts awaiting review')
    expect(html).toContain('oldest 15 days')
    expect(html).toContain('stops drafting')
  })

  it('calls a missing pricing recompute a failure, not silence', () => {
    const html = renderOpsWatchSection({ ...base, pricingBatchRows: 0 })
    expect(html).toContain('No scheduled pricing recompute yesterday')
    // Catch-up runs must not be able to satisfy the check.
    expect(html).toContain('catch-up runs do not count')
  })

  it('confirms a healthy recompute', () => {
    expect(renderOpsWatchSection(base)).toContain('Pricing recompute ran yesterday')
  })

  it('flags a stalled enrich stage but stays quiet when it is fresh', () => {
    expect(renderOpsWatchSection({ ...base, enrichmentAgeHours: 220 })).toContain('may be stalled')
    expect(renderOpsWatchSection(base)).not.toContain('may be stalled')
  })

  it('surfaces unreconciled verified tickets', () => {
    expect(renderOpsWatchSection({ ...base, strandedVerified: 2 }))
      .toContain('2 verified tickets not yet reconciled')
  })

  it('reports token-log write failures only when nonzero', () => {
    expect(renderOpsWatchSection({ ...base, tokenWriteFailures: 3 }))
      .toContain('3 api_token_log writes failed even after retry')
    expect(renderOpsWatchSection(base)).not.toContain('api_token_log')
  })

  it('reports Purchase CAPI ledger write failures only when nonzero', () => {
    const html = renderOpsWatchSection({ ...base, purchaseCapiWriteFailures: 5 })
    expect(html).toContain('5 Purchase (Meta CAPI) ledger writes failed')
    expect(html).toContain('Conversion tracking is undercounting')
    // Singular grammar and the healthy (zero) case.
    expect(renderOpsWatchSection({ ...base, purchaseCapiWriteFailures: 1 }))
      .toContain('1 Purchase (Meta CAPI) ledger write failed')
    expect(renderOpsWatchSection(base)).not.toContain('Meta CAPI')
  })

  it('lists what an agent retired, so the new power stays reviewable', () => {
    const html = renderOpsWatchSection({
      ...base,
      agentRetired: [{ id: 9, kind: 'process', suggestion: 'Stale run observation from 07-12' }],
    })
    expect(html).toContain('#9')
    expect(html).toContain('Retired by agent-editor')
  })
})

describe('renderEscalationsSection', () => {
  it('says nothing needs the owner when both lists are empty', () => {
    const html = renderEscalationsSection({ protectedPrs: [], exhausted: [] })
    expect(html).toContain('Nothing needs you today')
    expect(html).not.toContain('<ul')
  })

  it('lists protected-path PRs waiting on a human merge', () => {
    const facts: EscalationFacts = {
      protectedPrs: [{ ticketId: 55, ref: 'https://github.com/o/r/pull/350', state: 'needs-owner', title: 'Add migration 072' }],
      exhausted: [],
    }
    const html = renderEscalationsSection(facts)
    expect(html).toContain('1 PR waiting on you')
    expect(html).toContain('PR #350')
    expect(html).toContain('ticket #55')
  })

  it('lists tickets that ran out of attempts', () => {
    const html = renderEscalationsSection({
      protectedPrs: [],
      exhausted: [{ id: 61, status: 'blocked', kind: 'code', attemptCount: 3, lastError: 'smoke failed on /discover', suggestion: 'Repair the Compass rail' }],
    })
    expect(html).toContain('1 ticket out of attempts')
    expect(html).toContain('#61')
    expect(html).toContain('smoke failed on /discover')
  })

  it('pluralises both lists together', () => {
    const html = renderEscalationsSection({
      protectedPrs: [
        { ticketId: 1, ref: 'https://github.com/o/r/pull/1', state: 'needs-owner', title: 'a' },
        { ticketId: 2, ref: 'https://github.com/o/r/pull/2', state: 'needs-owner', title: 'b' },
      ],
      exhausted: [
        { id: 3, status: 'blocked', kind: 'code', attemptCount: 3, lastError: null, suggestion: 'c' },
        { id: 4, status: 'blocked', kind: 'code', attemptCount: 4, lastError: null, suggestion: 'd' },
      ],
    })
    expect(html).toContain('2 PRs waiting on you')
    expect(html).toContain('2 tickets out of attempts')
  })
})

describe('countStaleUndecidedOwnerAsks (#4356)', () => {
  // No DB harness in this suite, so we render the emitted SQL and assert its
  // shape. The #4356 change: this must COUNT, never dismiss — an owner ask must
  // not exit undecided as a side effect of rendering the email.
  function emittedSql(): string {
    const passed = executeMock.mock.calls[0]?.[0]
    return new PgDialect().sqlToQuery(passed).sql
  }

  it('reads a count and never writes — no UPDATE/dismiss (#4356)', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [{ n: 3 }] })

    const n = await countStaleUndecidedOwnerAsks()
    expect(n).toBe(3)

    const query = emittedSql()
    // The core of the fix: this is a read. Nothing is dismissed.
    expect(query).toMatch(/select\s+count/i)
    expect(query).not.toMatch(/update\s+homepage_team_suggestions/i)
    expect(query).not.toMatch(/set\s+status\s*=\s*'dismissed'/i)
  })

  it('keeps the created_at clock and the kind/priority scope from #879', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [{ n: 0 }] })
    await countStaleUndecidedOwnerAsks()

    const query = emittedSql()
    // created_at, not updated_at (bumped by claims/bounces/lease-expiry/dedupe).
    expect(query).toMatch(/created_at\s*<\s*now\(\)\s*-\s*interval\s*'21 days'/)
    expect(query).not.toMatch(/updated_at\s*<\s*now\(\)\s*-\s*interval/)
    // Defect exemption preserved via kind + priority (a defect is `code` and/or P0-P2).
    expect(query).toMatch(/kind\s+in\s*\(\s*'process',\s*'strategy'\s*\)/i)
    expect(query).toMatch(/priority\s*>=\s*3/)
    expect(query).toMatch(/status\s*=\s*'approved'/)
  })

  it('returns 0 when the query fails rather than throwing', async () => {
    executeMock.mockReset()
    executeMock.mockRejectedValue(new Error('db down'))
    await expect(countStaleUndecidedOwnerAsks()).resolves.toBe(0)
  })
})

describe('renderTicketLoopSection', () => {
  const healthyLoop: TicketLoopHealth = {
    generatedAt: '2026-08-05T13:00:00Z',
    sla: {
      prOpen: [],
      inReview: [],
      approvedCode: { count: 0, oldest: null, rows: [] },
      proposed: [],
      blocked: [],
    },
    orphans: [],
    orphanScanSkipped: false,
    conflictedPrs: [],
    backlog: { created7d: 10, terminal7d: 12, netPerDay: -0.3 },
    routineFlags: [],
    supersededApproved: [],
  }

  it('reports an absent health object as unknown, never as a pass', () => {
    const html = renderTicketLoopSection(null)
    expect(html).toContain('unknown')
    expect(html).toContain('not a pass')
  })

  it('says plainly when the loop is healthy', () => {
    const html = renderTicketLoopSection(healthyLoop)
    expect(html).toContain('net -0.3/day')
    expect(html).toContain('No orphaned tickets')
    expect(html).toContain('Every expected routine has run inside its cadence window')
  })

  it('surfaces SLA breaches, empty-reason blocks, orphans, and dead routines', () => {
    const html = renderTicketLoopSection({
      ...healthyLoop,
      sla: {
        prOpen: [{ id: 9, status: 'pr_open', kind: 'code', priority: 2, ageHours: 30, suggestion: 'fix nav' }],
        inReview: [{ id: 8, status: 'in_review', kind: 'code', priority: 2, ageHours: 15, suggestion: 'crashed' }],
        approvedCode: {
          count: 56,
          oldest: { id: 3, status: 'approved', kind: 'code', priority: 3, ageHours: 21 * 24, suggestion: 'old' },
          rows: [],
        },
        proposed: [{ id: 7, status: 'proposed', kind: 'code', priority: 3, ageHours: 80, suggestion: 'untriaged' }],
        blocked: [{ id: 455, kind: 'code', ageHours: 100, suggestion: 'stuck', lastError: null, noteRef: null, emptyReason: true }],
      },
      orphans: [{ ticketId: 120, status: 'approved', prRef: 'https://github.com/o/r/pull/436', prOutcome: 'merged' }],
      backlog: { created7d: 60, terminal7d: 18, netPerDay: 6 },
      routineFlags: [{
        routine: 'Weekly business research', team: 'social', runType: 'research',
        schedule: 'Thu 16:00', lastRunAt: null, hoursSince: null, maxGapHours: 194,
      }],
    })
    expect(html).toContain('net +6/day')
    expect(html).toContain('#9')
    expect(html).toContain('56 approved code tickets')
    expect(html).toContain('oldest #3 at 21d')
    expect(html).toContain('#455')
    expect(html).toContain('1 with no recorded reason')
    expect(html).toContain('#120')
    expect(html).toContain('PR #436')
    expect(html).toContain('Weekly business research')
    expect(html).toContain('no run row ever')
  })

  it('reports a skipped orphan scan as skipped, not as zero orphans', () => {
    const html = renderTicketLoopSection({ ...healthyLoop, orphanScanSkipped: true })
    expect(html).toContain('Orphan scan skipped')
    expect(html).not.toContain('No orphaned tickets')
  })

  it('surfaces a merge-conflicted PR, on which CI can never run', () => {
    // A conflicted PR gets ZERO pull_request workflow runs, and the engine
    // parks it silently; this line is what stops the next incident being
    // re-investigated as "Actions declined my triggers".
    const html = renderTicketLoopSection({
      ...healthyLoop,
      conflictedPrs: [{
        number: 494,
        title: 'fix the rail',
        branch: 'ticket/494',
        explanation: 'CI cannot run on a merge-conflicted PR.',
      }],
    })
    expect(html).toContain('1 merge-conflicted PR')
    expect(html).toContain('CI cannot run on a conflicted PR at all')
    expect(html).toContain('Merge origin/main into the branch and rebuild')
    expect(html).toContain('PR #494')
    expect(html).toContain('ticket/494')
  })

  it('stays silent on conflicts when there are none', () => {
    expect(renderTicketLoopSection(healthyLoop)).not.toContain('merge-conflicted')
  })

  it('flags a superseded approved-code ticket without implying it was closed', () => {
    const html = renderTicketLoopSection({
      ...healthyLoop,
      supersededApproved: [{
        ticketId: 3204,
        suggestion: 'url-liveness-samehost-redirect',
        evidence: [{ kind: 'cited-pr-merged', prNumber: 654 }],
      }],
    })
    expect(html).toContain('#3204')
    expect(html).toContain('PR #654')
    expect(html).toContain('not auto-dismissed')
  })

  it('stays silent on superseded flags when there are none', () => {
    expect(renderTicketLoopSection(healthyLoop)).not.toContain('flagged as likely already shipped')
  })
})

describe('runOwnerDigest', () => {
  it('reconciles pr-link states immediately before computing ticket-loop health', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })
    reconcileMock.mockReset()
    loopHealthMock.mockReset()
    const order: string[] = []
    reconcileMock.mockImplementation(async () => {
      order.push('reconcile')
      return { checked: 0, updated: [], skipped: true }
    })
    loopHealthMock.mockImplementation(async () => {
      order.push('health')
      return null
    })

    const res = await runOwnerDigest({ force: true })

    expect(res.sent).toBe(true)
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(loopHealthMock).toHaveBeenCalledTimes(1)
    // Fresh link states are the point: the reconcile completes before the
    // health computation starts, not merely somewhere in the same run.
    expect(order).toEqual(['reconcile', 'health'])
  })

  it('still sends and still computes health when the reconcile fails', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })
    reconcileMock.mockReset()
    loopHealthMock.mockReset()
    reconcileMock.mockRejectedValue(new Error('github down'))
    loopHealthMock.mockResolvedValue(null)

    const res = await runOwnerDigest({ force: true })

    expect(res.sent).toBe(true)
    expect(loopHealthMock).toHaveBeenCalledTimes(1)
  })
})

describe('renderNeedsMikeSection', () => {
  const emptyFacts: NeedsMikeFacts = {
    needsOwnerPrs: [],
    blockedRows: [],
    staleOwnerRows: [],
    orphans: [],
    conflictedPrs: [],
    missedRoutines: [],
  }

  it('says nothing needs the owner when the list is empty', () => {
    expect(renderNeedsMikeSection(emptyFacts)).toContain('Nothing on this list today')
  })

  it('consolidates every owner-only fact into one list', () => {
    const html = renderNeedsMikeSection({
      needsOwnerPrs: [{ ticketId: 1, ref: 'https://github.com/o/r/pull/508', state: 'needs-owner', title: 'protected' }],
      blockedRows: [blocked({ id: 2, lastError: null, noteRef: 'Protected path: this change edits the release engine itself.', suggestion: 'stuck row' })],
      staleOwnerRows: [{ id: 3, kind: 'campaign', ageDays: 5, suggestion: 'send the pitch batch' }],
      orphans: [{ ticketId: 4, status: 'approved', prRef: 'https://github.com/o/r/pull/429', prOutcome: 'merged' }],
      conflictedPrs: [{
        number: 494,
        title: 'fix the rail',
        branch: 'ticket/494',
        explanation: 'CI cannot run on a merge-conflicted PR.',
      }],
      missedRoutines: [{
        routine: 'Weekly trend scout', team: 'content', runType: 'trend-scout',
        schedule: 'Sat 19:00', lastRunAt: '2026-07-20T19:00:00Z', hoursSince: 380, maxGapHours: 194,
      }],
    })
    expect(html).toContain('PR #508')
    expect(html).toContain('waits on your merge')
    expect(html).toContain('#2 is blocked')
    expect(html).toContain('Protected path: this change edits the release engine itself.')
    expect(html).toContain('#3 (campaign) approved 5d ago')
    expect(html).toContain('#4 is orphaned')
    expect(html).toContain('PR #429')
    expect(html).toContain('PR #494 is merge-conflicted, CI cannot run on it at all, rebase it on main')
    expect(html).toContain('ticket/494')
    expect(html).toContain('Weekly trend scout')
    expect(html).toContain('380h ago')
  })

  it('flags a blocked row that records no reason at all', () => {
    const html = renderNeedsMikeSection({
      ...emptyFacts,
      blockedRows: [blocked({ id: 7, lastError: null, noteRef: null, emptyReason: true, suggestion: 'reasonless block' })],
    })
    expect(html).toContain('#7 is blocked')
    expect(html).toContain('no reason recorded')
  })

  it('lists an approved-but-unlaunched ad campaign as owner-only work', () => {
    const html = renderNeedsMikeSection({
      ...emptyFacts,
      adCampaigns: [{
        id: 12, platform: 'google', name: 'Branded search test', objective: 'conversions',
        plannedDailyCents: 500, ageDays: 30,
      }],
    })
    expect(html).toContain('Ad campaign #12')
    expect(html).toContain('approved 30d ago and never launched')
    expect(html).toContain('/admin/ad-studio')
  })

  it('lists video frames parked for the owner pick as owner-only work (#4356)', () => {
    const html = renderNeedsMikeSection({
      ...emptyFacts,
      parkedVideoFrames: { count: 3, oldestDays: 4 },
    })
    expect(html).toContain('3 video frames are awaiting your pick')
    expect(html).toContain('oldest 4d')
    expect(html).toContain('/admin/video-studio')
  })

  it('says nothing about video frames when the valve is off (null) or the queue is empty', () => {
    expect(renderNeedsMikeSection({ ...emptyFacts, parkedVideoFrames: null })).not.toContain('video-studio')
    expect(renderNeedsMikeSection({ ...emptyFacts, parkedVideoFrames: { count: 0, oldestDays: null } })).not.toContain('video-studio')
  })
})

describe('renderAdCampaignQueueSection', () => {
  const row: AdCampaignQueueRow = {
    id: 12, platform: 'google', name: 'Branded search test', objective: 'conversions',
    plannedDailyCents: 500, ageDays: 30,
  }

  it('says plainly when nothing is waiting on a launch', () => {
    const html = renderAdCampaignQueueSection([])
    expect(html).toContain('No approved ad campaign proposal is waiting on a launch')
  })

  it('lists each approved proposal with its age and points at /admin/ad-studio', () => {
    // The root cause of ticket #3423: three proposals sat approved for a month
    // and nothing prompted the owner. Age and the studio link are load-bearing.
    const html = renderAdCampaignQueueSection([row, { ...row, id: 13, name: 'PMax probe', ageDays: 2 }])
    expect(html).toContain('2 approved ad campaigns not launched')
    expect(html).toContain('#12')
    expect(html).toContain('Branded search test')
    expect(html).toContain('approved 30d ago')
    expect(html).toContain('approved 2d ago')
    expect(html).toContain('$5.00/day planned')
    expect(html).toContain('https://xdipx.com/admin/ad-studio')
    expect(html).toContain('Approving is not launching')
  })

  it('escapes campaign names, which are agent-authored text', () => {
    const html = renderAdCampaignQueueSection([{ ...row, name: '<script>x</script>' }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
