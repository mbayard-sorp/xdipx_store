// Unit tests for the out-of-band merge sweep.
//
// The database here is PRODUCTION, so nothing in this file may reach it. Only
// the pure decision layer is exercised; the query and transition paths are
// integration surface, verified by watching the first live sweep instead.
import { describe, expect, it, vi } from 'vitest'

// Same discipline as team-tickets.test.ts: stub every module that would open a
// connection or reach GitHub, so importing the module under test is inert.
vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/github.server', () => ({ getPullRequest: vi.fn() }))
vi.mock('~/lib/release-engine.server', () => ({ prNumberFromRef: vi.fn() }))
vi.mock('~/lib/team.server', () => ({ transitionSuggestion: vi.fn() }))

import {
  classifyTicketPrMatches,
  isMergedOutOfBand,
  referencesTicketId,
  SWEEP_MAX_TICKETS,
  SWEEP_MIN_AGE_MINUTES,
  type SearchedPr,
} from '~/lib/ticket-out-of-band-sweep.server'

/** A merged PR search hit, PR by default. */
function pr(overrides: Partial<SearchedPr> & { number: number }): SearchedPr {
  return { title: '', body: '', isPullRequest: true, ...overrides }
}

describe('isMergedOutOfBand', () => {
  it('closes a ticket only when GitHub itself reports the PR merged', () => {
    expect(isMergedOutOfBand({ merged: true })).toBe(true)
    expect(isMergedOutOfBand({ merged: false })).toBe(false)
  })

  it('never infers a merge from a missing or malformed flag', () => {
    // The whole safety property of this sweep is that it cannot mark unmerged
    // work as shipped, so anything that is not a literal true stays closed.
    expect(isMergedOutOfBand({ merged: undefined as unknown as boolean })).toBe(false)
    expect(isMergedOutOfBand({ merged: null as unknown as boolean })).toBe(false)
    expect(isMergedOutOfBand({ merged: 'true' as unknown as boolean })).toBe(false)
    expect(isMergedOutOfBand({ merged: 1 as unknown as boolean })).toBe(false)
  })
})

describe('sweep bounds', () => {
  it('caps the tickets one sweep may touch', () => {
    // Bounds the GitHub calls a single cycle can make, which matters because
    // the token has already failed silently once. The link-less path spends the
    // same budget as the linked path, so this ceiling bounds both. (DONE-WHEN d)
    expect(SWEEP_MAX_TICKETS).toBeGreaterThan(0)
    expect(SWEEP_MAX_TICKETS).toBeLessThanOrEqual(10)
  })

  it('leaves the engine a grace period to merge normally first', () => {
    // Sweeping immediately would race the engine's own merge path and re-query
    // PRs that are about to be handled properly.
    expect(SWEEP_MIN_AGE_MINUTES).toBeGreaterThanOrEqual(30)
  })
})

describe('referencesTicketId', () => {
  it('matches the R-DEV convention in a title or body', () => {
    expect(referencesTicketId('agents: ticket #469: fix the sweep', 469)).toBe(true)
    expect(referencesTicketId('Closes ticket #469 for good', 469)).toBe(true)
    expect(referencesTicketId('TICKET #469', 469)).toBe(true) // case-insensitive
  })

  it('never matches a different id that merely shares a prefix', () => {
    // This is the whole safety property of the link-less path: #43 must not be
    // closed against a PR for #431, or #432, etc.
    expect(referencesTicketId('agents: ticket #431: something else', 43)).toBe(false)
    expect(referencesTicketId('ticket #4690 unrelated', 469)).toBe(false)
    expect(referencesTicketId('nothing to see here', 469)).toBe(false)
  })
})

describe('classifyTicketPrMatches', () => {
  it('(a) returns the single merged PR that confidently references the ticket', () => {
    const result = classifyTicketPrMatches(
      [
        pr({ number: 417, title: 'agents: ticket #432: no-em-dash title' }),
        pr({ number: 400, title: 'unrelated cleanup' }),
      ],
      432,
    )
    expect(result).toEqual({ kind: 'match', prNumber: 417 })
  })

  it('matches on the PR body as well as the title', () => {
    const result = classifyTicketPrMatches(
      [pr({ number: 417, title: 'chore: batched fixes', body: 'Also closes ticket #432.' })],
      432,
    )
    expect(result).toEqual({ kind: 'match', prNumber: 417 })
  })

  it('(b) leaves a link-less ticket alone when no merged PR references it', () => {
    const result = classifyTicketPrMatches(
      [pr({ number: 500, title: 'agents: ticket #999: unrelated' })],
      432,
    )
    expect(result).toEqual({ kind: 'none' })
  })

  it('(c) refuses to guess when more than one merged PR references the ticket', () => {
    const result = classifyTicketPrMatches(
      [
        pr({ number: 417, title: 'agents: ticket #432: first attempt' }),
        pr({ number: 420, body: 'supersedes ticket #432' }),
      ],
      432,
    )
    expect(result).toEqual({ kind: 'ambiguous', prNumbers: [417, 420] })
  })

  it('ignores issues that the same search endpoint also returns', () => {
    const result = classifyTicketPrMatches(
      [{ number: 432, title: 'ticket #432 the original issue', body: '', isPullRequest: false }],
      432,
    )
    expect(result).toEqual({ kind: 'none' })
  })

  it('does not mistake the same PR appearing twice for ambiguity', () => {
    const result = classifyTicketPrMatches(
      [
        pr({ number: 417, title: 'agents: ticket #432: fix' }),
        pr({ number: 417, body: 'ticket #432' }),
      ],
      432,
    )
    expect(result).toEqual({ kind: 'match', prNumber: 417 })
  })
})
