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
    /** Every predicate passed to an update's .where(), in order. */
    updateWheres: [] as unknown[],
    /** Every value array passed to .values(), in order. */
    inserts: [] as unknown[],
    /** FIFO of results handed to successive db.insert() chains. */
    insertResults: [] as unknown[][],
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
      (m, args) => {
        if (m === 'set') state.patches.push(args[0] as Record<string, unknown>)
        if (m === 'where') state.updateWheres.push(args[0])
      },
    ),
    insert: () => chain(
      () => state.insertResults.shift() ?? [],
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
  AGENT_EVIDENCE_RETIRE_KINDS,
  BOUNCE_LEASE_SEC,
  CLAIM_LEASE_DEFAULT_SEC,
  TICKET_STATUSES,
  buildClaimQuery,
  claimSuggestion,
  createSuggestionDetailed,
  expireStaleClaims,
  findTransitionRule,
  isTicketActor,
  isTransitionAllowed,
  agentRetireSuggestion,
  countSuggestions,
  markSuggestion,
  normalizeTicketKind,
  parseSupersessionRef,
  resolveListOrder,
  runWithOutOfBandReconcile,
  transitionSuggestion,
  KNOWN_TICKET_KINDS,
  AGENT_RETIRE_KINDS,
  DETECTOR_SELF_CLOSE_KINDS,
  REKIND_FROM_KINDS,
  REKIND_TO_KINDS,
  RUN_CLOSE_ACTORS,
  RUN_CLOSE_KINDS,
  type TicketActor,
  type TicketStatus,
} from '~/lib/team.server'

beforeEach(() => {
  h.state.selects = []
  h.state.updates = []
  h.state.patches = []
  h.state.updateWheres = []
  h.state.inserts = []
  h.state.insertResults = []
  h.state.execute = null
})

const ACTORS: TicketActor[] = [
  'owner', 'auto', 'system',
  'agent:rr7-engineer', 'agent:agent-editor', 'agent:qa-reviewer', 'agent:media-manager',
]

/**
 * Every triple the design permits when a code ticket is held by rr7-engineer
 * and the call is a PLAIN transition (no reconcile declaration). The four
 * out-of-band `-> applied` reconcile edges are deliberately absent: they are
 * `outOfBandReconcileOnly` in the map, so a plain call cannot see them.
 */
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
  // ADR-008 step 2: the abandoned-PR sweep retires an auto-filed ticket whose
  // PR was closed unmerged. `system` here is dismissTicketsForClosedUnmergedPrs
  // and nothing else; it restricts itself to rows whose dedupe_key starts with
  // `autofile:pr-`, which the matrix cannot express. Terminal and ships nothing.
  ['pr_open',     'dismissed',   ['owner', 'system']],
  ['in_review',   'verified',    ['agent:qa-reviewer']],
  ['in_review',   'in_progress', ['agent:qa-reviewer']],            // FAIL bounce
  ['in_review',   'dismissed',   ['owner']],
  ['verified',    'applied',     ['system']],
  ['verified',    'in_progress', ['system']],                       // smoke bounce
  ['verified',    'dismissed',   ['owner']],
  ['blocked',     'approved',    ['owner', 'system']],
  ['blocked',     'dismissed',   ['owner']],
]

/**
 * The fence on the out-of-band merged-PR reconcile edges. These four triples,
 * and ONLY these four, open up when the caller carries the reconcile
 * declaration (`viaOutOfBandReconcile` in TransitionOpts, or an enclosing
 * `runWithOutOfBandReconcile`). The declaration is an in-process signal the
 * team HTTP API does not forward, so at the map level a plain `system`
 * transition, from any present or future call site, cannot close an
 * approved/blocked/pr_open/in_review ticket; the sweeps that HAVE asked GitHub
 * and seen `merged: true` are the only callers that can.
 *
 * Why the edges exist at all: a hand-merged PR strands its ticket wherever it
 * stood (tickets #120/#423 in approved with PRs #436/#429 merged, #455
 * blocked with PR #508 merged, #291/#323/#441 in pr_open/in_review).
 */
