/**
 * Tests for ADR-008 step 2, the ticket-autofile backstop.
 *
 * Same discipline as release-engine.test.ts: the database here is PRODUCTION and
 * the GitHub token is real, so db.server, team.server, and github.server are all
 * mocked at import time. Nothing in this file can write a row or call GitHub.
 *
 * What is asserted:
 *   1. The dedupe key round-trips, and refuses anything that is not ours. This
 *      is what stops the abandoned-PR sweep touching a ticket it did not file.
 *   2. Autofile never throws into the release cycle, and does nothing on a dry
 *      run or a dedupe hit.
 *   3. The sweep only dismisses on a closed AND unmerged PR, and fails closed on
 *      an API error rather than assuming abandonment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/github.server', () => ({ getPullRequest: vi.fn() }))
vi.mock('~/lib/team.server', () => ({
  fileTicketForOpenPr: vi.fn(),
  transitionSuggestion: vi.fn(),
  autofileDedupeKey: (n: number) => `autofile:pr-${n}`,
}))

import { db } from '~/lib/db.server'
import { getPullRequest } from '~/lib/github.server'
import { fileTicketForOpenPr, transitionSuggestion } from '~/lib/team.server'
import {
  AUTOFILE_DEDUPE_PREFIX,
  autoFileTicketForPr,
  autofileDedupeKey,
  prNumberFromAutofileKey,
  prNumberFromLinkRef,
} from '~/lib/release-ticket-autofile.server'

const PR = { number: 494, title: 'docs: something', htmlUrl: 'https://github.com/o/r/pull/494', headRef: 'claude/foo' }

/** Stub the prAlreadyTracked query (select → from → innerJoin → where → limit)
 *  to return one link row per ref. []' means the PR is not tracked. */
function stubTrackingLinks(refs: string[]) {
  const rows = refs.map((ref) => ({ ref }))
  ;(db as unknown as Record<string, unknown>).select = () => ({
    from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => rows }) }) }),
  })
}

beforeEach(() => {
  vi.mocked(fileTicketForOpenPr).mockReset()
  vi.mocked(transitionSuggestion).mockReset()
  vi.mocked(getPullRequest).mockReset()
})

describe('autofile dedupe key', () => {
  it('round-trips a PR number', () => {
    expect(autofileDedupeKey(494)).toBe(`${AUTOFILE_DEDUPE_PREFIX}494`)
    expect(prNumberFromAutofileKey(autofileDedupeKey(494))).toBe(494)
  })

  // The sweep restricts itself to rows carrying this prefix, so anything it
  // cannot parse has to come back null rather than guess a PR number. A wrong
  // guess would mean checking one PR's state and dismissing a different
  // ticket.
  it('refuses keys that are not ours or are unparseable', () => {
    for (const k of [
      null, undefined, '', 'tracker:p0-2-restock', 'autofile:pr-', 'autofile:pr-abc',
      'autofile:pr-1.5', 'autofile:pr--3', 'autofile:pr-0', 'xautofile:pr-1',
    ]) {
      expect(prNumberFromAutofileKey(k)).toBeNull()
    }
  })

  it('stays inside the dedupe_key column width for any realistic PR number', () => {
    expect(autofileDedupeKey(999_999).length).toBeLessThanOrEqual(64)
  })
})

