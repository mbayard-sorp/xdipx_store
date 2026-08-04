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

import { getPullRequest } from '~/lib/github.server'
import { fileTicketForOpenPr, transitionSuggestion } from '~/lib/team.server'
import {
  AUTOFILE_DEDUPE_PREFIX,
  autoFileTicketForPr,
  autofileDedupeKey,
  prNumberFromAutofileKey,
} from '~/lib/release-ticket-autofile.server'

const PR = { number: 494, title: 'docs: something', htmlUrl: 'https://github.com/o/r/pull/494', headRef: 'claude/foo' }

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
