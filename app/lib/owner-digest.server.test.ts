import { describe, expect, it } from 'vitest'
import {
  MAX_TICKET_ATTEMPTS,
  parseRenderTruth,
  renderEscalationsSection,
  renderHomepageNowSection,
  renderOpsWatchSection,
  renderOwnerQueueSection,
  renderShippedSection,
  renderTicketsSection,
  type EscalationFacts,
  type HomepageNowFacts,
  type OpsWatchFacts,
  type OwnerQueueRow,
  type TicketMetrics,
} from '~/lib/owner-digest.server'

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
    expect(html).toContain('4 untargeted rows aged out')
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
