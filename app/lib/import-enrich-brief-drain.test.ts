/**
 * Ticket #4881: an unbriefable candidate must not jam the enrichment queue.
 *
 * Both enrichment transports select candidates with `LIMIT cap ORDER BY id ASC`
 * over the predicate `status='imported' AND enriched_at IS NULL AND
 * enrich_batch_id IS NULL AND enrich_failed_at IS NULL`. Before this fix, a row
 * whose gatherProductBrief() returned null (e.g. its Shopify product was deleted
 * after import) was skipped WITHOUT being stamped or parked, so a block of
 * permanently-unbriefable rows occupied the entire selection window forever and
 * no younger candidate was ever reached — the "16-candidate enrichment wall".
 *
 * The fix routes a null-brief row through applyEnrichFailure(): a transient
 * failure gets its bounded retry, and after ENRICH_MAX_ATTEMPTS (2) the row is
 * parked (enrich_failed_at set), which drops it out of the selection predicate
 * and lets a younger candidate through.
 *
 * These tests drive the REAL submitEnrichmentBatch / claimEnrichmentForSubagent
 * against a small stateful in-memory table (db.server, enricher-brief.server and
 * the batch submitter are mocked at import time), so the drain-and-advance
 * property is proven end-to-end, not simulated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Cand = {
  id: number
  productId: string
  sku: string | null
  status: string
  enrichedAt: Date | null
  enrichBatchId: string | null
  enrichFailedAt: Date | null
  enrichAttempts: number
}

const world = vi.hoisted(() => ({
  table: [] as any[],
  deadProducts: new Set<string>(),
  lastNullBriefId: null as number | null,
  chunkBriefableIds: [] as number[],
  submitCalls: [] as Array<{ productIds: string[] }>,
  batchSeq: 0,
}))

// Attribute each db.update to the candidate it belongs to. A stamp update
// (enrich_batch_id set to a truthy id/lease) applies to the briefable rows
// gathered since the last stamp; a disposition update (retry clears
// enrich_batch_id, park sets enrich_failed_at) applies to the row whose brief
// just came back null.
function applyUpdate(vals: Record<string, any>) {
  if (vals.enrichBatchId) {
    for (const id of world.chunkBriefableIds) {
      const row = world.table.find(r => r.id === id)
      if (row) Object.assign(row, vals)
    }
    world.chunkBriefableIds = []
  } else {
    const row = world.table.find(r => r.id === world.lastNullBriefId)
    if (row) Object.assign(row, vals)
  }
}

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: (cap: number) => {
                // Reset per-pass brief tracking as each selection window opens.
                world.chunkBriefableIds = []
                const eligible = world.table
                  .filter(r => r.status === 'imported' && !r.enrichedAt && !r.enrichBatchId && !r.enrichFailedAt)
                  .sort((a, b) => a.id - b.id)
                  .slice(0, cap)
                return Promise.resolve(eligible.map(r => ({ ...r })))
              },
            }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, any>) => ({
        where: () => {
          applyUpdate(vals)
          return Promise.resolve()
        },
      }),
    }),
  },
}))

vi.mock('~/lib/enricher-brief.server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSharedEnrichmentContext: vi.fn(async () => ({})),
  gatherProductBrief: vi.fn(async (productId: string) => {
    const row = world.table.find(r => r.productId === productId)
    if (world.deadProducts.has(productId)) {
      if (row) world.lastNullBriefId = row.id
      return null
    }
    if (row) world.chunkBriefableIds.push(row.id)
    return { productId, pairingCandidates: [] } as any
  }),
}))

vi.mock('~/lib/batch-enrichment.server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  submitFullEnrichmentBatch: vi.fn(async (inputs: any[]) => {
    world.submitCalls.push({ productIds: inputs.map(i => i.productId) })
    return { batchId: `batch_test_${world.batchSeq++}` }
  }),
}))

import { submitEnrichmentBatch, claimEnrichmentForSubagent } from '~/lib/import-enrich.server'

const byId = (id: number): Cand => world.table.find(r => r.id === id)

/** Three unbriefable rows (ids 1-3) ahead of one briefable younger row (id 4). */
function seedJammedWindow() {
  world.table = [1, 2, 3, 4].map(id => ({
    id,
    productId: id === 4 ? 'p-young' : `p-dead-${id}`,
    sku: `SKU-${id}`,
    status: 'imported',
    enrichedAt: null,
    enrichBatchId: null,
    enrichFailedAt: null,
    enrichAttempts: 0,
  }))
  world.deadProducts = new Set(['p-dead-1', 'p-dead-2', 'p-dead-3'])
  world.lastNullBriefId = null
  world.chunkBriefableIds = []
  world.submitCalls = []
  world.batchSeq = 0
}

