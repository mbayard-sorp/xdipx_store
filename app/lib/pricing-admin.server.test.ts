// Tests for getPendingQueueStaleness, which traces each currently-pending
// variant's pending/rejected supersede chain back to its true start instead
// of reading the live row's own (frequently-reset) occurred_at. See ticket
// #16874: the naive `min(occurred_at) where status='pending'` read as
// "oldest under 1 hour" for 28 variants that had actually been stuck 5-11
// days, because pricing-apply-v2.server.ts supersedes a variant's stale
// pending row to rejected and writes a fresh pending row every day the batch
// recomputes a price for it.
import { describe, it, expect, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const executeMock = vi.hoisted(() => vi.fn())
vi.mock('./db.server', () => ({ db: { execute: executeMock } }))

import { getPendingQueueStaleness } from './pricing-admin.server'

describe('getPendingQueueStaleness', () => {
  it('reports the chain-start-derived oldest age, not a near-zero reset age', async () => {
    const oldest = new Date(Date.now() - 11 * 24 * 3600_000) // 11 days ago
    executeMock.mockResolvedValue({
      rows: [{ pending_count: 28, oldest_pending_at: oldest.toISOString() }],
    })

    const result = await getPendingQueueStaleness()

    expect(result.pendingCount).toBe(28)
    expect(result.oldestPendingAt).toEqual(oldest)
    expect(result.oldestPendingHours).toBeGreaterThanOrEqual(11 * 24 - 1)
  })

  it('returns a null age when the queue is empty', async () => {
    executeMock.mockResolvedValue({ rows: [{ pending_count: 0, oldest_pending_at: null }] })

    const result = await getPendingQueueStaleness()

    expect(result).toEqual({ pendingCount: 0, oldestPendingAt: null, oldestPendingHours: null })
  })

  it('bounds the chain at the most recent non-pending/rejected row, not unbounded history', async () => {
    // The guard against reintroducing the naive bug lives in the query text
    // itself (verified against live data in the ticket), not in this mock;
    // this asserts the query still excludes resolved rows from the chain
    // rather than reading raw min(occurred_at) over all history.
    executeMock.mockResolvedValue({ rows: [{ pending_count: 1, oldest_pending_at: null }] })
    await getPendingQueueStaleness()

    const { sql: query } = new PgDialect().sqlToQuery(executeMock.mock.calls[0]?.[0])
    expect(query).toMatch(/NOT IN \('pending', 'rejected'\)/)
    expect(query).toMatch(/chain_start/)
  })
})
