import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

// ageOutStaleSuggestions() runs raw SQL, so we mock the db client and assert the
// query it emits. `db.execute` is captured through a hoisted mock so vi.mock (which
// vitest lifts above the imports) can wire it before owner-digest.server loads.
const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

import {
  MAX_TICKET_ATTEMPTS,
  ageOutStaleSuggestions,
  parseRenderTruth,
  renderEscalationsSection,
  renderHomepageNowSection,
  renderOpsWatchSection,
  renderOwnerQueueSection,
  renderNeedsMikeSection,
  renderShippedSection,
  renderTicketLoopSection,
  renderTicketsSection,
  type EscalationFacts,
  type HomepageNowFacts,
  type NeedsMikeFacts,
  type OpsWatchFacts,
  type OwnerQueueRow,
  type TicketMetrics,
} from '~/lib/owner-digest.server'
import type { TicketLoopHealth } from '~/lib/ticket-janitor.server'

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
      blockedRows: [{ id: 91, status: 'blocked', kind: 'code', attemptCount: 0, lastError: 'touches app/lib/checkout-probe.server.ts', suggestion: 'Fix the browser checkout probe' }],
    })
    expect(html).toContain('#91')
    expect(html).toContain('touches app/lib/checkout-probe.server.ts')
  })
})

describe('renderOwnerQueueSection', () => {
  const row = (over: Partial<OwnerQueueRow> = {}): OwnerQueueRow => ({
    id: 52, kind: 'process', team: 'strategy', targetTeam: 'homepage',
    ageDays: 9, suggestion: 'Swap the out-of-stock SKU out of the hero rail',
    autoApproved: true, ...over,
  })

  it('says plainly when nothing needs a decision', () => {
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, agedOut: 0 })
    expect(html).toContain('Nothing waiting on a decision')
  })

  it('lists every waiting row, not just the oldest one', () => {
    // The line this replaced named only the oldest row while 52 others sat
    // behind it, including live merchandising defects.
    const html = renderOwnerQueueSection({
      rows: [row({ id: 52 }), row({ id: 53 }), row({ id: 54 })],
      totalCount: 3,
      agedOut: 0,
    })
    expect(html).toContain('#52')
    expect(html).toContain('#53')
    expect(html).toContain('#54')
    expect(html).toContain('3 rows need a decision')
  })

  it('flags rows older than a week and marks auto-approved ones', () => {
    const html = renderOwnerQueueSection({ rows: [row({ ageDays: 9 })], totalCount: 1, agedOut: 0 })
    expect(html).toContain('1 older than 7 days')
    expect(html).toContain('9d')
    expect(html).toContain('(auto)')
  })

  it('shows the routing when a row was filed at another team', () => {
    const html = renderOwnerQueueSection({
      rows: [row({ team: 'strategy', targetTeam: 'homepage' })], totalCount: 1, agedOut: 0,
    })
    expect(html).toContain('strategy&rarr;homepage')
  })

  it('reports the overflow rather than silently truncating', () => {
    const html = renderOwnerQueueSection({ rows: [row()], totalCount: 31, agedOut: 0 })
    expect(html).toContain('and 30 more')
  })

  it('reports what the ager closed on its own', () => {
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, agedOut: 4 })
    expect(html).toContain('4 stale rows aged out')
  })

  it('says the ager was skipped on a forced send, rather than reporting zero', () => {
    // null and 0 mean different things: "did not run" versus "ran, found
    // nothing". A forced test send must not read as a clean nightly sweep.
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, agedOut: null })
    expect(html).toContain('the stale-row ager did not run')
    expect(html).not.toContain('aged out automatically')
  })

  it('stays silent when the ager ran and closed nothing', () => {
    const html = renderOwnerQueueSection({ rows: [], totalCount: 0, agedOut: 0 })
    expect(html).not.toContain('aged out')
    expect(html).not.toContain('did not run')
  })
})

