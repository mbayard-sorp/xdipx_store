// Regression coverage for ticket #7308 (sibling of #7150 / team-ticket-links-missing-index.test.ts).
//
// team.server.ts's addTicketLinks degrades to a plain insert when migration
// 092's unique index (uq_suggestion_links_sugg_kind_ref) is absent, because
// without it the targeted onConflictDoNothing throws SQLSTATE 42P10 ("no
// unique or exclusion constraint matching the ON CONFLICT specification").
// release-engine.server.ts's own link writer, addTicketLink, wrapped the same
// targeted insert in a try/catch that only console.warn'd on ANY error, so on
// a database without the index it silently wrote no link at all -- quieter
// than the 500 the team.server.ts writer used to throw, since this one never
// threw in the first place.
//
// These tests assert the same degrade-to-plain-insert fallback here: with the
// index absent (simulated by the first insert throwing 42P10), addTicketLink
// still writes the link row via a second, plain insert with no ON CONFLICT
// clause. An unrelated error still only warns, with no retry. Same mocking
// discipline as release-engine.test.ts: the db here is PRODUCTION, so nothing
// in this file may reach it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** Every values() array passed to db.insert(), in call order. */
    insertCalls: [] as { values: unknown; hadConflictTarget: boolean }[],
    /** Set true to make the FIRST insert-with-onConflict call throw. */
    throwOnFirstConflictInsert: false,
    /** The error the first conflict insert throws, when armed above. */
    firstInsertError: null as unknown,
  }

  function chain(onCall?: (m: string, args: unknown[]) => void) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        return (...args: unknown[]) => {
          onCall?.(String(prop), args)
          return proxy
        }
      },
    })
    return proxy
  }

  const db = {
    insert: () => {
      let hadConflictTarget = false
      let values: unknown = null
      const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => {
              if (hadConflictTarget && state.throwOnFirstConflictInsert) {
                state.throwOnFirstConflictInsert = false // only the first call throws
                state.insertCalls.push({ values, hadConflictTarget })
                return Promise.resolve().then(() => err(state.firstInsertError))
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
    // Unused by addTicketLink; present so an accidental call fails loudly
    // rather than silently returning undefined.
    select: () => chain(),
    update: () => chain(),
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
vi.mock('~/lib/release-ticket-autofile.server', () => ({
  autoFileTicketForPr: vi.fn(async () => null),
  dismissTicketsForClosedUnmergedPrs: vi.fn(async () => ({ checked: 0, dismissed: 0, errors: [] })),
}))

// team.server's own isMissingConflictTarget is a pure function; use the real
// implementation here so a drift between the two modules' error-shape
// handling would actually surface, rather than mocking it away.
vi.mock('~/lib/team.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/team.server')>('~/lib/team.server')
  return {
    transitionSuggestion: vi.fn(),
    getTicket: vi.fn(),
    runWithOutOfBandReconcile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    isMissingConflictTarget: actual.isMissingConflictTarget,
  }
})

import { isMissingConflictTarget } from '~/lib/team.server'
import { addTicketLink } from '~/lib/release-engine.server'

beforeEach(() => {
  h.state.insertCalls = []
  h.state.throwOnFirstConflictInsert = false
  h.state.firstInsertError = null
})

describe('addTicketLink: degrades when the suggestion_links unique index is absent', () => {
  it('retries with a plain insert on 42P10 and the link row still gets written', async () => {
    h.state.throwOnFirstConflictInsert = true
    h.state.firstInsertError = Object.assign(
      new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'),
      { code: '42P10' },
    )

    await addTicketLink(7308, { kind: 'pr', ref: 'https://github.com/o/r/pull/1', state: 'needs-owner' })

    expect(h.state.insertCalls.length).toBe(2)
    expect(h.state.insertCalls[0]!.hadConflictTarget).toBe(true)
    expect(h.state.insertCalls[1]!.hadConflictTarget).toBe(false)

    const retriedValues = h.state.insertCalls[1]!.values as { ref: string }
    expect(retriedValues.ref).toBe('https://github.com/o/r/pull/1')
  })

  it('writes once, no retry, when the index is present', async () => {
    await addTicketLink(7308, { kind: 'commit', ref: 'abc123', state: 'merged' })

    expect(h.state.insertCalls.length).toBe(1)
    expect(h.state.insertCalls[0]!.hadConflictTarget).toBe(true)
  })

  it('an unrelated error still only warns, with no retry (no other error class changes behaviour)', async () => {
    h.state.throwOnFirstConflictInsert = true
    h.state.firstInsertError = new Error('connection reset')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      addTicketLink(7308, { kind: 'pr', ref: 'https://github.com/o/r/pull/2', state: 'open' }),
    ).resolves.toBeUndefined()

    expect(h.state.insertCalls.length).toBe(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('isMissingConflictTarget (sanity: same helper release-engine.server.ts now shares with team.server.ts)', () => {
  it('recognizes SQLSTATE 42P10', () => {
    expect(isMissingConflictTarget(Object.assign(new Error('x'), { code: '42P10' }))).toBe(true)
  })

  it('is false for an unrelated error', () => {
    expect(isMissingConflictTarget(new Error('connection reset'))).toBe(false)
  })
})
