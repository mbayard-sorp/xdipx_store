// Regression coverage for ticket #10506, rescoped by qa-reviewer's correction
// note during the pre-verify of PR #1269 (see the ticket's own `note` link for
// the full root-cause writeup). Distinct from #7150 (SQLSTATE 42P10, the
// unique index missing entirely -- covered by
// team-ticket-links-missing-index.test.ts): here the index EXISTS and works,
// but a long `ref` (typically a caller-supplied transition note) overflows
// Postgres's btree index-tuple ceiling (~2704 bytes) on
// uq_suggestion_links_sugg_kind_ref, raising SQLSTATE 54000
// (program_limit_exceeded) rather than 42P10. Because `transitionSuggestion`
// used to write the status UPDATE before calling `addTicketLinks`, that throw
// reached the caller as a 500 AFTER the status change had already committed,
// with the note silently lost and no way for the caller to tell the
// transition had, in fact, gone through.
//
// This file covers all three rescoped DONE WHEN clauses:
//   a) an oversized caller-supplied note is truncated, not fatal
//   b) a 54000 from addTicketLinks degrades (harder clamp + retry) instead of
//      rethrowing
//   c) the link/note write now happens BEFORE the status update, so an
//      unrecoverable link failure cannot leave a committed status with no
//      recorded reason
// plus the multi-byte UTF-8 case the ticket calls out by name: a character
// clamp can pass while a byte clamp is required.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    selectedRow: null as Record<string, unknown> | null,
    insertCalls: [] as { values: { ref: string }[]; hadConflictTarget: boolean }[],
    updateCalled: false,
    /** 'insert' | 'update', pushed at CALL time (not resolve time), so this
     *  reflects the real statement order regardless of how each promise
     *  eventually settles. */
    order: [] as string[],
    /** Every insert-with-onConflict call throws SQLSTATE 54000 until this many have fired. */
    throw54000Times: 0,
    /** Every insert-with-onConflict call throws an unrelated error (never recovers). */
    throwUnrelatedAlways: false,
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
    update: () => {
      state.updateCalled = true
      state.order.push('update')
      return chain(() => (state.selectedRow ? [{ ...state.selectedRow, status: 'pr_open' }] : []))
    },
    insert: () => {
      state.order.push('insert')
      let hadConflictTarget = false
      let values: { ref: string }[] = []
      const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => {
              if (state.throwUnrelatedAlways) {
                state.insertCalls.push({ values, hadConflictTarget })
                const pgErr = Object.assign(new Error('connection reset'), { code: '08006' })
                return Promise.resolve().then(() => err(pgErr))
              }
              if (hadConflictTarget && state.throw54000Times > 0) {
                state.throw54000Times--
                state.insertCalls.push({ values, hadConflictTarget })
                const pgErr = Object.assign(
                  new Error(
                    'index row size 4056 exceeds btree version 4 maximum 2704 for index "uq_suggestion_links_sugg_kind_ref"',
                  ),
                  { code: '54000' },
                )
                return Promise.resolve().then(() => err(pgErr))
              }
              state.insertCalls.push({ values, hadConflictTarget })
              return Promise.resolve([]).then(ok)
            }
          }
          return (...args: unknown[]) => {
            if (prop === 'values') values = args[0] as { ref: string }[]
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
  kvSetNX: async () => false,
  kvSet: async () => {},
}))

import {
  clampRefBytes,
  isOversizedIndexEntry,
  LINK_REF_MAX_BYTES,
  transitionSuggestion,
} from '~/lib/team.server'

beforeEach(() => {
  h.state.selectedRow = {
    id: 10506,
    status: 'in_progress',
    assignee: 'agent:rr7-engineer',
    kind: 'code',
    applyRef: null,
  }
  h.state.insertCalls = []
  h.state.updateCalled = false
  h.state.order = []
  h.state.throw54000Times = 0
  h.state.throwUnrelatedAlways = false
})

