/**
 * Guard tests for POST /api/team/suggestion, focused on the BUS batch wiring
 * (tickets #3406, #1686, #2071, #2864): the create op must forward links and
 * supersedesId (both used to be silently dropped at exactly this layer), the
 * list op must return a total, and the retire op must forward evidence.
 *
 * team.server is mocked wholly; the behavior behind each forwarded argument is
 * covered in team-tickets.test.ts. These tests exist because the historical
 * bugs lived in the ROUTE (parseLinks never called on create, supersedesId
 * never read), so the forwarding itself is the regression surface.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSuggestionDetailed: vi.fn(async (_input?: unknown) =>
    ({ id: 1, deduped: false } as { id: number; deduped: boolean; superseded?: unknown })),
  listSuggestions: vi.fn(async (_filter?: unknown) => [] as unknown[]),
  countSuggestions: vi.fn(async (_filter?: unknown) => 0),
  agentRetireSuggestion: vi.fn(async (..._args: unknown[]) => ({ id: 1, status: 'dismissed' })),
  transitionSuggestion: vi.fn(async (..._args: unknown[]) => ({ id: 1 })),
}))

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  addSuggestionNote: vi.fn(),
  agentRetireSuggestion: mocks.agentRetireSuggestion,
  claimSuggestion: vi.fn(),
  countSuggestions: mocks.countSuggestions,
  createSuggestionDetailed: mocks.createSuggestionDetailed,
  getTicket: vi.fn(),
  rekindSuggestion: vi.fn(),
  isTeamId: (t: unknown) =>
    t === 'strategy' || t === 'homepage' || t === 'content' || t === 'social' || t === 'product',
  isTicketActor: (v: unknown) =>
    typeof v === 'string' && (v === 'owner' || v === 'auto' || v === 'system' || /^agent:[a-z0-9][a-z0-9-]{0,24}$/.test(v)),
  isTicketStatus: (v: unknown) =>
    typeof v === 'string' && ['proposed', 'approved', 'in_progress', 'pr_open', 'in_review', 'verified', 'applied', 'blocked', 'dismissed'].includes(v),
  listSuggestions: mocks.listSuggestions,
  markSuggestion: vi.fn(),
  transitionSuggestion: mocks.transitionSuggestion,
  SUGGESTION_LIST_MAX: 200,
}))

import { action } from '~/routes/api.team.suggestion'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/suggestion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockClear()
})

describe('op:create forwards links and supersedesId (#1686, #3406)', () => {
  it('passes a well-formed links array through to the create', async () => {
    mocks.createSuggestionDetailed.mockResolvedValueOnce({ id: 1683, deduped: false })
    const res = await post({
      op: 'create', team: 'content', category: 'other', kind: 'code',
      suggestion: 'x',
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/527', state: 'open' }],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1683 })
    const input = mocks.createSuggestionDetailed.mock.calls[0]![0] as Record<string, unknown>
    expect(input['links']).toEqual([
      { kind: 'pr', ref: 'https://github.com/o/r/pull/527', state: 'open' },
    ])
  })

  it('drops malformed link members but keeps valid ones (same parseLinks as transition)', async () => {
    await post({
      op: 'create', team: 'content', category: 'other', suggestion: 'x',
      links: [
        { kind: 'pr' },                      // no ref
        'not-an-object',
        { kind: 'run', ref: 'run:201' },     // valid
      ],
    })
    const input = mocks.createSuggestionDetailed.mock.calls[0]![0] as Record<string, unknown>
    expect(input['links']).toEqual([{ kind: 'run', ref: 'run:201', state: undefined }])
  })

  it('forwards supersedesId and the filing actor, and echoes the outcome', async () => {
    mocks.createSuggestionDetailed.mockResolvedValueOnce({
      id: 3405, deduped: false, superseded: { id: 3401, outcome: 'dismissed' },
    })
    const res = await post({
      op: 'create', team: 'content', category: 'bug', kind: 'code',
      suggestion: 'x', supersedesId: 3401, actor: 'agent:all-hands',
    })
    expect(await res.json()).toEqual({ id: 3405, superseded: { id: 3401, outcome: 'dismissed' } })
    const input = mocks.createSuggestionDetailed.mock.calls[0]![0] as Record<string, unknown>
    expect(input['supersedesId']).toBe(3401)
    expect(input['actor']).toBe('agent:all-hands')
  })

  it('ignores a non-numeric or non-positive supersedesId', async () => {
    await post({ op: 'create', team: 'content', category: 'bug', suggestion: 'x', supersedesId: '3401' })
    await post({ op: 'create', team: 'content', category: 'bug', suggestion: 'x', supersedesId: -1 })
    for (const call of mocks.createSuggestionDetailed.mock.calls) {
      expect((call[0] as Record<string, unknown>)['supersedesId']).toBeUndefined()
    }
  })
})

describe('op:create/transition coerce a top-level `pr` shorthand (#5054)', () => {
  it('coerces a top-level pr string on create into a pr-kind links entry', async () => {
    mocks.createSuggestionDetailed.mockResolvedValueOnce({ id: 5052, deduped: false })
    await post({
      op: 'create', team: 'content', category: 'bug', kind: 'code',
      suggestion: 'x', pr: 'https://github.com/o/r/pull/879',
    })
    const input = mocks.createSuggestionDetailed.mock.calls[0]![0] as Record<string, unknown>
    expect(input['links']).toEqual([
      { kind: 'pr', ref: 'https://github.com/o/r/pull/879', state: 'open' },
    ])
  })

  it('does not duplicate when both pr shorthand and an equal links entry are sent', async () => {
    await post({
      op: 'create', team: 'content', category: 'bug', kind: 'code', suggestion: 'x',
      pr: 'https://github.com/o/r/pull/879',
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/879', state: 'open' }],
    })
    const input = mocks.createSuggestionDetailed.mock.calls[0]![0] as Record<string, unknown>
    expect(input['links']).toEqual([
      { kind: 'pr', ref: 'https://github.com/o/r/pull/879', state: 'open' },
    ])
  })

  it('coerces a top-level pr string on transition too', async () => {
    await post({
      op: 'transition', id: 5052, to: 'pr_open', actor: 'agent:content-writer',
      pr: 'https://github.com/o/r/pull/879',
    })
    const args = mocks.transitionSuggestion.mock.calls[0]!
    expect((args[3] as Record<string, unknown>)['links']).toEqual([
      { kind: 'pr', ref: 'https://github.com/o/r/pull/879', state: 'open' },
    ])
  })

  it('ignores a non-string pr key (no link fabricated)', async () => {
    await post({
      op: 'create', team: 'content', category: 'bug', kind: 'code', suggestion: 'x',
      pr: { url: 'nope' },
    })
    const input = mocks.createSuggestionDetailed.mock.calls[0]![0] as Record<string, unknown>
    expect(input['links']).toBeUndefined()
  })
})

describe('op:list returns total (#2071)', () => {
  it('returns suggestions and the untruncated total for the same filter', async () => {
    mocks.listSuggestions.mockResolvedValueOnce([{ id: 12 }])
    mocks.countSuggestions.mockResolvedValueOnce(101)
    const res = await post({ op: 'list', status: 'approved' })
    expect(await res.json()).toEqual({ suggestions: [{ id: 12 }], total: 101 })
    // Both queries got the SAME filter, or the count lies about the list.
    expect(mocks.listSuggestions.mock.calls[0]![0]).toEqual(mocks.countSuggestions.mock.calls[0]![0])
  })
})

describe('op:retire forwards evidence (#2864)', () => {
  it('passes supersededById and satisfiedBy through, and omits evidence when absent', async () => {
    await post({
      op: 'retire', id: 2213, actor: 'agent:agent-editor', note: 'superseded',
      supersededById: 2732,
    })
    expect(mocks.agentRetireSuggestion).toHaveBeenLastCalledWith(
      2213, 'agent:agent-editor', 'superseded', { supersededById: 2732, satisfiedBy: undefined },
    )

    await post({
      op: 'retire', id: 7, actor: 'agent:agent-editor', note: 'already satisfied',
      satisfiedBy: 'docs/store-team/routine-content-daily.md#voice-gate',
    })
    expect(mocks.agentRetireSuggestion).toHaveBeenLastCalledWith(
      7, 'agent:agent-editor', 'already satisfied',
      { supersededById: undefined, satisfiedBy: 'docs/store-team/routine-content-daily.md#voice-gate' },
    )

    await post({ op: 'retire', id: 8, actor: 'agent:agent-editor', note: 'plain retire' })
    expect(mocks.agentRetireSuggestion).toHaveBeenLastCalledWith(
      8, 'agent:agent-editor', 'plain retire', undefined,
    )
  })

  it('still requires a note', async () => {
    const res = await post({ op: 'retire', id: 8, actor: 'agent:agent-editor', supersededById: 2732 })
    expect(res.status).toBe(400)
    expect(mocks.agentRetireSuggestion).not.toHaveBeenCalled()
  })
})
