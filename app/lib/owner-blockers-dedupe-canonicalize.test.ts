/**
 * Ticket #7044: owner_blockers.dedupe_key is canonicalized on write, but rows
 * inserted before that canonicalization landed still hold their raw,
 * pre-canonical keys. Re-filing one of those blockers today canonicalizes
 * the incoming key and misses the stored raw row on `ON CONFLICT
 * (dedupe_key)`, inserting a duplicate instead of updating it — reproduced
 * live 2026-09-02, blocker #16 ('runpod:vercel-env') vs the duplicate #69
 * ('runpod-vercel-env') it produced. Migration 092 canonicalizes the
 * existing rows; this test locks down the write-path half of the fix: every
 * call to fileBlocker(), whatever spelling of the key the caller passes,
 * targets the same canonical dedupe_key in its SQL, which is what lets
 * `ON CONFLICT (dedupe_key)` land on one row instead of a fresh insert.
 *
 * No DB harness in this suite (same discipline as team-image-cap.test.ts and
 * owner-digest.server.test.ts: the database is PRODUCTION), so the emitted
 * SQL is rendered via PgDialect and asserted on the dedupe_key param.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { canonicalDedupeKey } from '~/lib/dedupe-key'

const executeMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

import { fileBlocker } from '~/lib/owner-blockers.server'

/** The dedupe_key param bound into the Nth db.execute call this test made. */
function dedupeKeyParam(callIndex: number): string {
  const passed = executeMock.mock.calls[callIndex]?.[0]
  const q = new PgDialect().sqlToQuery(passed)
  // Every fileBlocker query starts with `dedupe_key = $1` (the prior-status
  // SELECT) or has dedupe_key as its first bound VALUES column (the INSERT),
  // so the first param is always the dedupe_key in both statements this
  // module issues.
  return String(q.params[0])
}

beforeEach(() => {
  executeMock.mockReset()
  // Call 1: the prior-status SELECT. Call 2: the INSERT ... ON CONFLICT.
  // Call 3 (only on created:true): fileBlocker's own near-duplicate sweep.
  executeMock
    .mockResolvedValueOnce({ rows: [] }) // no prior row
    .mockResolvedValueOnce({ rows: [{ id: 1, created: true }] })
    .mockResolvedValueOnce({ rows: [] }) // near-duplicate sweep: nothing else open
})

describe('fileBlocker canonicalizes the write key regardless of caller spelling (#7044)', () => {
  it('a raw, colon-separated key is written under its canonical form', async () => {
    await fileBlocker({ dedupeKey: 'runpod:vercel-env', title: 'RunPod vercel env missing' })

    const canon = canonicalDedupeKey('runpod:vercel-env', { maxLength: 80 })
    expect(canon).toBe('runpod-vercel-env')
    expect(dedupeKeyParam(0)).toBe(canon) // the prior-status SELECT
    expect(dedupeKeyParam(1)).toBe(canon) // the INSERT ... ON CONFLICT
  })

  it('a raw key and its already-canonical form resolve to the identical stored key', async () => {
    await fileBlocker({ dedupeKey: 'runpod:vercel-env', title: 'RunPod vercel env missing' })
    const rawWrite = dedupeKeyParam(1)

    executeMock.mockReset()
    executeMock
      .mockResolvedValueOnce({ rows: [{ status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, created: false }] })
    await fileBlocker({ dedupeKey: 'runpod-vercel-env', title: 'RunPod vercel env missing' })
    const canonicalWrite = dedupeKeyParam(1)

    // Same target row either way: this is what makes ON CONFLICT (dedupe_key)
    // an update instead of a second insert.
    expect(rawWrite).toBe(canonicalWrite)
  })
})