describe('clampRefBytes', () => {
  it('returns short strings unchanged', () => {
    expect(clampRefBytes('typecheck/test/build green locally')).toBe(
      'typecheck/test/build green locally',
    )
  })

  it('clamps an oversized ascii string to at most the byte budget plus the ellipsis marker', () => {
    const s = 'x'.repeat(5000)
    const clamped = clampRefBytes(s, 100)
    expect(Buffer.byteLength(clamped, 'utf8')).toBeLessThanOrEqual(100 + Buffer.byteLength('…', 'utf8'))
    expect(clamped.endsWith('…')).toBe(true)
  })

  it('never splits a multi-byte UTF-8 character at the truncation boundary', () => {
    // U+3042 (hiragana 'a') is 3 bytes in UTF-8. Force a boundary that would
    // land mid-character on a naive byte slice.
    const s = 'あ'.repeat(50) // 150 bytes
    const clamped = clampRefBytes(s, 10) // not a multiple of 3
    // A corrupted truncation would produce the U+FFFD replacement character
    // (or throw) when the byte buffer is decoded back to UTF-8.
    expect(clamped).not.toContain('�')
    expect(Buffer.byteLength(clamped, 'utf8')).toBeLessThanOrEqual(10 + Buffer.byteLength('…', 'utf8'))
  })

  it('a byte clamp catches what a character-count clamp would miss on multi-byte text', () => {
    // 900 chars of a 3-byte character = 2700 bytes: under a naive 2000-
    // CHARACTER clamp, but over a 2000-BYTE budget.
    const s = 'あ'.repeat(900)
    expect(s.length).toBeLessThan(2000)
    expect(Buffer.byteLength(s, 'utf8')).toBeGreaterThan(2000)

    const clamped = clampRefBytes(s, 2000)
    expect(Buffer.byteLength(clamped, 'utf8')).toBeLessThanOrEqual(2000 + Buffer.byteLength('…', 'utf8'))
  })

  it('LINK_REF_MAX_BYTES leaves real headroom under the ~2704-byte btree ceiling', () => {
    expect(LINK_REF_MAX_BYTES).toBeLessThan(2704)
    expect(LINK_REF_MAX_BYTES).toBeGreaterThan(0)
  })
})

describe('isOversizedIndexEntry', () => {
  it('recognizes SQLSTATE 54000 on the error itself', () => {
    expect(isOversizedIndexEntry(Object.assign(new Error('x'), { code: '54000' }))).toBe(true)
  })

  it('recognizes 54000 nested a couple levels down a cause chain', () => {
    const inner = Object.assign(new Error('inner'), { code: '54000' })
    const outer = Object.assign(new Error('outer'), { cause: Object.assign(new Error('mid'), { cause: inner }) })
    expect(isOversizedIndexEntry(outer)).toBe(true)
  })

  it('recognizes the SQLSTATE quoted in a bare message with no .code', () => {
    expect(isOversizedIndexEntry(new Error('index row size 4056 exceeds btree version 4 maximum 2704 (54000)'))).toBe(
      true,
    )
  })

  it('is false for an unrelated error, including the sibling 42P10 case', () => {
    expect(isOversizedIndexEntry(new Error('connection reset'))).toBe(false)
    expect(isOversizedIndexEntry(Object.assign(new Error('no conflict target'), { code: '42P10' }))).toBe(false)
  })
})

describe('transitionSuggestion: an oversized transition note is truncated, not fatal', () => {
  it('a very long caller-supplied note still completes the transition with no unhandled 500', async () => {
    const hugeNote = 'y'.repeat(20000)
    const updated = await transitionSuggestion(10506, 'pr_open', 'agent:rr7-engineer', {
      note: hugeNote,
    })
    expect(updated.status).toBe('pr_open')
  })
})

describe('transitionSuggestion: degrades on SQLSTATE 54000 instead of rethrowing after commit', () => {
  it('retries with a harder clamp when the first insert overflows the btree ceiling', async () => {
    h.state.throw54000Times = 1

    const updated = await transitionSuggestion(10506, 'pr_open', 'agent:rr7-engineer', {
      note: 'z'.repeat(3000),
    })

    expect(updated.status).toBe('pr_open')
    expect(h.state.insertCalls.length).toBe(2)
    expect(h.state.insertCalls[0]!.hadConflictTarget).toBe(true)
    // The retry clamps harder than the first attempt.
    const firstRef = h.state.insertCalls[0]!.values[0]!.ref
    const retriedRef = h.state.insertCalls[1]!.values[0]!.ref
    expect(Buffer.byteLength(retriedRef, 'utf8')).toBeLessThan(Buffer.byteLength(firstRef, 'utf8'))
  })
})

describe('transitionSuggestion: links are written before the status update commits', () => {
  it('does not commit the status update when the link write is unrecoverable', async () => {
    h.state.throwUnrelatedAlways = true

    await expect(
      transitionSuggestion(10506, 'pr_open', 'agent:rr7-engineer', { note: 'will not be written' }),
    ).rejects.toThrow()

    // The whole point of #10506's fix: a note failure must not leave a
    // committed status with no recorded reason, so the status update must
    // never have been attempted.
    expect(h.state.updateCalled).toBe(false)
  })

  it('a normal transition still writes the link and commits the status, in that order', async () => {
    const updated = await transitionSuggestion(10506, 'pr_open', 'agent:rr7-engineer', { note: 'clean run' })

    expect(updated.status).toBe('pr_open')
    expect(h.state.order).toEqual(['insert', 'update'])
  })
})
