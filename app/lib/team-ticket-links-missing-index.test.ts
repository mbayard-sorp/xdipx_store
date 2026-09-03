// Regression coverage for ticket #7150 (split from #7140's root-cause note).
//
// db/migrations/092_suggestion_links_dedupe.sql opens with a DELETE, so it is
// classified 'manual' and never auto-applies at build time -- it can be
// unapplied in a given environment. `addTicketLinks` (team.server.ts) targets
// the unique index that migration creates via `onConflictDoNothing({target:
// [...]})`. Without the index, Postgres throws SQLSTATE 42P10 ("no unique or
// exclusion constraint matching the ON CONFLICT specification"), and because
// `transitionSuggestion` writes the status UPDATE before calling
// `addTicketLinks`, that throw happened AFTER the status change had already
// committed: the caller saw a 500 while the ticket had, in fact, moved and
// the note was lost.
//
// These tests assert the degrade-to-plain-insert fallback: with the index
// absent (simulated by the first insert throwing 42P10), a transition still
// completes and the note/link row is still written, via a second insert with
// no ON CONFLICT clause. Same mocking discipline as team-tickets.test.ts: the
// db here is PRODUCTION, so nothing in this file may reach it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** The row `transitionSuggestion`'s initial select() should return. */
    selectedRow: null as Record<string, unknown> | null,
    /** Every values() array passed to db.insert(), in call order. */
    insertCalls: [] as { values: unknown; hadConflictTarget: boolean }[],
    /** Set true to make the FIRST insert-with-onConflict call throw 42P10. */
    throwOnFirstConflictInsert: false,
  }

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
    select: () => chain(() => (state.selectedRow ? [state.selectedRow] : [])),
    update: () => chain(() => (state.selectedRow ? [{ ...state.selectedRow, status: 'pr_open' }] : [])),
    insert: () => {
      let hadConflictTarget = false
      let values: unknown = null
      const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => {
              if (hadConflictTarget && state.throwOnFirstConflictInsert) {
                state.throwOnFirstConflictInsert = false // only the first call throws
                const pgErr = Object.assign(
                  new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'),
                  { code: '42P10' },
                )
                state.insertCalls.push({ values, hadConflictTarget })
                return Promise.resolve().then(() => err(pgErr))
              }
              state.insertCalls.push({ values, hadConflictTarget })
              return Promise.resolve([]).then(ok)
            }
          }
          return (...args: unknown[]) => {
            if (prop === 'values') values = args[0]
            if (prop === 'onConflictDoNothing') hadConflictTarget = true
            return proxy
          }
        },
      })
      return proxy
    },
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

import { isMissingConflictTarget, transitionSuggestion } from '~/lib/team.server'

beforeEach(() => {
  h.state.selectedRow = {
    id: 7150,
    status: 'in_progress',
    assignee: 'agent:rr7-engineer',
    kind: 'code',
    applyRef: null,
  }
  h.state.insertCalls = []
  h.state.throwOnFirstConflictInsert = false
})

describe('isMissingConflictTarget', () => {
  it('recognizes SQLSTATE 42P10 on the error itself', () => {
    expect(isMissingConflictTarget(Object.assign(new Error('x'), { code: '42P10' }))).toBe(true)
  })

  it('recognizes 42P10 nested a couple levels down a cause chain', () => {
    const inner = Object.assign(new Error('inner'), { code: '42P10' })
    const outer = Object.assign(new Error('outer'), { cause: Object.assign(new Error('mid'), { cause: inner }) })
    expect(isMissingConflictTarget(outer)).toBe(true)
  })

  it('recognizes the SQLSTATE quoted in a bare message with no .code', () => {
    expect(isMissingConflictTarget(new Error('ON CONFLICT specification (42P10)'))).toBe(true)
  })

  it('is false for an unrelated error', () => {
    expect(isMissingConflictTarget(new Error('connection reset'))).toBe(false)
    expect(isMissingConflictTarget(Object.assign(new Error('missing table'), { code: '42P01' }))).toBe(false)
  })
})

describe('transitionSuggestion: degrades when the suggestion_links unique index is absent', () => {
  it('a transition with a note still returns the updated row and still writes the note (no unhandled 500)', async () => {
    h.state.throwOnFirstConflictInsert = true

    const updated = await transitionSuggestion(7150, 'pr_open', 'agent:rr7-engineer', {
      note: 'typecheck/test/build green locally',
      links: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/1', state: 'open' }],
    })

    expect(updated.status).toBe('pr_open')

    // Two insert attempts for the link batch: the first (with ON CONFLICT)
    // threw 42P10, the second (plain insert, no conflict target) succeeded.
    const linkInserts = h.state.insertCalls
    expect(linkInserts.length).toBe(2)
    expect(linkInserts[0]!.hadConflictTarget).toBe(true)
    expect(linkInserts[1]!.hadConflictTarget).toBe(false)

    // The note survived into the plain-insert retry, not silently dropped.
    const retriedValues = linkInserts[1]!.values as { ref: string }[]
    expect(retriedValues.some(v => v.ref === 'typecheck/test/build green locally')).toBe(true)
  })

  it('a transition with the index present writes once, no retry', async () => {
    const updated = await transitionSuggestion(7150, 'pr_open', 'agent:rr7-engineer', {
      note: 'clean run',
    })

    expect(updated.status).toBe('pr_open')
    expect(h.state.insertCalls.length).toBe(1)
    expect(h.state.insertCalls[0]!.hadConflictTarget).toBe(true)
  })
})
