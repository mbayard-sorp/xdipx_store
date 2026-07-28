// Unit tests for the ticket lifecycle in team.server.ts (070).
//
// The database here is PRODUCTION, so nothing in this file may reach it: the
// db client is mocked out entirely and every assertion is either on a pure
// function (the transition map) or on the exact SQL/patch the module would
// have sent. Same discipline as pricing-rules.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Mock the db client and KV before importing the module under test
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    /** FIFO of results handed to successive db.select() chains. */
    selects: [] as unknown[][],
    /** FIFO of results handed to successive db.update().returning() chains. */
    updates: [] as unknown[][],
    /** Every patch passed to .set(), in order. */
    patches: [] as Record<string, unknown>[],
    /** Every value array passed to .values(), in order. */
    inserts: [] as unknown[],
    execute: null as null | ((q: SQL) => Promise<{ rows: Record<string, unknown>[] }>),
  }

  /** A thenable proxy: any method returns itself, awaiting it yields result(). */
  function chain(result: () => unknown, onCall?: (m: string, args: unknown[]) => void) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(ok, err)
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args)
          return proxy
        }
      },
    }) as Record<string, unknown>
    return proxy
  }

  const db = {
    select: () => chain(() => state.selects.shift() ?? []),
    update: () => chain(
      () => state.updates.shift() ?? [],
      (m, args) => { if (m === 'set') state.patches.push(args[0] as Record<string, unknown>) },
    ),
    insert: () => chain(
      () => undefined,
      (m, args) => { if (m === 'values') state.inserts.push(args[0]) },
    ),
    execute: (q: SQL) => state.execute!(q),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))
vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _t: number, fn: () => unknown) => fn(),
  invalidateCache: () => {},
  kvDel: async () => {},
  kvGet: async () => null,
  kvSet: async () => {},
  kvSetNX: async () => false,
}))

import {
  ALLOWED,
  AGENT_EDITOR_APPLY_KINDS,
  CLAIM_LEASE_DEFAULT_SEC,
  TICKET_STATUSES,
  buildClaimQuery,
  claimSuggestion,
  expireStaleClaims,
  findTransitionRule,
  isTicketActor,
  isTransitionAllowed,
  markSuggestion,
  transitionSuggestion,
  type TicketActor,
  type TicketStatus,
} from '~/lib/team.server'

beforeEach(() => {
  h.state.selects = []
  h.state.updates = []
  h.state.patches = []
  h.state.inserts = []
  h.state.execute = null
})

const ACTORS: TicketActor[] = [
  'owner', 'auto', 'system',
  'agent:rr7-engineer', 'agent:agent-editor', 'agent:qa-reviewer', 'agent:media-manager',
]

/** Every triple the design permits when a code ticket is held by rr7-engineer. */
const ALLOWED_FOR_CODE_TICKET: Array<[TicketStatus, TicketStatus, TicketActor[]]> = [
  ['proposed',    'approved',    ['owner', 'auto']],
  ['proposed',    'dismissed',   ['owner']],
  ['approved',    'in_progress', ['agent:rr7-engineer', 'agent:agent-editor']],
  ['approved',    'dismissed',   ['owner']],
  ['in_progress', 'pr_open',     ['agent:rr7-engineer']],          // assignee only
  ['in_progress', 'blocked',     ['agent:rr7-engineer', 'system']],
  ['in_progress', 'approved',    ['system']],                       // lease expiry
  ['in_progress', 'dismissed',   ['owner']],
  ['pr_open',     'in_review',   ['agent:qa-reviewer']],
  ['pr_open',     'dismissed',   ['owner']],
  ['in_review',   'verified',    ['agent:qa-reviewer']],
  ['in_review',   'in_progress', ['agent:qa-reviewer']],            // FAIL bounce
  ['in_review',   'dismissed',   ['owner']],
  ['verified',    'applied',     ['system']],
  ['verified',    'in_progress', ['system']],                       // smoke bounce
  ['verified',    'dismissed',   ['owner']],
  ['blocked',     'approved',    ['owner', 'system']],
  ['blocked',     'dismissed',   ['owner']],
]

function lookup(
  table: Array<[TicketStatus, TicketStatus, TicketActor[]]>,
  from: TicketStatus,
  to: TicketStatus,
): TicketActor[] {
  return table.find(([f, t]) => f === from && t === to)?.[2] ?? []
}

