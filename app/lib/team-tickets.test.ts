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
  markSuggestion,
  normalizeTicketKind,
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

/** Every triple the design permits when a code ticket is held by rr7-engineer. */
const ALLOWED_FOR_CODE_TICKET: Array<[TicketStatus, TicketStatus, TicketActor[]]> = [
  ['proposed',    'approved',    ['owner', 'auto']],
  ['proposed',    'dismissed',   ['owner']],
  ['approved',    'in_progress', ['agent:rr7-engineer', 'agent:agent-editor']],
  // Out-of-band merged-PR reconcile: a bounced ticket whose lease expired
  // returns to `approved` with its PR link intact, and if the owner then
  // merges that PR by hand the ticket is stranded (tickets #120/#423, PRs
  // #436/#429). Only sweepOrphanedMergedPrTickets walks this, and only on a
  // `merged: true` from GitHub itself.
  ['approved',    'applied',     ['system']],
  ['approved',    'dismissed',   ['owner']],
  ['in_progress', 'pr_open',     ['agent:rr7-engineer']],          // assignee only
  ['in_progress', 'blocked',     ['agent:rr7-engineer', 'system']],
  ['in_progress', 'approved',    ['system']],                       // lease expiry
  ['in_progress', 'dismissed',   ['owner']],
  ['pr_open',     'in_review',   ['agent:qa-reviewer']],
  ['pr_open',     'applied',     ['system']],                       // out-of-band reconciliation
  // ADR-008 step 2: the abandoned-PR sweep retires an auto-filed ticket whose
  // PR was closed unmerged. `system` here is dismissTicketsForClosedUnmergedPrs
  // and nothing else; it restricts itself to rows whose dedupe_key starts with
  // `autofile:pr-`, which the matrix cannot express. Terminal and ships nothing.
  ['pr_open',     'dismissed',   ['owner', 'system']],
  ['in_review',   'verified',    ['agent:qa-reviewer']],
  ['in_review',   'in_progress', ['agent:qa-reviewer']],            // FAIL bounce
  ['in_review',   'applied',     ['system']],                       // out-of-band reconciliation
  ['in_review',   'dismissed',   ['owner']],
  ['verified',    'applied',     ['system']],
  ['verified',    'in_progress', ['system']],                       // smoke bounce
  ['verified',    'dismissed',   ['owner']],
  ['blocked',     'approved',    ['owner', 'system']],
  // Same out-of-band reconcile edge: a blocked ticket whose PR the owner then
  // merged by hand (ticket #455, PR #508) otherwise has no exit but the owner.
  ['blocked',     'applied',     ['system']],
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

  it('opens pr_open -> applied to agent-editor (own kinds) and system (reconciliation) only', () => {
    for (const kind of AGENT_EDITOR_APPLY_KINDS) {
      expect(isTransitionAllowed('pr_open', 'applied', 'agent:agent-editor', { kind })).toBe(true)
    }
    for (const kind of ['code', 'process', 'campaign', 'promo']) {
      expect(isTransitionAllowed('pr_open', 'applied', 'agent:agent-editor', { kind })).toBe(false)
    }
    // `system` is the out-of-band sweep, and unlike agent-editor it is not fenced
    // by kind: a hand-merged PR strands a ticket of any kind, and the sweep only
    // ever acts on a PR GitHub reports as already merged.
    for (const kind of [...AGENT_EDITOR_APPLY_KINDS, 'code', 'process']) {
      expect(isTransitionAllowed('pr_open', 'applied', 'system', { kind })).toBe(true)
      expect(isTransitionAllowed('in_review', 'applied', 'system', { kind })).toBe(true)
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
    // At `approved` the triple is now reachable for every kind, but through a
    // DIFFERENT rule: the out-of-band merged-PR reconcile edge, which the
    // sweep only ever walks on a `merged: true` from GitHub. The detector
    // self-close rule itself stays fenced to `process`.
    for (const kind of ['code', 'strategy']) {
      expect(isTransitionAllowed('approved', 'applied', 'system', { kind })).toBe(true)
    }
  })

  it('grants the edge to system only', () => {
    for (const actor of ACTORS.filter(a => a !== 'system')) {
      expect(isTransitionAllowed('proposed', 'applied', actor, { kind: 'process' })).toBe(false)
    }
  })

  it('does not widen RUN_CLOSE_ACTORS as a side effect', () => {
    // Adding 'system' there would have been the smaller diff. The reconcile
    // edge does now let `system` close a strategy row from `approved`, but
    // only when its linked PR is merged (enforced by the sweep, not the map);
    // the run-close lane itself stays fenced to the named entry agents.
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
 * ticket #455 blocked with PR #508 merged). The map grants the edge to
 * `system`; the merged-PR precondition is enforced by the sweep that is the
 * edge's only caller, exactly as on `pr_open -> applied`.
 */
describe('out-of-band reconcile edges (approved/blocked -> applied)', () => {
  it('grants both edges to system for any kind, mirroring pr_open -> applied', () => {
    for (const kind of ['code', 'process', 'instructions', 'strategy']) {
      expect(isTransitionAllowed('approved', 'applied', 'system', { kind })).toBe(true)
      expect(isTransitionAllowed('blocked', 'applied', 'system', { kind })).toBe(true)
    }
  })

  it('rejects every non-system actor on both edges', () => {
    for (const actor of ACTORS.filter(a => a !== 'system')) {
      expect(isTransitionAllowed('approved', 'applied', actor, { kind: 'code' })).toBe(false)
      expect(isTransitionAllowed('blocked', 'applied', actor, { kind: 'code' })).toBe(false)
    }
    // Including the assignee holding the claim: reconcile is never an agent move.
    expect(isTransitionAllowed('blocked', 'applied', 'agent:rr7-engineer', {
      kind: 'code', assignee: 'agent:rr7-engineer',
    })).toBe(false)
  })

  it('walks blocked -> applied through transitionSuggestion and backfills apply_ref', async () => {
    seedTicket({ status: 'blocked', applyRef: null })
    await transitionSuggestion(42, 'applied', 'system', {
      note: "merged out-of-band while 'blocked'",
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/508', state: 'merged' }],
    })
    expect(h.state.patches[0]).toMatchObject({ status: 'applied' })
    expect(h.state.patches[0]!['applyRef']).toBe('https://github.com/o/r/pull/508')
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