const RECONCILE_ONLY_EDGES: Array<[TicketStatus, TicketStatus, TicketActor[]]> = [
  ['approved',  'applied', ['system']],
  ['pr_open',   'applied', ['system']],
  ['in_review', 'applied', ['system']],
  ['blocked',   'applied', ['system']],
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

  // The fence, proven exhaustively: the reconcile declaration adds exactly the
  // four RECONCILE_ONLY_EDGES to the plain matrix and nothing else, so it
  // cannot be used as a skeleton key for any other edge or actor.
  it('unlocks exactly the four reconcile edges under the reconcile declaration', () => {
    const ctx = { assignee: 'agent:rr7-engineer', kind: 'code', viaOutOfBandReconcile: true }
    const wrong: string[] = []
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        const permitted = [
          ...lookup(ALLOWED_FOR_CODE_TICKET, from, to),
          ...lookup(RECONCILE_ONLY_EDGES, from, to),
        ]
        for (const actor of ACTORS) {
          const want = permitted.includes(actor)
          const got = isTransitionAllowed(from, to, actor, ctx)
          if (want !== got) wrong.push(`${from} -> ${to} by ${actor}: want ${want}, got ${got}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('opens pr_open -> applied to agent-editor (own kinds) and the declared reconciler only', () => {
    for (const kind of AGENT_EDITOR_APPLY_KINDS) {
      expect(isTransitionAllowed('pr_open', 'applied', 'agent:agent-editor', { kind })).toBe(true)
    }
    for (const kind of ['code', 'process', 'campaign', 'promo']) {
      expect(isTransitionAllowed('pr_open', 'applied', 'agent:agent-editor', { kind })).toBe(false)
    }
    // `system` here is the out-of-band sweep, and unlike agent-editor it is not
    // fenced by kind: a hand-merged PR strands a ticket of any kind, and the
    // sweep only ever acts on a PR GitHub reports as already merged. What
    // fences it instead is the reconcile declaration: a plain system call gets
    // nothing, on any kind.
    for (const kind of [...AGENT_EDITOR_APPLY_KINDS, 'code', 'process']) {
      expect(isTransitionAllowed('pr_open', 'applied', 'system', { kind })).toBe(false)
      expect(isTransitionAllowed('in_review', 'applied', 'system', { kind })).toBe(false)
      expect(isTransitionAllowed('pr_open', 'applied', 'system', { kind, viaOutOfBandReconcile: true })).toBe(true)
      expect(isTransitionAllowed('in_review', 'applied', 'system', { kind, viaOutOfBandReconcile: true })).toBe(true)
    }
    const others = ACTORS.filter(a => a !== 'agent:agent-editor' && a !== 'system')
    for (const actor of others) {
      expect(isTransitionAllowed('pr_open', 'applied', actor, { kind: 'agent-def' })).toBe(false)
      expect(isTransitionAllowed('in_review', 'applied', actor, { kind: 'agent-def' })).toBe(false)
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

  // The release engine's exhausted-ticket sweep queries `status = 'in_progress'`
  // and nothing else, because that is the only status `system` can block from.
  // If the map ever grows another `-> blocked` edge, the sweep silently stops
  // covering it, so pin the fact here rather than in a comment over there.
  it('lets system block only from in_progress, which is what the sweep relies on', () => {
    const blockable = TICKET_STATUSES.filter(from =>
      ALLOWED[from].some(r => r.to === 'blocked' && r.actors.includes('system')))
    expect(blockable).toEqual(['in_progress'])
  })

  // Both bounce edges land in in_progress, so an exhausted ticket is always
  // sitting where the sweep can reach it.
  it('lands every attempt-spending bounce in in_progress', () => {
    for (const from of TICKET_STATUSES) {
      for (const rule of ALLOWED[from]) {
        if (rule.incrementAttempt) expect(rule.to).toBe('in_progress')
      }
    }
  })

  it('lets a daily run close an operational row it acted on, and nothing else', () => {
    for (const kind of RUN_CLOSE_KINDS) {
      for (const actor of RUN_CLOSE_ACTORS) {
        expect(isTransitionAllowed('approved', 'applied', actor, { kind })).toBe(true)
      }
    }
    // Not a lane a run may close: code goes through QA and the release engine.
    for (const kind of ['code', 'instructions', 'agent-def', 'config', 'program']) {
      expect(isTransitionAllowed('approved', 'applied', 'agent:homepage-orchestrator', { kind }))
        .toBe(false)
    }
    // Only the named entry agents, and only from `approved`.
    expect(isTransitionAllowed('approved', 'applied', 'agent:media-manager', { kind: 'process' }))
      .toBe(false)
    for (const from of TICKET_STATUSES.filter(s => s !== 'approved')) {
      expect(isTransitionAllowed(from, 'applied', 'agent:homepage-orchestrator', { kind: 'process' }))
        .toBe(false)
    }
  })

  it('fences agent-editor retirement to the kinds with no executor', () => {
    for (const kind of AGENT_RETIRE_KINDS) {
      expect(isTransitionAllowed('approved', 'dismissed', 'agent:agent-editor', { kind })).toBe(true)
    }
    // Its own work queue stays out of reach: agent-editor must not be able to
    // dismiss the instruction rows that constrain agent-editor.
    for (const kind of ['instructions', 'agent-def', 'config', 'code']) {
      expect(isTransitionAllowed('approved', 'dismissed', 'agent:agent-editor', { kind })).toBe(false)
    }
    for (const actor of ACTORS.filter(a => a !== 'agent:agent-editor' && a !== 'owner')) {
      expect(isTransitionAllowed('approved', 'dismissed', actor, { kind: 'process' })).toBe(false)
    }
  })

  it('keeps rekind one-way so it cannot compose with retire into a kill switch', () => {
    // The dangerous shape would be: rekind an inconvenient `instructions` row
    // to `process`, then retire it under AGENT_RETIRE_KINDS. Closed by making
    // `process` the only source and excluding retirable kinds as targets.
    expect(REKIND_FROM_KINDS).toEqual(['process'])
    for (const target of REKIND_TO_KINDS) {
      expect(AGENT_RETIRE_KINDS).not.toContain(target)
    }
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

  // A bounce used to leave claim_expires_at at whatever the original claim set,
  // hours in the past. expireStaleClaims() then reaped the row to `approved`
  // and cleared the assignee — and because that sweep runs inside gate(), the
  // 20:00 dev pass's own gate call emptied the bounced queue it then went
  // looking for. The renewal is what makes "claim bounced tickets first" real.
  it('renews the assignee lease on a QA bounce so the next dev pass still holds it', async () => {
    seedTicket({ status: 'in_review' })
    const before = Date.now()
    await transitionSuggestion(42, 'in_progress', 'agent:qa-reviewer', { lastError: 'tests red' })
    const patch = h.state.patches[0]!
    expect(patch['claimedAt']).toBeInstanceOf(Date)
    const expires = patch['claimExpiresAt'] as Date
    expect(expires).toBeInstanceOf(Date)
    expect(expires.getTime()).toBeGreaterThanOrEqual(before + BOUNCE_LEASE_SEC * 1000)
  })

  it('renews the lease on a release-engine bounce too', async () => {
    seedTicket({ status: 'verified' })
    await transitionSuggestion(42, 'in_progress', 'system', { lastError: 'smoke: / returned 500' })
    expect(h.state.patches[0]!['claimExpiresAt']).toBeInstanceOf(Date)
  })

  // Nothing to hold: granting a lease with a null assignee would create a row
  // that neither an agent owns nor the reaper can free on schedule.
  it('grants no lease when the bounced row has no assignee', async () => {
    seedTicket({ status: 'in_review', assignee: null })
    await transitionSuggestion(42, 'in_progress', 'agent:qa-reviewer', { lastError: 'tests red' })
    const patch = h.state.patches[0]!
    expect(patch['claimExpiresAt']).toBeUndefined()
    expect(patch['claimedAt']).toBeUndefined()
  })

  it('still clears the lease when a ticket goes the other way, to approved', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'approved', 'system', { note: 'lease expired' })
    expect(h.state.patches[0]!['claimExpiresAt']).toBeNull()
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

  // #878. SQL NULL never satisfies `<`, so filtering on claim_expires_at alone
  // skipped a NULL-lease row on every sweep, forever. That state is reachable:
  // the QA bounce edge renews the lease only `if (row.assignee)`, so bouncing a
  // row whose assignee an earlier reap had cleared lands it in `in_progress`
  // with no lease and no holder. Tickets #120, #423 and #471 sat there six days,
  // invisible to this sweep and to both executors, which claim from `approved`.
  it('treats a NULL lease as already expired', async () => {
    h.state.updates.push([{ id: 120 }])
    await expireStaleClaims()
    const { text } = render(h.state.updateWheres[0] as SQL)
    expect(text).toContain('"claim_expires_at" is null')
    expect(text).toContain('"claim_expires_at" <')
    // Both lease conditions are alternatives, and the status fence still binds.
    expect(text).toMatch(/or/i)
    expect(text).toContain('"status" =')
  })

  it('only ever reaps in_progress rows', async () => {
    h.state.updates.push([])
    await expireStaleClaims()
    const { params } = render(h.state.updateWheres[0] as SQL)
    expect(params).toContain('in_progress')
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

/**
 * The detector self-close edge. A detector that raised an alarm may close it
 * when the condition it reported has demonstrably cleared, without a human and
 * without going around the map.
 *
 * The reason it has to exist at all: the uniqueness index on dedupe_key excludes
 * only `applied` and `dismissed`, so an open sameness row holds its undated key
 * and the detector can never file for that slot again. Four homepage freshness
 * slots were muted exactly that way. Before this edge, the healthcheck reached
 * `applied` with a bulk db.update that walked two transitions ALLOWED forbids.
 */
describe('detector self-close edge', () => {
  it('lets system close a process row from both proposed and approved', () => {
    // Both, because a team without auto-approve leaves detector rows at
    // `proposed`, and a held key mutes the slot the same either way.
    expect(isTransitionAllowed('proposed', 'applied', 'system', { kind: 'process' })).toBe(true)
    expect(isTransitionAllowed('approved', 'applied', 'system', { kind: 'process' })).toBe(true)
  })

  it('fences the edge to process at proposed, so it cannot close work with a real executor', () => {
    for (const kind of ['code', 'instructions', 'agent-def', 'config', 'strategy']) {
      expect(isTransitionAllowed('proposed', 'applied', 'system', { kind })).toBe(false)
    }
    expect(DETECTOR_SELF_CLOSE_KINDS).toEqual(['process'])
    // At `approved` other kinds are reachable only through a DIFFERENT rule:
    // the out-of-band merged-PR reconcile edge, which demands the reconcile
    // declaration on top of the system actor. A plain system call, which is
    // all a detector ever makes, still closes nothing but `process`.
    for (const kind of ['code', 'strategy']) {
      expect(isTransitionAllowed('approved', 'applied', 'system', { kind })).toBe(false)
      expect(isTransitionAllowed('approved', 'applied', 'system', { kind, viaOutOfBandReconcile: true }))
        .toBe(true)
    }
  })

  it('grants the edge to system only', () => {
    for (const actor of ACTORS.filter(a => a !== 'system')) {
      expect(isTransitionAllowed('proposed', 'applied', actor, { kind: 'process' })).toBe(false)
    }
  })

  it('does not widen RUN_CLOSE_ACTORS as a side effect', () => {
    // Adding 'system' there would have been the smaller diff. The reconcile
    // edge does let `system` close a strategy row from `approved`, but only
    // under the reconcile declaration the sweep earns with a `merged: true`
    // from GitHub (enforced by the map via `outOfBandReconcileOnly`); the
    // run-close lane itself stays fenced to the named entry agents.
    expect(RUN_CLOSE_ACTORS).not.toContain('system')
    for (const actor of RUN_CLOSE_ACTORS) {
      expect(isTransitionAllowed('approved', 'applied', actor, { kind: 'code' })).toBe(false)
    }
  })

  it('leaves applied terminal', () => {
    expect(ALLOWED['applied']).toEqual([])
  })
})

/**
 * #455. A `blocked` row still owns its dedupe_key — the partial-unique index
 * excludes only `applied` and `dismissed` — and `blocked` has no edge any agent
 * can walk. So a condition that recurs while its ticket is blocked was filed
 * into silence: the browser checkout probe failed five days running and every
 * one of those filings was swallowed by one three-day-old blocked row.
 *
 * The fix drives the blocked -> approved `system` edge the map already permits
 * and attaches the fresh evidence, so the same ticket comes back on the board.
 */
describe('a repeat observation reopens a blocked ticket', () => {
  /** Queue the reads createSuggestionDetailed makes before the dedupe branch. */
  function primeDedupeHit(liveRow: { id: number; status: string }) {
    // 1) getTeamConfigUncached reads pipeline_settings, 2) insert is swallowed
    // by the unique index, 3) the dedupe lookup finds the live row.
    h.state.selects.push([{ key: 'strategy_team_enabled', value: 'true' }])
    h.state.insertResults.push([])
    h.state.selects.push([liveRow])
  }

  it('walks blocked -> approved and records the new evidence', async () => {
    primeDedupeHit({ id: 142, status: 'blocked' })
    // transitionSuggestion re-reads the row, then writes it.
    h.state.selects.push([{ id: 142, status: 'blocked', assignee: null, kind: 'code' }])
    h.state.updates.push([{ id: 142, status: 'approved' }])

    const res = await createSuggestionDetailed({
      team: 'strategy', category: 'other', kind: 'code',
      suggestion: 'browser tier FAIL again, failed_step probe-crash',
      dedupeKey: 'probe:browser:probe-crash',
    })

    expect(res).toEqual({ id: 142, deduped: true })
    expect(h.state.patches.at(-1)).toMatchObject({ status: 'approved' })
  })

  it('leaves a non-blocked live row exactly where it is', async () => {
    primeDedupeHit({ id: 900, status: 'in_progress' })
    const res = await createSuggestionDetailed({
      team: 'strategy', category: 'other', kind: 'code',
      suggestion: 'same condition, someone is already on it',
      dedupeKey: 'probe:browser:probe-crash',
    })
    expect(res).toEqual({ id: 900, deduped: true })
    // No reopen: nothing was written.
    expect(h.state.patches).toEqual([])
  })

  it('never fails the caller when the reopen loses a race', async () => {
    primeDedupeHit({ id: 142, status: 'blocked' })
    // The row moved off `blocked` between the lookup and the transition, so
    // transitionSuggestion 409s. A detector filing a routine observation must
    // still get its answer.
    h.state.selects.push([{ id: 142, status: 'applied', assignee: null, kind: 'code' }])

    await expect(createSuggestionDetailed({
      team: 'strategy', category: 'other', kind: 'code',
      suggestion: 'condition observed again',
      dedupeKey: 'probe:browser:probe-crash',
    })).resolves.toEqual({ id: 142, deduped: true })
  })

  it('reports a clean miss as not deduped', async () => {
    h.state.selects.push([{ key: 'strategy_team_enabled', value: 'true' }])
    h.state.insertResults.push([])
    h.state.selects.push([])
    const res = await createSuggestionDetailed({
      team: 'strategy', category: 'other', kind: 'code',
      suggestion: 'no live row owns this key',
      dedupeKey: 'probe:browser:gone',
    })
    expect(res).toEqual({ id: 0, deduped: false })
  })

  it('blocked -> approved by system is what the map already allowed', () => {
    expect(isTransitionAllowed('blocked', 'approved', 'system', { kind: 'code' })).toBe(true)
    // And it is still not something an agent can walk on its own.
    expect(isTransitionAllowed('blocked', 'approved', 'agent:rr7-engineer', { kind: 'code' })).toBe(false)
  })
})

/**
 * The two out-of-band merged-PR reconcile edges: `approved -> applied` and
 * `blocked -> applied`, system only. They close the orphan class where a
 * hand-merged PR leaves its ticket on the unassigned queue or in the blocked
 * count forever (tickets #120/#423 in approved with PRs #436/#429 merged,
 * ticket #455 blocked with PR #508 merged).
 *
 * THE FENCE. `applied` means "the fix is live on xdipx.com", and the sweep
 * earns that claim by asking GitHub and getting `merged: true` back. That
 * precondition used to live only in the sweep's own code, so at the map level
 * any present or future `system` transition could have closed an
 * approved/blocked ticket of any kind. Now the edges are
 * `outOfBandReconcileOnly`: they open only to a call that declares itself the
 * reconcile path, either `viaOutOfBandReconcile` in TransitionOpts (the
 * engine's orphan sweep, which passes it right after the merged check) or an
 * enclosing `runWithOutOfBandReconcile` (how the engine wraps
 * ticket-out-of-band-sweep.server.ts, whose own pr_open/in_review edges got
 * the same fence). The declaration is in-process only; the
 * /api/team/suggestion transition op does not forward it, so the HTTP surface
 * cannot cross the fence at all.
 */
describe('out-of-band reconcile edges (approved/blocked -> applied)', () => {
  it('rejects a plain system transition on both edges for every kind except the detector carve-out', () => {
    for (const kind of ['code', 'instructions', 'agent-def', 'config', 'strategy', 'campaign']) {
      expect(isTransitionAllowed('approved', 'applied', 'system', { kind })).toBe(false)
    }
    // `blocked` has no detector edge, so there the plain rejection really is
    // every kind, `process` included.
    for (const kind of ['code', 'instructions', 'strategy', 'process']) {
      expect(isTransitionAllowed('blocked', 'applied', 'system', { kind })).toBe(false)
    }
  })

  it('grants both edges to a declared reconciler for any kind', () => {
    for (const kind of ['code', 'process', 'instructions', 'strategy']) {
      expect(isTransitionAllowed('approved', 'applied', 'system', { kind, viaOutOfBandReconcile: true }))
        .toBe(true)
      expect(isTransitionAllowed('blocked', 'applied', 'system', { kind, viaOutOfBandReconcile: true }))
        .toBe(true)
    }
  })

  it('rejects every non-system actor on both edges, declared or not', () => {
    for (const actor of ACTORS.filter(a => a !== 'system')) {
      expect(isTransitionAllowed('approved', 'applied', actor, { kind: 'code' })).toBe(false)
      expect(isTransitionAllowed('blocked', 'applied', actor, { kind: 'code' })).toBe(false)
      // The declaration widens nothing for anyone but system.
      expect(isTransitionAllowed('approved', 'applied', actor, { kind: 'code', viaOutOfBandReconcile: true }))
        .toBe(false)
      expect(isTransitionAllowed('blocked', 'applied', actor, { kind: 'code', viaOutOfBandReconcile: true }))
        .toBe(false)
    }
    // Including the assignee holding the claim: reconcile is never an agent move.
    expect(isTransitionAllowed('blocked', 'applied', 'agent:rr7-engineer', {
      kind: 'code', assignee: 'agent:rr7-engineer',
    })).toBe(false)
  })

  it('409s a plain system transitionSuggestion on an approved or blocked row of any kind', async () => {
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    expect(await status(transitionSuggestion(42, 'applied', 'system'))).toBe(409)
    h.state.selects.push([{ ...TICKET, status: 'blocked', kind: 'strategy' }])
    expect(await status(transitionSuggestion(42, 'applied', 'system'))).toBe(409)
    // `blocked` + `process` too: the detector carve-out exists only at
    // proposed/approved, so nothing plain closes a blocked row.
    h.state.selects.push([{ ...TICKET, status: 'blocked', kind: 'process' }])
    expect(await status(transitionSuggestion(42, 'applied', 'system'))).toBe(409)
    expect(h.state.patches).toEqual([])
  })

  it('walks the sweep call shape (flag + merged PR link) and backfills apply_ref', async () => {
    seedTicket({ status: 'blocked', applyRef: null })
    await transitionSuggestion(42, 'applied', 'system', {
      note: "merged out-of-band while 'blocked'",
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/508', state: 'merged' }],
      viaOutOfBandReconcile: true,
    })
    expect(h.state.patches[0]).toMatchObject({ status: 'applied' })
    expect(h.state.patches[0]!['applyRef']).toBe('https://github.com/o/r/pull/508')

    h.state.patches = []
    seedTicket({ status: 'approved', kind: 'strategy', applyRef: null })
    await transitionSuggestion(42, 'applied', 'system', {
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/436', state: 'merged' }],
      viaOutOfBandReconcile: true,
    })
    expect(h.state.patches[0]).toMatchObject({ status: 'applied' })
  })

  it('honours the ambient runWithOutOfBandReconcile scope for sweep code that cannot pass options', async () => {
    // ticket-out-of-band-sweep.server.ts calls transitionSuggestion plainly;
    // the engine wraps that whole sweep, and the scope must carry through to
    // the fenced pr_open/in_review edges it walks.
    seedTicket({ status: 'pr_open', kind: 'code' })
    await runWithOutOfBandReconcile(() => transitionSuggestion(42, 'applied', 'system'))
    expect(h.state.patches[0]).toMatchObject({ status: 'applied' })

    // And the scope does not leak: the same plain call outside it is a 409.
    h.state.patches = []
    h.state.selects.push([{ ...TICKET, status: 'pr_open', kind: 'code' }])
    expect(await status(transitionSuggestion(42, 'applied', 'system'))).toBe(409)
    expect(h.state.patches).toEqual([])
  })

  it('keeps the detector self-close for kind process working exactly as before', async () => {
    // Plain system call, no flag, no scope: the DETECTOR_SELF_CLOSE_KINDS rule
    // still matches at proposed and approved for `process` rows.
    seedTicket({ status: 'approved', kind: 'process', assignee: null })
    await transitionSuggestion(42, 'applied', 'system', { note: 'condition cleared' })
    expect(h.state.patches[0]).toMatchObject({ status: 'applied' })

    h.state.patches = []
    seedTicket({ status: 'proposed', kind: 'process', assignee: null })
    await transitionSuggestion(42, 'applied', 'system')
    expect(h.state.patches[0]).toMatchObject({ status: 'applied' })
  })

  it('409s a non-system actor attempting the reconcile through the API', async () => {
    h.state.selects.push([{ ...TICKET, status: 'approved' }])
    expect(await status(transitionSuggestion(42, 'applied', 'agent:agent-editor'))).toBe(409)
    h.state.selects.push([{ ...TICKET, status: 'blocked' }])
    expect(await status(transitionSuggestion(42, 'applied', 'owner'))).toBe(409)
    expect(h.state.patches).toEqual([])
  })
})

/**
 * Auto-stamped last_error on a reasonless block. Ten of the eleven blocked
 * rows on 2026-08-05 carried an empty last_error, so the digest had nothing
 * to flag and the owner nothing to act on.
 */
describe('blocked transitions auto-stamp a missing reason', () => {
  it('stamps last_error when neither a note nor a lastError was given', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'blocked', 'system')
    expect(h.state.patches[0]!['lastError']).toBe('blocked without stated reason by system')
  })

  it('names the actual actor in the stamp', async () => {
    seedTicket({ status: 'in_progress', assignee: 'agent:rr7-engineer' })
    await transitionSuggestion(42, 'blocked', 'agent:rr7-engineer')
    expect(h.state.patches[0]!['lastError']).toBe('blocked without stated reason by agent:rr7-engineer')
  })

  it('treats an empty or whitespace-only reason as missing', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'blocked', 'system', { lastError: '   ', note: '' })
    expect(h.state.patches[0]!['lastError']).toBe('blocked without stated reason by system')
  })

  it('never overwrites a real lastError', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'blocked', 'system', { lastError: 'smoke: / returned 500' })
    expect(h.state.patches[0]!['lastError']).toBe('smoke: / returned 500')
  })

  it('counts a note as a stated reason and leaves lastError alone', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'blocked', 'system', { note: 'waiting on a Shopify scope change' })
    expect(h.state.patches[0]!['lastError']).toBeUndefined()
  })

  it('never rejects the transition over the missing reason', async () => {
    seedTicket({ status: 'in_progress' })
    expect(await status(transitionSuggestion(42, 'blocked', 'system'))).toBe(200)
  })

  it('does not stamp any other destination', async () => {
    seedTicket({ status: 'in_progress' })
    await transitionSuggestion(42, 'approved', 'system')
    expect(h.state.patches[0]!['lastError']).toBeUndefined()
  })
})

/**
 * Kind validation at create. An invented kind ('bug', 'improvement') used to
 * land verbatim in a bucket no executor reads, or fail the insert past 16
 * characters. Now it coerces to `process` with the original preserved in the
 * suggestion text.
 */
describe('unknown-kind coercion on create', () => {
  it('pins the known-kind list the executor taxonomy covers', () => {
    expect([...KNOWN_TICKET_KINDS].sort()).toEqual([
      'agent-def', 'campaign', 'code', 'config', 'instructions',
      'process', 'program', 'promo', 'strategy',
    ])
  })

  it('passes every known kind through untouched', () => {
    for (const kind of KNOWN_TICKET_KINDS) {
      expect(normalizeTicketKind(kind)).toEqual({ kind, original: null })
    }
  })

  it('defaults an absent kind to process with no original', () => {
    expect(normalizeTicketKind(undefined)).toEqual({ kind: 'process', original: null })
  })

  it('coerces an unknown kind to process and keeps the original string', () => {
    expect(normalizeTicketKind('bug')).toEqual({ kind: 'process', original: 'bug' })
    expect(normalizeTicketKind('seo-fix')).toEqual({ kind: 'process', original: 'seo-fix' })
    // Case and whitespace variants are unknown too: the column is compared
    // verbatim by every executor query, so 'Code' would be a silent bucket.
    expect(normalizeTicketKind('Code').kind).toBe('process')
  })

  it('writes the coerced kind and the preserved original on insert', async () => {
    h.state.selects.push([])       // getTeamConfig reads pipeline_settings
    h.state.insertResults.push([{ id: 77 }])
    const res = await createSuggestionDetailed({
      team: 'strategy', category: 'other', kind: 'improvement',
      suggestion: 'tighten the hero alt text',
    })
    expect(res).toEqual({ id: 77, deduped: false })
    const values = h.state.inserts[0] as Record<string, unknown>
    expect(values['kind']).toBe('process')
    expect(values['suggestion']).toBe(
      "[unknown kind 'improvement' coerced to process] tighten the hero alt text",
    )
  })

  it('leaves a known kind and its suggestion text untouched on insert', async () => {
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 78 }])
    await createSuggestionDetailed({
      team: 'strategy', category: 'other', kind: 'code',
      suggestion: 'fix the rail anchor',
    })
    const values = h.state.inserts[0] as Record<string, unknown>
    expect(values['kind']).toBe('code')
    expect(values['suggestion']).toBe('fix the rail anchor')
  })

  it('cannot overflow the 16-char kind column however long the invented kind is', async () => {
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 79 }])
    await createSuggestionDetailed({
      team: 'strategy', category: 'other',
      kind: 'a-very-long-invented-kind-name-that-would-fail-the-varchar',
      suggestion: 'x',
    })
    const values = h.state.inserts[0] as Record<string, unknown>
    expect(values['kind']).toBe('process')
    expect(String(values['kind']).length).toBeLessThanOrEqual(16)
  })
})

// ---------------------------------------------------------------------------
// Delegated supersession dismissal (#3573) + supersedesId on create (#3406)
// ---------------------------------------------------------------------------

describe('parseSupersessionRef', () => {
  it('finds a GitHub PR URL and prefers it over a ticket ref', () => {
    expect(parseSupersessionRef('replaced by https://github.com/o/r/pull/676 and ticket #3531'))
      .toEqual({ kind: 'pr', url: 'https://github.com/o/r/pull/676' })
  })

  it('finds a ticket reference', () => {
    expect(parseSupersessionRef('superseded by #3531 after the all-hands'))
      .toEqual({ kind: 'ticket', id: 3531 })
  })

  it('returns null when the note carries no reference', () => {
    expect(parseSupersessionRef('this row is stale, closing')).toBeNull()
    expect(parseSupersessionRef('')).toBeNull()
    // A bare non-GitHub URL is not a supersession reference.
    expect(parseSupersessionRef('see https://example.com/pull/9')).toBeNull()
  })
})

describe('delegated supersession edges (#3573)', () => {
  it('opens exactly proposed/approved -> dismissed for agent actors under the declaration', () => {
    const agentActors = ACTORS.filter(a => a.startsWith('agent:'))
    for (const from of TICKET_STATUSES) {
      for (const actor of agentActors) {
        const want = from === 'proposed' || from === 'approved'
        expect(isTransitionAllowed(from, 'dismissed', actor, {
          kind: 'code', viaDelegatedSupersession: true,
        })).toBe(want)
      }
    }
  })

  it('grants nothing without the declaration and nothing to non-agent actors', () => {
    // Without the flag, the plain matrix stands (the exhaustive test above
    // already proves it; this pins the specific edge).
    expect(isTransitionAllowed('approved', 'dismissed', 'agent:rr7-engineer', { kind: 'code' }))
      .toBe(false)
    // `auto` and `system` are not agent actors; the declaration adds nothing.
    for (const actor of ['auto', 'system'] as TicketActor[]) {
      expect(isTransitionAllowed('approved', 'dismissed', actor, {
        kind: 'code', viaDelegatedSupersession: true,
      })).toBe(false)
    }
    // And it opens no other target status.
    expect(isTransitionAllowed('approved', 'applied', 'agent:rr7-engineer', {
      kind: 'code', viaDelegatedSupersession: true,
    })).toBe(false)
  })

  it('dismisses on a note carrying a PR URL, with the delegated marker recorded', async () => {
    seedTicket({ status: 'approved', kind: 'code' })
    await transitionSuggestion(42, 'dismissed', 'agent:all-hands', {
      note: 'Superseded by https://github.com/o/r/pull/676 (owner direction 2026-08-16)',
    })
    const patch = h.state.patches[0]!
    expect(patch['status']).toBe('dismissed')
    // Honest attribution: the true agent actor, not 'owner'.
    expect(patch['decidedBy']).toBe('agent:all-hands')
    const links = h.state.inserts[0] as Array<Record<string, unknown>>
    const refs = links.map(l => String(l['ref']))
    expect(refs.some(r => r.startsWith('Superseded by https://github.com/o/r/pull/676'))).toBe(true)
    expect(refs.some(r => r.includes('delegated_by=owner') && r.includes('agent:all-hands'))).toBe(true)
  })

  it('verifies a ticket reference against the DB before unlocking the edge', async () => {
    // Live replacement -> dismissal succeeds.
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    h.state.selects.push([{ id: 3531, status: 'approved' }])  // the replacement row
    h.state.updates.push([{ ...TICKET, status: 'dismissed' }])
    await transitionSuggestion(42, 'dismissed', 'agent:all-hands', { note: 'superseded by #3531' })
    expect(h.state.patches[0]!['status']).toBe('dismissed')
  })

  it('409s when the cited replacement is dismissed, missing, or the row itself', async () => {
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    h.state.selects.push([{ id: 3531, status: 'dismissed' }])
    expect(await status(
      transitionSuggestion(42, 'dismissed', 'agent:all-hands', { note: 'superseded by #3531' }),
    )).toBe(409)

    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    h.state.selects.push([])  // replacement does not exist
    expect(await status(
      transitionSuggestion(42, 'dismissed', 'agent:all-hands', { note: 'superseded by #99999' }),
    )).toBe(409)

    // A note citing the row's own id is not a supersession.
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    expect(await status(
      transitionSuggestion(42, 'dismissed', 'agent:all-hands', { note: 'see #42' }),
    )).toBe(409)
  })

  it('409s a note-less or reference-less agent dismissal exactly as before', async () => {
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    expect(await status(transitionSuggestion(42, 'dismissed', 'agent:all-hands'))).toBe(409)
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'code' }])
    expect(await status(
      transitionSuggestion(42, 'dismissed', 'agent:all-hands', { note: 'do not want' }),
    )).toBe(409)
  })

  it('leaves the owner-dashboard dismissal unchanged', async () => {
    seedTicket({ status: 'approved', kind: 'code' })
    await transitionSuggestion(42, 'dismissed', 'owner')
    expect(h.state.patches[0]!['status']).toBe('dismissed')
    expect(h.state.patches[0]!['decidedBy']).toBe('owner')
  })
})

describe('supersedesId on create (#3406)', () => {
  it('persists supersedesId and dismisses an approved superseded row with a note naming the new row', async () => {
    h.state.selects.push([])                       // getTeamConfig
    h.state.insertResults.push([{ id: 3405 }])     // the new row
    h.state.selects.push([{ id: 3401, status: 'approved' }])  // resolveSupersession read
    // transitionSuggestion inside the supersession: row read, replacement
    // verify (#3405 is live: it was just created), then the update.
    h.state.selects.push([{ ...TICKET, id: 3401, status: 'approved', kind: 'code' }])
    h.state.selects.push([{ id: 3405, status: 'approved' }])
    h.state.updates.push([{ ...TICKET, id: 3401, status: 'dismissed' }])

    const res = await createSuggestionDetailed({
      team: 'content', category: 'bug', kind: 'code',
      suggestion: 'the replacement filing',
      supersedesId: 3401, actor: 'agent:all-hands',
    })
    expect(res).toEqual({ id: 3405, deduped: false, superseded: { id: 3401, outcome: 'dismissed' } })
    const values = h.state.inserts[0] as Record<string, unknown>
    expect(values['supersedesId']).toBe(3401)
    // The dismissal carries the pointer at the new row and the agent actor.
    expect(h.state.patches[0]!['status']).toBe('dismissed')
    expect(h.state.patches[0]!['decidedBy']).toBe('agent:all-hands')
    const links = (h.state.inserts[1] ?? []) as Array<Record<string, unknown>>
    expect(links.some(l => String(l['ref']).includes('#3405'))).toBe(true)
  })

  it('notes instead of dismissing when the superseded row is in flight', async () => {
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 90 }])
    h.state.selects.push([{ id: 80, status: 'pr_open' }])

    const res = await createSuggestionDetailed({
      team: 'content', category: 'bug', kind: 'code',
      suggestion: 'x', supersedesId: 80, actor: 'agent:all-hands',
    })
    expect(res.superseded).toEqual({ id: 80, outcome: 'noted' })
    // No status patch; only a note link on the old row.
    expect(h.state.patches).toEqual([])
    const links = (h.state.inserts[1] ?? []) as Array<Record<string, unknown>>
    expect(links.some(l =>
      String(l['ref']).includes('superseded by #90') && String(l['ref']).includes('pr_open'),
    )).toBe(true)
  })

  it('reports not-found and never fails the create itself', async () => {
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 91 }])
    h.state.selects.push([])  // superseded row missing
    const res = await createSuggestionDetailed({
      team: 'content', category: 'bug', kind: 'code', suggestion: 'x', supersedesId: 12345,
    })
    expect(res).toEqual({ id: 91, deduped: false, superseded: { id: 12345, outcome: 'not-found' } })
  })

  it('persists links passed on create (#1686)', async () => {
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 92 }])
    await createSuggestionDetailed({
      team: 'content', category: 'other', kind: 'code', suggestion: 'x',
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/527', state: 'open' }],
    })
    const links = (h.state.inserts[1] ?? []) as Array<Record<string, unknown>>
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      suggestionId: 92, kind: 'pr', ref: 'https://github.com/o/r/pull/527', state: 'open',
    })
  })
})

// ---------------------------------------------------------------------------
// Evidence-carrying retire (#2864)
// ---------------------------------------------------------------------------

describe('evidence-carrying retire (#2864)', () => {
  it('fences the evidence edge to agent-editor on instructions/agent-def only', () => {
    for (const kind of AGENT_EVIDENCE_RETIRE_KINDS) {
      expect(isTransitionAllowed('approved', 'dismissed', 'agent:agent-editor', {
        kind, viaRetireEvidence: true,
      })).toBe(true)
      // Without the declaration the fence holds exactly as before.
      expect(isTransitionAllowed('approved', 'dismissed', 'agent:agent-editor', { kind })).toBe(false)
    }
    // Never for code/config, evidence or not; never for other actors.
    for (const kind of ['code', 'config']) {
      expect(isTransitionAllowed('approved', 'dismissed', 'agent:agent-editor', {
        kind, viaRetireEvidence: true,
      })).toBe(false)
    }
    expect(isTransitionAllowed('approved', 'dismissed', 'agent:rr7-engineer', {
      kind: 'instructions', viaRetireEvidence: true,
    })).toBe(false)
    // And only from `approved`.
    expect(isTransitionAllowed('pr_open', 'dismissed', 'agent:agent-editor', {
      kind: 'instructions', viaRetireEvidence: true,
    })).toBe(false)
  })

  it('retires an instructions row when the superseding row names it', async () => {
    h.state.selects.push([{ id: 2732, status: 'applied', suggestion: 'consolidated rewrite replacing #2213' }])
    h.state.selects.push([{ ...TICKET, id: 2213, status: 'approved', kind: 'instructions' }])
    h.state.updates.push([{ ...TICKET, id: 2213, status: 'dismissed' }])
    await agentRetireSuggestion(2213, 'agent:agent-editor', 'superseded, see evidence',
      { supersededById: 2732 })
    expect(h.state.patches[0]!['status']).toBe('dismissed')
    const links = h.state.inserts[0] as Array<Record<string, unknown>>
    expect(links.some(l => String(l['ref']).includes('superseded by #2732 (applied)'))).toBe(true)
  })

  it('rejects supersession evidence that does not hold', async () => {
    // The superseding row never names the retired one.
    h.state.selects.push([{ id: 2732, status: 'applied', suggestion: 'says nothing about that row' }])
    expect(await status(
      agentRetireSuggestion(2213, 'agent:agent-editor', 'superseded', { supersededById: 2732 }),
    )).toBe(409)
    // #2213 must not match inside #22130.
    h.state.selects.push([{ id: 2732, status: 'applied', suggestion: 'replaces #22130' }])
    expect(await status(
      agentRetireSuggestion(2213, 'agent:agent-editor', 'superseded', { supersededById: 2732 }),
    )).toBe(409)
    // A dismissed superseding row is not live-or-applied.
    h.state.selects.push([{ id: 2732, status: 'dismissed', suggestion: 'replaces #2213' }])
    expect(await status(
      agentRetireSuggestion(2213, 'agent:agent-editor', 'superseded', { supersededById: 2732 }),
    )).toBe(409)
    // A missing one certainly is not.
    h.state.selects.push([])
    expect(await status(
      agentRetireSuggestion(2213, 'agent:agent-editor', 'superseded', { supersededById: 999 }),
    )).toBe(409)
    expect(h.state.patches).toEqual([])
  })

  it('retires on a satisfiedBy doc path or PR URL and records it as a link', async () => {
    h.state.selects.push([{ ...TICKET, id: 7, status: 'approved', kind: 'agent-def' }])
    h.state.updates.push([{ ...TICKET, id: 7, status: 'dismissed' }])
    await agentRetireSuggestion(7, 'agent:agent-editor', 'rule already in the doc',
      { satisfiedBy: 'docs/store-team/routine-content-daily.md#voice-gate' })
    expect(h.state.patches[0]!['status']).toBe('dismissed')
    const links = h.state.inserts[0] as Array<Record<string, unknown>>
    expect(links.some(l =>
      l['kind'] === 'doc' && l['ref'] === 'docs/store-team/routine-content-daily.md#voice-gate',
    )).toBe(true)
  })

  it('rejects a satisfiedBy that is neither a PR URL nor a doc path', async () => {
    expect(await status(
      agentRetireSuggestion(7, 'agent:agent-editor', 'x', { satisfiedBy: 'trust me' }),
    )).toBe(409)
    expect(await status(
      agentRetireSuggestion(7, 'agent:agent-editor', 'x', { satisfiedBy: 'https://example.com/pull/9' }),
    )).toBe(409)
  })

  it('keeps the evidence-free retire exactly as before: allowed kinds pass, own kinds 409', async () => {
    // AGENT_RETIRE_KINDS still work with no evidence.
    seedTicket({ status: 'approved', kind: 'process' })
    await agentRetireSuggestion(42, 'agent:agent-editor', 'run-observation, note to nobody')
    expect(h.state.patches[0]!['status']).toBe('dismissed')
    // instructions without evidence still 409s (the note carries no
    // supersession reference, so the delegated edge stays closed too).
    h.state.patches = []
    h.state.selects.push([{ ...TICKET, status: 'approved', kind: 'instructions' }])
    expect(await status(
      agentRetireSuggestion(42, 'agent:agent-editor', 'do not like it'),
    )).toBe(409)
    expect(h.state.patches).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// List ordering + total (#2071)
// ---------------------------------------------------------------------------

describe('list ordering and total (#2071)', () => {
  it('defaults a status-filtered list to oldest-first so truncation cannot hide the oldest rows', () => {
    expect(resolveListOrder({ status: 'approved' })).toBe('age')
    expect(resolveListOrder({ statuses: ['approved', 'blocked'] })).toBe('age')
    // With oldest-first and the row set larger than any limit, the oldest row
    // is in the first page by construction; only the NEWEST rows wait, and a
    // newly filed row is re-listed next run. That is the invariant the ticket
    // demands ("with more than the default limit of approved rows present,
    // the oldest row is included in the response").
  })

  it('keeps explicit orderBy wins and the unfiltered default (admin dashboard) unchanged', () => {
    expect(resolveListOrder({ status: 'approved', orderBy: 'created' })).toBe('created')
    expect(resolveListOrder({ status: 'approved', orderBy: 'priority' })).toBe('priority')
    expect(resolveListOrder({})).toBe('created')
    expect(resolveListOrder({ statuses: [] })).toBe('created')
  })

  it('counts matching rows ignoring limit so truncation is detectable', async () => {
    h.state.selects.push([{ n: 137 }])
    expect(await countSuggestions({ status: 'approved' })).toBe(137)
    h.state.selects.push([])
    expect(await countSuggestions({ status: 'approved' })).toBe(0)
  })
})
