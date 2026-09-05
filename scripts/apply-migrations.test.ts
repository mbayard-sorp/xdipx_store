import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// apply-migrations.ts re-uses the ledger helpers from apply-additive-migrations.ts,
// which imports the owner-blocker filer for its MANUAL-migration path (exercised
// in apply-additive-migrations.test.ts, not here). Mocked so this suite never
// needs a real DB connection.
vi.mock('~/lib/owner-blockers.server', () => ({ fileBlocker: vi.fn() }))

import { applyMigrationFiles } from './apply-migrations'
import type { QueryClient } from './apply-additive-migrations'

/** In-memory ledger-backed QueryClient, so these tests never touch a real DB. */
function fakeClient(seeded: string[] = []): { client: QueryClient; queries: string[] } {
  const queries: string[] = []
  const ledger = new Set(seeded)
  const client: QueryClient = {
    async query(text, params) {
      queries.push(text)
      if (text.includes('SELECT filename FROM schema_migrations_applied')) {
        return { rows: [...ledger].map((filename) => ({ filename })) }
      }
      if (text.includes('INSERT INTO schema_migrations_applied')) {
        ledger.add(String(params?.[0]))
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
  return { client, queries }
}

describe('applyMigrationFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xdipx-apply-migrations-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a file it has not seen before and records it in the ledger', async () => {
    writeFileSync(join(dir, '900_test.sql'), 'CREATE TABLE IF NOT EXISTS t (id int);\n')
    const { client, queries } = fakeClient()

    const result = await applyMigrationFiles(client, ['900_test.sql'], dir)

    expect(result.applied).toEqual(['900_test.sql'])
    expect(result.skipped).toEqual([])
    expect(queries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS t'))).toBe(true)
    expect(queries.some((q) => q.includes('INSERT INTO schema_migrations_applied'))).toBe(true)
  })

  it('skips a file already recorded in the ledger, without re-reading or re-running its statements', async () => {
    // No file written for 901_test.sql on purpose: skipping must happen before
    // the file is even read, or a since-deleted already-applied migration
    // would crash a later --from re-run.
    const { client, queries } = fakeClient(['901_test.sql'])

    const result = await applyMigrationFiles(client, ['901_test.sql'], dir)

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual(['901_test.sql'])
    expect(queries.some((q) => q.includes('INSERT INTO schema_migrations_applied'))).toBe(false)
  })

  it('is safe to re-run over the same range: a file the ledger already has is not replayed', async () => {
    writeFileSync(join(dir, '902_a.sql'), 'CREATE TABLE IF NOT EXISTS a (id int);\n')
    writeFileSync(join(dir, '903_b.sql'), 'CREATE TABLE IF NOT EXISTS b (id int);\n')
    const { client } = fakeClient()

    const first = await applyMigrationFiles(client, ['902_a.sql', '903_b.sql'], dir)
    expect(first.applied).toEqual(['902_a.sql', '903_b.sql'])

    const second = await applyMigrationFiles(client, ['902_a.sql', '903_b.sql'], dir)
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(['902_a.sql', '903_b.sql'])
  })

  it('records only the files that ran before a later failure, so a fixed re-run does not repeat them', async () => {
    writeFileSync(join(dir, '904_ok.sql'), 'CREATE TABLE IF NOT EXISTS ok (id int);\n')
    writeFileSync(join(dir, '905_bad.sql'), 'NOT REAL SQL;\n')
    const { client } = fakeClient()
    const failing: QueryClient = {
      async query(text, params) {
        if (text.includes('NOT REAL SQL')) throw new Error('syntax error')
        return client.query(text, params)
      },
    }

    await expect(applyMigrationFiles(failing, ['904_ok.sql', '905_bad.sql'], dir)).rejects.toThrow('syntax error')

    // The failed file's statement never ran against the real client, so
    // schema_migrations_applied was never asked to record it.
    const applied = await client.query('SELECT filename FROM schema_migrations_applied')
    expect(applied.rows.map((r) => r['filename'])).toEqual(['904_ok.sql'])
  })
})