describe('autoFileTicketForPr', () => {
  // Default state for the two ticket #3302 guards: nothing tracks the PR yet,
  // and the PR is open. Individual tests override as needed.
  beforeEach(() => {
    stubTrackingLinks([]) // (b) not tracked
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: { state: 'open', merged: false },
    } as never) // (a) not merged
  })

  it('writes nothing on a dry run', async () => {
    expect(await autoFileTicketForPr(PR, true)).toBeNull()
    expect(fileTicketForOpenPr).not.toHaveBeenCalled()
  })

  it('reports the new ticket when one is created', async () => {
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(1234)
    expect(await autoFileTicketForPr(PR)).toEqual({ prNumber: 494, ticketId: 1234, created: true })
  })

  // Steady state between filing and QA: every cycle re-decides `no-ticket` until
  // the ticket reaches `verified`, so a dedupe hit is the common case and must
  // stay quiet rather than re-filing or logging on every ten-minute tick.
  it('is silent when a live ticket already holds the key', async () => {
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(0)
    expect(await autoFileTicketForPr(PR)).toBeNull()
  })

  // The release cycle's real job is merging. A bus write that fails must not
  // propagate: the next cycle retries in ten minutes.
  it('swallows a write failure instead of breaking the cycle', async () => {
    vi.mocked(fileTicketForOpenPr).mockRejectedValue(new Error('db down'))
    await expect(autoFileTicketForPr(PR)).resolves.toBeNull()
  })

  // Ticket #3302 (b): a live/applied ticket already tracks this PR, so filing a
  // second row is redundant and only makes R-DEV claim+block it. No write.
  it('does not file when a tracked ticket already links the PR', async () => {
    stubTrackingLinks(['https://github.com/o/r/pull/494'])
    expect(await autoFileTicketForPr(PR)).toBeNull()
    expect(fileTicketForOpenPr).not.toHaveBeenCalled()
  })

  // Exact-match guard: a link for a different PR whose number shares a prefix
  // (/pull/4940) must not count as tracking PR 494.
  it('still files when the only link is a different PR sharing a number prefix', async () => {
    stubTrackingLinks(['https://github.com/o/r/pull/4940'])
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(1234)
    expect(await autoFileTicketForPr(PR)).toEqual({ prNumber: 494, ticketId: 1234, created: true })
  })

  // Ticket #3302 (a): the PR already merged, so a pr_open ticket for it is noise
  // (sweepOutOfBandMerges and its applied ticket own it). No write.
  it('does not file when the PR is already merged', async () => {
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: { state: 'closed', merged: true },
    } as never)
    expect(await autoFileTicketForPr(PR)).toBeNull()
    expect(fileTicketForOpenPr).not.toHaveBeenCalled()
  })

  // Fail toward filing: neither guard may strand the PR when it cannot decide.
  it('files anyway when the tracked-ticket lookup throws', async () => {
    ;(db as unknown as Record<string, unknown>).select = () => {
      throw new Error('db down')
    }
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(1234)
    expect(await autoFileTicketForPr(PR)).toEqual({ prNumber: 494, ticketId: 1234, created: true })
  })

  it('files anyway when the merged-state check cannot read GitHub', async () => {
    vi.mocked(getPullRequest).mockResolvedValue({ ok: false, status: 500, error: 'boom' } as never)
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(1234)
    expect(await autoFileTicketForPr(PR)).toEqual({ prNumber: 494, ticketId: 1234, created: true })
  })

  // Ticket #3775: two overlapping engine cycles can invoke autofile for the same
  // PR at once. Coalescing collapses them onto one execution, so exactly one
  // ticket is filed and the pre-check runs once. Without it both calls would
  // reach `fileTicketForOpenPr` (twice) and both run the GitHub merged-check.
  it('coalesces concurrent invocations for one PR into a single file', async () => {
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(1234)
    const [r1, r2] = await Promise.all([autoFileTicketForPr(PR), autoFileTicketForPr(PR)])
    expect(fileTicketForOpenPr).toHaveBeenCalledTimes(1)
    expect(getPullRequest).toHaveBeenCalledTimes(1)
    expect(r1).toEqual({ prNumber: 494, ticketId: 1234, created: true })
    expect(r2).toBe(r1) // both callers observe the same coalesced result
  })

  // The coalescing key must clear once the run settles, or a later cycle would
  // be wrongly memoized to the first result instead of re-deciding the PR.
  it('does not coalesce sequential calls once the first has settled', async () => {
    vi.mocked(fileTicketForOpenPr).mockResolvedValue(1234)
    await autoFileTicketForPr(PR)
    await autoFileTicketForPr(PR)
    expect(fileTicketForOpenPr).toHaveBeenCalledTimes(2)
  })
})

describe('prNumberFromLinkRef', () => {
  it('parses /pull/N and #N, and rejects everything else', () => {
    expect(prNumberFromLinkRef('https://github.com/o/r/pull/494')).toBe(494)
    expect(prNumberFromLinkRef('#655')).toBe(655)
    expect(prNumberFromLinkRef('https://github.com/o/r/pull/4940')).toBe(4940)
    expect(prNumberFromLinkRef('https://github.com/o/r/issues/12')).toBeNull()
    expect(prNumberFromLinkRef('nonsense')).toBeNull()
  })
})

describe('dismissTicketsForClosedUnmergedPrs', () => {
  /** The module reads rows through drizzle's builder chain; stub just enough of
   *  it to hand back one auto-filed ticket. */
  async function sweepWith(row: { id: number; dedupeKey: string | null } | null) {
    const { db } = await import('~/lib/db.server')
    const rows = row ? [row] : []
    ;(db as unknown as Record<string, unknown>).select = () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }),
    })
    const mod = await import('~/lib/release-ticket-autofile.server')
    return mod.dismissTicketsForClosedUnmergedPrs()
  }

  it('dismisses a ticket whose PR was closed without merging', async () => {
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: { state: 'closed', merged: false },
    } as never)
    const out = await sweepWith({ id: 7, dedupeKey: 'autofile:pr-494' })
    expect(out.dismissed).toBe(1)
    expect(transitionSuggestion).toHaveBeenCalledWith(7, 'dismissed', 'system', expect.anything())
  })

  // A merged PR belongs to sweepOutOfBandMerges, which moves it to `applied`.
  // Dismissing it here would record shipped work as abandoned.
  it('leaves a merged PR alone', async () => {
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: { state: 'closed', merged: true },
    } as never)
    const out = await sweepWith({ id: 7, dedupeKey: 'autofile:pr-494' })
    expect(out.dismissed).toBe(0)
    expect(transitionSuggestion).not.toHaveBeenCalled()
  })

  it('leaves an open PR alone', async () => {
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: { state: 'open', merged: false },
    } as never)
    const out = await sweepWith({ id: 7, dedupeKey: 'autofile:pr-494' })
    expect(out.dismissed).toBe(0)
  })

  // Fail closed. An unreachable API is not evidence that a PR was abandoned,
  // and this sweep's only irreversible act is retiring a ticket.
  it('does not dismiss when GitHub cannot be read', async () => {
    vi.mocked(getPullRequest).mockResolvedValue({ ok: false, status: 500, error: 'boom' } as never)
    const out = await sweepWith({ id: 7, dedupeKey: 'autofile:pr-494' })
    expect(out.dismissed).toBe(0)
    expect(out.errors).toHaveLength(1)
    expect(transitionSuggestion).not.toHaveBeenCalled()
  })

  it('skips a row whose key it cannot parse, without calling GitHub', async () => {
    const out = await sweepWith({ id: 7, dedupeKey: 'autofile:pr-nope' })
    expect(out.checked).toBe(0)
    expect(getPullRequest).not.toHaveBeenCalled()
  })
})