beforeEach(seedJammedWindow)

describe('submitEnrichmentBatch drains an unbriefable window (#4881)', () => {
  it('parks the jamming window within two passes and then reaches the younger candidate', async () => {
    // Pass 1: the window is the three unbriefable rows (cap 3); the younger row
    // (id 4) is outside the window and never reached.
    let res = await submitEnrichmentBatch(3)
    expect(world.submitCalls).toHaveLength(0)
    expect(res.reason).toBe('no_briefs')
    for (const id of [1, 2, 3]) {
      expect(byId(id).enrichAttempts).toBe(1) // retried, not yet parked
      expect(byId(id).enrichFailedAt).toBeNull()
    }
    expect(byId(4).enrichAttempts).toBe(0) // never selected

    // Pass 2: same window, second failure -> parked at ENRICH_MAX_ATTEMPTS.
    res = await submitEnrichmentBatch(3)
    expect(world.submitCalls).toHaveLength(0)
    for (const id of [1, 2, 3]) {
      expect(byId(id).enrichAttempts).toBe(2)
      expect(byId(id).enrichFailedAt).toBeInstanceOf(Date) // drained within two passes
    }

    // Pass 3: parked rows drop out of the isNull(enrich_failed_at) predicate,
    // so the younger briefable candidate is finally reached and submitted.
    res = await submitEnrichmentBatch(3)
    expect(world.submitCalls).toHaveLength(1)
    expect(world.submitCalls[0]!.productIds).toEqual(['p-young'])
    expect(byId(4).enrichBatchId).toMatch(/^batch_test_/)
    expect(res.submitted).toBe(1)
  })
})

describe('claimEnrichmentForSubagent drains an unbriefable window (#4881)', () => {
  it('parks the jamming window within two passes and then reaches the younger candidate', async () => {
    // Pass 1: three unbriefable rows are skipped-but-now-dispositioned.
    let res = await claimEnrichmentForSubagent(3, 'run-a')
    expect(res.claims).toHaveLength(0)
    expect(res.skippedNoBrief).toBe(3)
    for (const id of [1, 2, 3]) {
      expect(byId(id).enrichAttempts).toBe(1)
      expect(byId(id).enrichFailedAt).toBeNull()
    }
    expect(byId(4).enrichAttempts).toBe(0)

    // Pass 2: second failure parks them.
    res = await claimEnrichmentForSubagent(3, 'run-b')
    expect(res.claims).toHaveLength(0)
    for (const id of [1, 2, 3]) {
      expect(byId(id).enrichAttempts).toBe(2)
      expect(byId(id).enrichFailedAt).toBeInstanceOf(Date)
    }

    // Pass 3: the younger candidate is reached and leased.
    res = await claimEnrichmentForSubagent(3, 'run-c')
    expect(res.claims).toHaveLength(1)
    expect(res.claims[0]!.productId).toBe('p-young')
    expect(res.skippedNoBrief).toBe(0)
    expect(byId(4).enrichBatchId).toBe('subagent:run-c')
  })
})
