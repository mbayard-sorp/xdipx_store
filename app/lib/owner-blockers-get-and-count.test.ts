/**
 * Ticket #19942. The SQL-level half of the get-by-id and total-count fix:
 * `getBlockerById` binds the requested id and returns null on an empty
 * result rather than throwing or returning a partial row, `countOpenBlockers`
 * counts only `status = 'open'`, and `listOpenBlockers` binds whatever limit
 * it is called with (the route-level forwarding is covered in
 * api-team-blocker.test.ts).
 *
 * No DB harness in this suite (same discipline as the neighbouring
 * owner-blockers-*.test.ts files: the database is PRODUCTION), so the
 * emitted SQL is rendered via PgDialect and read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

import { countOpenBlockers, getBlockerById, listOpenBlockers } from '~/lib/owner-blockers.server'

function lastSql(): string {
  const passed = executeMock.mock.calls.at(-1)?.[0]
  if (!passed) throw new Error('no statement was issued')
  return new PgDialect().sqlToQuery(passed).sql.replace(/\s+/g, ' ')
}

function lastParams(): unknown[] {
  const passed = executeMock.mock.calls.at(-1)?.[0]
  if (!passed) throw new Error('no statement was issued')
  return new PgDialect().sqlToQuery(passed).params
}

beforeEach(() => {
  executeMock.mockReset()
})

describe('getBlockerById (#19942)', () => {
  it('binds the requested id and returns the row when found', async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: 649, dedupe_key: 'admin-socials-screenshots', title: 'the /admin/socials screenshots', status: 'cleared', priority: 2, source: 'agent', first_seen_at: '2026-10-14T00:00:00Z', last_seen_at: '2026-10-14T00:00:00Z', age_days: 21 }],
    })
    const row = await getBlockerById(649)
    expect(lastSql()).toContain('WHERE id =')
    expect(lastParams()).toContain(649)
    expect(row).not.toBeNull()
    expect(row?.id).toBe(649)
    expect(row?.status).toBe('cleared') // any status, not only open
  })

  it('returns null, not a thrown error or a partial row, when the id does not exist', async () => {
    executeMock.mockResolvedValue({ rows: [] })
    const row = await getBlockerById(999999)
    expect(row).toBeNull()
  })
})

describe('countOpenBlockers (#19942)', () => {
  it('counts only status = open', async () => {
    executeMock.mockResolvedValue({ rows: [{ n: 51 }] })
    const n = await countOpenBlockers()
    expect(lastSql()).toContain("status = 'open'")
    expect(n).toBe(51)
  })
})

describe('listOpenBlockers binds whatever limit it is called with (#19942)', () => {
  it('a limit above the 50-row default reaches a 51st row', async () => {
    const fiftyOne = Array.from({ length: 51 }, (_, i) => ({
      id: i + 1, dedupe_key: `k${i + 1}`, title: `row ${i + 1}`, status: 'open', priority: 3,
      source: 'agent', first_seen_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-01T00:00:00Z', age_days: 1,
    }))
    executeMock.mockResolvedValue({ rows: fiftyOne })
    const rows = await listOpenBlockers(100)
    expect(lastParams()).toContain(100)
    expect(rows).toHaveLength(51)
    expect(rows[50]?.id).toBe(51)
  })
})
