/**
 * What a re-observation is allowed to change, asserted on the emitted SQL.
 *
 * `fileBlocker`'s ON CONFLICT clause had no test of any kind: the canonicalize
 * suite next door asserts only the bound dedupe_key, and the DB-touching paths
 * are exercised nowhere but a seed script against production. So the rule "fill
 * gaps, never clobber" was applied uniformly to measured and authored fields
 * alike, and nothing noticed that `title` was not in the SET list at all.
 *
 * The cost was visible on the owner's own list. Blocker #50 was priority 1,
 * open, last_seen_at fresh to the minute because the hourly pod watcher kept
 * re-filing it, and its title named a GPU pod that had stopped six days
 * earlier. Every timestamp said current; the sentence said otherwise.
 *
 * Same discipline as the neighbouring suites: the database is PRODUCTION, so
 * nothing here connects. The SQL is rendered through PgDialect and read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

import { fileBlocker } from '~/lib/owner-blockers.server'

/** The INSERT ... ON CONFLICT is the second statement fileBlocker issues. */
function upsertSql(): string {
  const passed = executeMock.mock.calls[1]?.[0]
  if (!passed) throw new Error('no upsert statement was issued')
  return new PgDialect().sqlToQuery(passed).sql.replace(/\s+/g, ' ')
}

/**
 * The SET assignment for one column, normalised to a single line.
 *
 * Stops at the next `column =` or at RETURNING rather than at the next comma,
 * because every assignment here is a COALESCE and a comma-terminated match
 * truncates inside its own argument list.
 */
function assignment(column: string): string {
  const sql = upsertSql()
  const m = new RegExp(`\\b${column}\\s*=\\s*(.+?)(?:,\\s*\\w+\\s*=|\\s+RETURNING)`, 'i').exec(sql)
  return m ? m[1]!.trim() : ''
}

beforeEach(async () => {
  executeMock.mockReset()
  executeMock
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 1, created: false }] })
    .mockResolvedValue({ rows: [] })
  await fileBlocker({
    dedupeKey: 'runpod-stray-pod',
    title: 'pod xdipx-s2v-bakeoff has been running 0.2h ($0.74/hr)',
    detail: 'one pod, 0.2 hours',
    category: 'console',
  })
})

describe('measured fields take the newest observation', () => {
  it('updates title at all, which it previously did not', () => {
    // The headline bug. `title` was absent from the SET list entirely, so it
    // was written once on insert and never again for the life of the row.
    expect(upsertSql()).toMatch(/\btitle\s*=/i)
  })

  for (const column of ['title', 'detail']) {
    it(`prefers the incoming ${column} over the stored one`, () => {
      // COALESCE(EXCLUDED.x, stored) — newest wins when there is a newest.
      expect(assignment(column)).toMatch(/COALESCE\(\s*EXCLUDED\./i)
    })

    it(`still falls back to the stored ${column} when the caller omits it`, () => {
      // Wrapped rather than bare EXCLUDED: a caller passing NULL must not erase
      // what a richer earlier filing recorded.
      expect(assignment(column)).toMatch(/owner_blockers\./i)
    })
  }
})

describe('authored-once fields are never clobbered', () => {
  for (const column of ['unblocks', 'where_to_go', 'evidence', 'verify_probe', 'verify_arg']) {
    it(`keeps the stored ${column} when one exists`, () => {
      // COALESCE(stored, EXCLUDED.x) — the original order, deliberately.
      expect(assignment(column)).toMatch(/COALESCE\(\s*owner_blockers\./i)
    })
  }

  it('never lets a re-file erase a CONFIRMED justification', () => {
    // The specific regression a bare EXCLUDED would have introduced. No cron
    // caller passes `evidence`, so newest-wins there would let the hourly pod
    // watcher silently wipe the hand-written note that titleClaimsConfirmed
    // exists to require.
    expect(assignment('evidence')).toBe('COALESCE(owner_blockers.evidence, EXCLUDED.evidence)')
  })
})

describe('reopen semantics are untouched', () => {
  it('still flips a cleared row back to open', () => {
    const sql = upsertSql()
    expect(sql).toMatch(/status\s*=\s*CASE WHEN owner_blockers\.status = 'cleared' THEN 'open'/i)
    expect(sql).toMatch(/last_seen_at\s*=\s*now\(\)/i)
  })
})