describe('ALLOWED transition matrix', () => {
  it('permits exactly the designed triples for a code ticket held by rr7-engineer', () => {
    const ctx = { assignee: 'agent:rr7-engineer', kind: 'code' }
    const wrong: string[] = []
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        const permitted = lookup(ALLOWED_FOR_CODE_TICKET, from, to)
        for (const actor of ACTORS) {
          const want = permitted.includes(actor)
          const got = isTransitionAllowed(from, to, actor, ctx)
          if (want !== got) wrong.push(`${from} -> ${to} by ${actor}: want ${want}, got ${got}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('opens pr_open -> applied to agent-editor only, and only for its own kinds', () => {
    for (const kind of AGENT_EDITOR_APPLY_KINDS) {
      expect(isTransitionAllowed('pr_open', 'applied', 'agent:agent-editor', { kind })).toBe(true)
    }
    for (const kind of ['code', 'process', 'campaign', 'promo']) {
      expect(isTransitionAllowed('pr_open', 'applied', 'agent:agent-editor', { kind })).toBe(false)
    }
    for (const actor of ACTORS.filter(a => a !== 'agent:agent-editor')) {
      expect(isTransitionAllowed('pr_open', 'applied', actor, { kind: 'agent-def' })).toBe(false)
    }
  })

  it('gives QA no edge to applied from anywhere', () => {
    for (const from of TICKET_STATUSES) {
      for (const kind of ['code', 'agent-def', 'config', 'process']) {
        expect(isTransitionAllowed(from, 'applied', 'agent:qa-reviewer', {
          kind, assignee: 'agent:qa-reviewer',
        })).toBe(false)
      }
    }
  })

  it('reserves verified -> applied for system, so only a QA verdict can precede a release', () => {
    expect(lookup(ALLOWED_FOR_CODE_TICKET, 'verified', 'applied')).toEqual(['system'])
    // Nothing but in_review can produce `verified`, and only qa-reviewer can.
    const producers = TICKET_STATUSES.filter(from =>
      ALLOWED[from].some(r => r.to === 'verified'))
    expect(producers).toEqual(['in_review'])
    expect(ALLOWED['in_review'].find(r => r.to === 'verified')!.actors).toEqual(['agent:qa-reviewer'])
  })

  it('treats applied and dismissed as terminal', () => {
    expect(ALLOWED['applied']).toEqual([])
    expect(ALLOWED['dismissed']).toEqual([])
  })

  it('matches the assignee pseudo-actor against the row, not against a role name', () => {
    expect(isTransitionAllowed('in_progress', 'pr_open', 'agent:rr7-engineer', {
      assignee: 'agent:agent-editor',
    })).toBe(false)
    expect(isTransitionAllowed('in_progress', 'pr_open', 'agent:agent-editor', {
      assignee: 'agent:agent-editor',
    })).toBe(true)
    // An unclaimed row has no assignee, so nobody can open its PR.
    expect(isTransitionAllowed('in_progress', 'pr_open', 'agent:rr7-engineer', {
      assignee: null,
    })).toBe(false)
  })

  it('marks the two bounce edges as attempt-spending', () => {
    expect(findTransitionRule('in_review', 'in_progress', 'agent:qa-reviewer')!.incrementAttempt).toBe(true)
    expect(findTransitionRule('verified', 'in_progress', 'system')!.incrementAttempt).toBe(true)
    expect(findTransitionRule('approved', 'in_progress', 'agent:rr7-engineer')!.incrementAttempt)
      .toBeUndefined()
  })

  it('validates actor strings', () => {
    expect(isTicketActor('owner')).toBe(true)
    expect(isTicketActor('auto')).toBe(true)
    expect(isTicketActor('system')).toBe(true)
    expect(isTicketActor('agent:qa-reviewer')).toBe(true)
    expect(isTicketActor('agent:')).toBe(false)
    expect(isTicketActor('qa-reviewer')).toBe(false)
    expect(isTicketActor('agent:Robert; DROP TABLE')).toBe(false)
    expect(isTicketActor(7)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transitionSuggestion
// ---------------------------------------------------------------------------

const TICKET = {
  id: 42, status: 'in_review', kind: 'code', assignee: 'agent:rr7-engineer',
  attemptCount: 0, applyRef: null, runId: null,
}

function seedTicket(over: Record<string, unknown> = {}) {
  const row = { ...TICKET, ...over }
  h.state.selects.push([row])
  h.state.updates.push([{ ...row, status: over['status'] ?? row.status }])
  return row
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p
    return 200
  } catch (e) {
    if (e instanceof Response) return e.status
    throw e
  }
}

describe('transitionSuggestion', () => {
  it('walks an allowed edge and stamps updated_at', async () => {
    seedTicket({ status: 'in_review' })
    await transitionSuggestion(42, 'verified', 'agent:qa-reviewer', { note: 'preview renders' })
    const patch = h.state.patches[0]!
    expect(patch['status']).toBe('verified')
    expect(patch['updatedAt']).toBeInstanceOf(Date)
    expect(patch['verifiedBy']).toBe('agent:qa-reviewer')
    expect(patch['verifiedAt']).toBeInstanceOf(Date)
    // The note is durable on the ticket as a link row.
    expect(h.state.inserts[0]).toEqual([
      { suggestionId: 42, kind: 'note', ref: 'preview renders', state: 'verified' },
    ])
  })

  it('409s on a pair outside the map', async () => {
    seedTicket({ status: 'in_review' })
    expect(await status(transitionSuggestion(42, 'applied', 'agent:qa-reviewer'))).toBe(409)
    expect(h.state.patches).toEqual([])
  })

  it('409s every rejected actor on an edge that exists', async () => {
    for (const actor of ACTORS.filter(a => a !== 'agent:qa-reviewer')) {
      h.state.selects.push([{ ...TICKET, status: 'pr_open' }])
      expect(await status(transitionSuggestion(42, 'in_review', actor))).toBe(409)
    }
    expect(h.state.patches).toEqual([])
  })

  it('409s when a non-assignee agent tries to open the PR', async () => {
    h.state.selects.push([{ ...TICKET, status: 'in_progress', assignee: 'agent:agent-editor' }])
    expect(await status(transitionSuggestion(42, 'pr_open', 'agent:rr7-engineer'))).toBe(409)
  })

  it('404s on a missing ticket', async () => {
    h.state.selects.push([])
    expect(await status(transitionSuggestion(999, 'verified', 'agent:qa-reviewer'))).toBe(404)
  })

  it('409s when the row moved between the read and the write', async () => {
    h.state.selects.push([{ ...TICKET, status: 'in_review' }])
    h.state.updates.push([])   // guarded UPDATE matched nothing
    expect(await status(transitionSuggestion(42, 'verified', 'agent:qa-reviewer'))).toBe(409)
  })

  it('spends an attempt and records the reason on a QA bounce', async () => {
    seedTicket({ status: 'in_review' })
    await transitionSuggestion(42, 'in_progress', 'agent:qa-reviewer', {
      lastError: 'typecheck failed: app/lib/foo.ts(12,3)',
    })
    const patch = h.state.patches[0]!
    expect(patch['status']).toBe('in_progress')
    expect(patch['attemptCount']).toBeDefined()      // SQL increment expression
    expect(patch['lastError']).toContain('typecheck failed')
  })

  it('spends an attempt on a release-engine smoke bounce', async () => {
    seedTicket({ status: 'verified' })
    await transitionSuggestion(42, 'in_progress', 'system', { lastError: 'smoke: / returned 500' })
    expect(h.state.patches[0]!['attemptCount']).toBeDefined()
  })

  it('releases the claim whenever a ticket returns to approved', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'approved', 'system', { note: 'lease expired' })
    const patch = h.state.patches[0]!
    expect(patch['assignee']).toBeNull()
    expect(patch['claimedAt']).toBeNull()
    expect(patch['claimExpiresAt']).toBeNull()
    // A system release must not overwrite who triaged the ticket.
    expect(patch['decidedBy']).toBeUndefined()
  })

  it('records the owner as the decider on triage and on retirement', async () => {
    seedTicket({ status: 'proposed' })
    await transitionSuggestion(42, 'approved', 'owner')
    expect(h.state.patches[0]!['decidedBy']).toBe('owner')

    h.state.patches = []
    seedTicket({ status: 'verified' })
    await transitionSuggestion(42, 'dismissed', 'owner')
    expect(h.state.patches[0]!['decidedBy']).toBe('owner')
  })

  it('backfills apply_ref from the PR link when the release engine applies', async () => {
    seedTicket({ status: 'verified', applyRef: null })
    await transitionSuggestion(42, 'applied', 'system', {
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/7', state: 'merged' }],
    })
    expect(h.state.patches[0]!['applyRef']).toBe('https://github.com/o/r/pull/7')
    expect(h.state.inserts[0]).toEqual([
      { suggestionId: 42, kind: 'pr', ref: 'https://github.com/o/r/pull/7', state: 'merged' },
    ])
  })

  it('does not clobber an existing apply_ref', async () => {
    seedTicket({ status: 'verified', applyRef: 'https://github.com/o/r/pull/1' })
    await transitionSuggestion(42, 'applied', 'system', {
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/7' }],
    })
    expect(h.state.patches[0]!['applyRef']).toBeUndefined()
  })

  it('rejects a bad actor before touching the database', async () => {
    expect(await status(transitionSuggestion(42, 'verified', 'qa-reviewer' as TicketActor))).toBe(400)
    expect(h.state.selects).toEqual([])
  })
})

describe('the ticket walks the full dev loop', () => {
  it('approved -> in_progress -> pr_open -> in_review -> verified -> applied', async () => {
    const steps: Array<[TicketStatus, TicketStatus, TicketActor]> = [
      ['approved',    'in_progress', 'agent:rr7-engineer'],
      ['in_progress', 'pr_open',     'agent:rr7-engineer'],
      ['pr_open',     'in_review',   'agent:qa-reviewer'],
      ['in_review',   'verified',    'agent:qa-reviewer'],
      ['verified',    'applied',     'system'],
    ]
    for (const [from, to, actor] of steps) {
      h.state.patches = []
      seedTicket({ status: from, kind: 'code', assignee: 'agent:rr7-engineer' })
      await transitionSuggestion(42, to, actor)
      expect(h.state.patches[0]!['status']).toBe(to)
    }
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility: agent-editor's legacy markSuggestion path
// ---------------------------------------------------------------------------

describe('markSuggestion (legacy agent-editor path)', () => {
  it('still runs approved -> pr_open -> applied end to end', async () => {
    h.state.updates.push([{ id: 7 }])
    await markSuggestion(7, 'pr_open', 'https://github.com/o/r/pull/7')
    expect(h.state.patches[0]).toMatchObject({
      status: 'pr_open', applyRef: 'https://github.com/o/r/pull/7',
    })

    h.state.updates.push([{ id: 7 }])
    await markSuggestion(7, 'applied', 'https://github.com/o/r/pull/7')
    expect(h.state.patches[1]).toMatchObject({ status: 'applied' })
    // No pre-read: the legacy path is still a single guarded UPDATE.
    expect(h.state.selects).toEqual([])
  })

  it('still 409s when the row is not in the expected status', async () => {
    h.state.updates.push([])
    expect(await status(markSuggestion(7, 'applied', 'ref'))).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// Lease expiry
// ---------------------------------------------------------------------------

describe('expireStaleClaims', () => {
  it('returns expired in_progress rows to the unassigned queue', async () => {
    h.state.updates.push([{ id: 1 }, { id: 2 }])
    const n = await expireStaleClaims()
    expect(n).toBe(2)
    expect(h.state.patches[0]).toMatchObject({
      status: 'approved', assignee: null, claimedAt: null, claimExpiresAt: null,
    })
    expect(h.state.patches[0]!['updatedAt']).toBeInstanceOf(Date)
  })

  it('leaves attempt_count alone: a dead sandbox is not a failed fix attempt', async () => {
    h.state.updates.push([])
    await expireStaleClaims()
    expect(h.state.patches[0]!['attemptCount']).toBeUndefined()
    expect(h.state.patches[0]!['lastError']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function render(query: SQL): { text: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(query)
  return { text: q.sql.replace(/\s+/g, ' ').trim(), params: q.params }
}

interface SimRow { id: number; status: string; priority: number; created: number; assignee: string | null }

/**
 * Stands in for Postgres executing the claim statement: the row pick and the
 * write happen with no await between them (that is what a single statement
 * with FOR UPDATE SKIP LOCKED buys), and the round trip resolves a tick later.
 * A read-then-write implementation would call this twice and hand both callers
 * the same row.
 */
function claimSim(rows: SimRow[], calls: { n: number }) {
  return async (query: SQL) => {
    calls.n++
    const { params } = render(query)
    const assignee = String(params[0])
    const picked = rows
      .filter(r => r.status === 'approved')
      .sort((a, b) => a.priority - b.priority || a.created - b.created)[0]
    if (picked) {
      picked.status = 'in_progress'
      picked.assignee = assignee
    }
    await new Promise(r => setTimeout(r, 0))
    return { rows: picked ? [{ id: picked.id }] : [] }
  }
}

describe('buildClaimQuery', () => {
  const base = { assignee: 'agent:rr7-engineer' as TicketActor, leaseSeconds: 1200, from: 'approved' as TicketStatus, filter: {} }

  it('is one atomic statement with FOR UPDATE SKIP LOCKED', () => {
    const { text } = render(buildClaimQuery(base))
    expect(text.toLowerCase()).toContain('for update skip locked')
    expect(text.toLowerCase().startsWith('update homepage_team_suggestions')).toBe(true)
    expect(text).not.toContain(';')          // no multi-statement round trip
    expect(text.toLowerCase()).toContain("set status = 'in_progress'")
  })

  it('picks by priority then age', () => {
    const { text } = render(buildClaimQuery(base))
    expect(text.toLowerCase()).toContain('order by c.priority asc, c.created_at asc limit 1')
  })

  it('skips rows under a live lease but reclaims expired ones', () => {
    const { text } = render(buildClaimQuery(base))
    expect(text).toContain('c.claim_expires_at IS NULL OR c.claim_expires_at < now()')
  })

  it('binds every filter as a parameter, never as interpolated SQL', () => {
    const { text, params } = render(buildClaimQuery({
      ...base, filter: { kind: 'code', team: 'homepage' }, id: 9,
    }))
    expect(params).toContain('code')
    expect(params).toContain('homepage')
    expect(params).toContain(9)
    expect(text).not.toContain('code')
  })
})

describe('claimSuggestion', () => {
  it('hands two concurrent claimers different tickets', async () => {
    const rows: SimRow[] = [
      { id: 1, status: 'approved', priority: 1, created: 100, assignee: null },
      { id: 2, status: 'approved', priority: 2, created: 200, assignee: null },
      { id: 3, status: 'approved', priority: 3, created: 300, assignee: null },
    ]
    const calls = { n: 0 }
    const exec = claimSim(rows, calls)
    const [a, b] = await Promise.all([
      claimSuggestion({ assignee: 'agent:rr7-engineer', filter: { kind: 'code' } }, exec),
      claimSuggestion({ assignee: 'agent:agent-editor', filter: { kind: 'code' } }, exec),
    ])
    expect(a).toEqual({ empty: false, id: 1 })     // priority order
    expect(b).toEqual({ empty: false, id: 2 })
    expect(calls.n).toBe(2)                        // exactly one statement each
    expect(rows[2]!.status).toBe('approved')
  })

  it('reports an empty queue instead of failing', async () => {
    const exec = claimSim([], { n: 0 })
    expect(await claimSuggestion({ assignee: 'agent:rr7-engineer' }, exec)).toEqual({ empty: true })
  })

  it('refuses an actor with no claim edge', async () => {
    const exec = vi.fn()
    expect(await status(claimSuggestion({ assignee: 'agent:qa-reviewer' }, exec as never))).toBe(409)
    expect(exec).not.toHaveBeenCalled()
  })

  it('refuses to claim out of a status the map does not allow', async () => {
    const exec = vi.fn()
    expect(await status(claimSuggestion(
      { assignee: 'agent:rr7-engineer', filter: { status: 'pr_open' } },
      exec as never,
    ))).toBe(409)
    expect(exec).not.toHaveBeenCalled()
  })

  it('rejects a malformed actor', async () => {
    const exec = vi.fn()
    expect(await status(claimSuggestion({ assignee: 'rr7-engineer' as TicketActor }, exec as never))).toBe(400)
  })

  it('defaults and clamps the lease', async () => {
    const seen: unknown[][] = []
    const exec = async (q: SQL) => { seen.push(render(q).params); return { rows: [] } }
    await claimSuggestion({ assignee: 'agent:rr7-engineer' }, exec)
    expect(seen[0]![1]).toBe(CLAIM_LEASE_DEFAULT_SEC)
    await claimSuggestion({ assignee: 'agent:rr7-engineer', leaseSeconds: 5 }, exec)
    expect(seen[1]![1]).toBe(60)
    await claimSuggestion({ assignee: 'agent:rr7-engineer', leaseSeconds: 999_999 }, exec)
    expect(seen[2]![1]).toBe(6 * 3600)
  })
})
