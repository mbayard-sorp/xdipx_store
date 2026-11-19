// Regression coverage for ticket #22577: two suggestions can each carry a
// pr-kind link to the SAME PR number -- one because it actually implements
// the PR, the other because it merely cited that PR number in its own prose
// and (for reasons outside this function's control) ended up with a pr-kind
// link to it too. Before this fix, resolveTicketForPr() picked whichever
// link was most recently created with no regard for which ticket the PR
// actually belongs to, so a later-filed citing ticket permanently stole the
// PR from its real implementer. Confirmed live on PR #1987: ticket #22423
// (CI-guard ticket, cited "PR #1987" as the originating incident) got a
// pr-kind link to #1987 newer than ticket #22350's own link (the ticket that
// actually opened #1987), so the engine resolved #1987 to #22423 every
// cycle -- bouncing #22423 on a false "head moved" mismatch while #22350's
// verified, mergeable PR could never resolve and merge at all.
//
// Same mocking discipline as release-engine-ticket-links-missing-index.test.ts:
// the db here is PRODUCTION, so nothing in this file may reach it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** Canned result rows for the Nth db.select(...) call, in call order. */
    responses: [] as unknown[][],
    callIndex: 0,
  }

  function chainable(result: unknown[]) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
        }
        return () => proxy
      },
    })
    return proxy
  }

  const db = {
    select: () => {
      const result = state.responses[state.callIndex] ?? []
      state.callIndex += 1
      return chainable(result)
    },
  }

  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))
vi.mock('~/lib/kv.server', () => ({
  KV_KEYS: { liveDealHandle: 'live-deal:handle' },
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
  kvSetNX: vi.fn(async () => true),
  kvDel: vi.fn(async () => undefined),
  kvIncr: vi.fn(async () => 1),
}))
vi.mock('~/lib/homepage-healthcheck.server', () => ({
  checkPageOnce: vi.fn(),
  renderTruth: vi.fn(),
}))
vi.mock('~/lib/checkout-probe.server', () => ({ checkUrl: vi.fn(), runCheckoutProbe: vi.fn() }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => null) }))
vi.mock('~/lib/owner-alerts.server', () => ({
  sendOwnerEmail: vi.fn(async () => ({ sent: false })),
  escapeHtml: (s: string) => s,
}))
vi.mock('~/lib/team.server', () => ({
  transitionSuggestion: vi.fn(),
  getTicket: vi.fn(),
  runWithOutOfBandReconcile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))
vi.mock('~/lib/release-ticket-autofile.server', () => ({
  autoFileTicketForPr: vi.fn(async () => null),
  dismissTicketsForClosedUnmergedPrs: vi.fn(async () => ({ checked: 0, dismissed: 0, errors: [] })),
}))

import { resolveTicketForPr } from '~/lib/release-engine.server'
import type { PullRequestSummary } from '~/lib/github.server'

beforeEach(() => {
  h.state.responses = []
  h.state.callIndex = 0
})

function makePr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1987,
    title: 'agents: ticket #22350: one-shot backfill to publish active products to Shop',
    state: 'open',
    nodeId: 'node-1987',
    draft: false,
    merged: false,
    mergeable: true,
    mergeableState: 'clean',
    headSha: 'd78ab3c440fcf84a8987b727a3fa75b25e0f254d',
    headRef: 'ticket/22350',
    baseRef: 'main',
    htmlUrl: 'https://github.com/mbayard-sorp/xdipx_store/pull/1987',
    labels: [],
    body: '',
    user: 'mbayard-sorp',
    updatedAt: '2026-11-16T19:54:00Z',
    ...overrides,
  }
}

describe('resolveTicketForPr: disambiguates two tickets linking the same PR number', () => {
  it('prefers the candidate whose verified head sha matches the PR, even when it is not the most recently linked', async () => {
    const pr = makePr()

    // Call 1: the direct pr-links query, most-recent-first -- the citing
    // ticket's link (#22423) sorts ahead of the real implementer's (#22350).
    h.state.responses[0] = [
      { suggestionId: 22423, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/1987' },
      { suggestionId: 22350, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/1987' },
    ]
    // Calls 2-3: loadTicketFacts(22423) -- ticket row, then its verified commit link.
    h.state.responses[1] = [{ id: 22423, status: 'in_progress', kind: 'code', attemptCount: 2, verifiedAt: '2026-11-17T11:47:03.373Z' }]
    h.state.responses[2] = [{ ref: 'f5a6bb83b9f8777bb05fbabf4ad4d3a84f739be8' }] // PR #1999's head, not #1987's
    // Calls 4-5: loadTicketFacts(22350) -- ticket row, then its verified commit link.
    h.state.responses[3] = [{ id: 22350, status: 'verified', kind: 'code', attemptCount: 1, verifiedAt: '2026-11-16T21:39:40.321Z' }]
    h.state.responses[4] = [{ ref: 'd78ab3c440fcf84a8987b727a3fa75b25e0f254d' }] // matches pr.headSha

    const facts = await resolveTicketForPr(pr)

    expect(facts?.id).toBe(22350)
    expect(facts?.status).toBe('verified')
    expect(facts?.verifiedHeadSha).toBe(pr.headSha)
  })

  it('falls back to the most-recently-linked candidate when no verified sha matches (preserves prior behavior)', async () => {
    const pr = makePr({ headSha: 'unrelated-head-sha' })

    h.state.responses[0] = [
      { suggestionId: 22423, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/1987' },
      { suggestionId: 22350, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/1987' },
    ]
    h.state.responses[1] = [{ id: 22423, status: 'in_progress', kind: 'code', attemptCount: 2, verifiedAt: null }]
    h.state.responses[2] = [{ ref: 'f5a6bb83b9f8777bb05fbabf4ad4d3a84f739be8' }]
    // The loop still checks #22350 looking for a match (none found), but
    // never needs its result once no candidate matches -- the fallback is
    // the first (most recent) candidate's already-loaded facts.
    h.state.responses[3] = [{ id: 22350, status: 'verified', kind: 'code', attemptCount: 1, verifiedAt: '2026-11-16T21:39:40.321Z' }]
    h.state.responses[4] = [{ ref: 'd78ab3c440fcf84a8987b727a3fa75b25e0f254d' }]

    const facts = await resolveTicketForPr(pr)

    expect(facts?.id).toBe(22423)
  })

  it('single-candidate case is unchanged: one pr link, one ticket, no sha comparison needed to pick it', async () => {
    const pr = makePr({ number: 1999, headSha: 'f5a6bb83b9f8777bb05fbabf4ad4d3a84f739be8' })

    h.state.responses[0] = [
      { suggestionId: 22423, ref: 'https://github.com/mbayard-sorp/xdipx_store/pull/1999' },
    ]
    h.state.responses[1] = [{ id: 22423, status: 'pr_open', kind: 'code', attemptCount: 2, verifiedAt: null }]
    h.state.responses[2] = []

    const facts = await resolveTicketForPr(pr)

    expect(facts?.id).toBe(22423)
    expect(facts?.verifiedHeadSha).toBeNull()
  })

  it('returns null when nothing links this PR number at all', async () => {
    const pr = makePr({ number: 42, title: 'chore: rebuild vercel entry artifact' })
    h.state.responses[0] = []

    const facts = await resolveTicketForPr(pr)

    expect(facts).toBeNull()
  })
})