describe('renderOpsWatchSection', () => {
  const base: OpsWatchFacts = {
    socialDrafts: { count: 0, oldestDays: null },
    pricingBatchRows: 4900,
    enrichmentAgeHours: 6,
    strandedVerified: 0,
    agentRetired: [],
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

describe('ageOutStaleSuggestions', () => {
  // No DB harness in this suite, so we render the emitted SQL and assert its
  // shape. That is exactly what the ticket #879 DONE-WHEN turns on: the window
  // must key off created_at, not updated_at.
  function emittedSql(): string {
    const passed = executeMock.mock.calls[0]?.[0]
    return new PgDialect().sqlToQuery(passed).sql
  }

  it('ages a row out on created_at, so a fresh updated_at cannot save it', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [{ id: 41 }, { id: 42 }] })

    const closed = await ageOutStaleSuggestions()
    expect(closed).toBe(2)

    const query = emittedSql()
    // The stale clock is created_at (the age a human perceives), not updated_at
    // (bumped by claims/bounces/lease-expiry/dedupe — the bug being fixed). A row
    // whose updated_at is fresh but whose created_at is > 21 days is still matched
    // because the predicate never looks at updated_at in the WHERE.
    expect(query).toMatch(/created_at\s*<\s*now\(\)\s*-\s*interval\s*'21 days'/)
    expect(query).not.toMatch(/updated_at\s*<\s*now\(\)\s*-\s*interval/)
  })

  it('no longer exempts rows routed at a team, but keeps the defect exemption', async () => {
    executeMock.mockReset()
    executeMock.mockResolvedValue({ rows: [] })
    await ageOutStaleSuggestions()

    const query = emittedSql()
    // target_team restriction dropped: a cross-team row can now age out.
    expect(query).not.toMatch(/target_team/)
    // Customer-facing-defect exemption preserved via kind + priority: a defect is
    // filed as `code` (not process/strategy) and/or P0-P2 (priority < 3).
    expect(query).toMatch(/kind\s+in\s*\(\s*'process',\s*'strategy'\s*\)/i)
    expect(query).toMatch(/priority\s*>=\s*3/)
    expect(query).toMatch(/status\s*=\s*'approved'/)
  })

  it('returns 0 when the query fails rather than throwing', async () => {
    executeMock.mockReset()
    executeMock.mockRejectedValue(new Error('db down'))
    await expect(ageOutStaleSuggestions()).resolves.toBe(0)
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
    backlog: { created7d: 10, terminal7d: 12, netPerDay: -0.3 },
    routineFlags: [],
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
        blocked: [{ id: 455, kind: 'code', ageHours: 100, suggestion: 'stuck', lastError: null, emptyReason: true }],
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
})

describe('renderNeedsMikeSection', () => {
  const emptyFacts: NeedsMikeFacts = {
    needsOwnerPrs: [],
    blockedRows: [],
    staleOwnerRows: [],
    orphans: [],
    missedRoutines: [],
  }

  it('says nothing needs the owner when the list is empty', () => {
    expect(renderNeedsMikeSection(emptyFacts)).toContain('Nothing on this list today')
  })

  it('consolidates every owner-only fact into one list', () => {
    const html = renderNeedsMikeSection({
      needsOwnerPrs: [{ ticketId: 1, ref: 'https://github.com/o/r/pull/508', state: 'needs-owner', title: 'protected' }],
      blockedRows: [{ id: 2, status: 'blocked', kind: 'code', attemptCount: 1, lastError: null, suggestion: 'stuck row' }],
      staleOwnerRows: [{ id: 3, kind: 'campaign', ageDays: 5, suggestion: 'send the pitch batch' }],
      orphans: [{ ticketId: 4, status: 'approved', prRef: 'https://github.com/o/r/pull/429', prOutcome: 'merged' }],
      missedRoutines: [{
        routine: 'Weekly trend scout', team: 'content', runType: 'trend-scout',
        schedule: 'Sat 19:00', lastRunAt: '2026-07-20T19:00:00Z', hoursSince: 380, maxGapHours: 194,
      }],
    })
    expect(html).toContain('PR #508')
    expect(html).toContain('waits on your merge')
    expect(html).toContain('#2 is blocked')
    expect(html).toContain('#3 (campaign) approved 5d ago')
    expect(html).toContain('#4 is orphaned')
    expect(html).toContain('PR #429')
    expect(html).toContain('Weekly trend scout')
    expect(html).toContain('380h ago')
  })
})
