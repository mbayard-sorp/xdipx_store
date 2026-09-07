/**
 * Ticket #8016: the isSkuAlreadyImported early-return in approveAndImport()
 * stamped status:'imported' on the candidate row without backfilling
 * dealHistoryId to the existing dealHistory row for that SKU. Because
 * snapshotEnrichFunnel and the stall watchdog query import_candidates
 * directly while submitEnrichmentBatch and claimEnrichmentForSubagent INNER
 * JOIN dealHistory, a row left with a NULL dealHistoryId is permanently
 * counted as outstanding "importedUnenriched" work yet is structurally
 * invisible to both enrichment transports and can never self-clear.
 *
 * Confirmed live instance: candidate 3441 (sku 98913) duplicates candidate
 * 3491's SKU (dealHistory id 5266, already imported/enriched/published).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateCalls = vi.hoisted(() => [] as { values: Record<string, unknown> }[])
// Queue of rows returned by successive db.select().from().where().limit()
// calls, in call order: [0] is always the candidate lookup by id; [1], only
// reached when isSkuAlreadyImported() is true, is the dealHistory lookup.
const selectResponses = vi.hoisted(() => [] as unknown[][])
const candidateRow = vi.hoisted(() => ({
  id: 3441,
  sku: '98913',
  masterKey: 'shots|some-duplicate-master',
  importAttemptCount: 0,
  status: 'pending',
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ values })
          return undefined
        },
      }),
    }),
  },
}))
const isSkuAlreadyImportedMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('~/lib/bulk-import.server', () => ({
  isSkuAlreadyImported: isSkuAlreadyImportedMock,
  importProductGroupRaw: vi.fn(),
}))

import { approveAndImport } from '~/lib/import-monitor.server'

beforeEach(() => {
  updateCalls.length = 0
  selectResponses.length = 0
  isSkuAlreadyImportedMock.mockResolvedValue(true)
})

describe('approveAndImport backfills dealHistoryId on the already-imported SKU guard (#8016)', () => {
  it('sets dealHistoryId to the existing dealHistory row for that SKU', async () => {
    selectResponses.push([candidateRow], [{ id: 5266 }])

    const result = await approveAndImport(3441)

    expect(result).toEqual({ ok: true, skipped: true, dealHistoryId: 5266 })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]!.values).toMatchObject({ status: 'imported', dealHistoryId: 5266 })
  })

  it('still marks the candidate imported, without a dealHistoryId, when no dealHistory row is found', async () => {
    // Should not happen while isSkuAlreadyImported() is the gate deciding
    // whether we reach this branch, but the branch must degrade cleanly
    // rather than crash on a stale/since-deleted dealHistory row.
    selectResponses.push([candidateRow], [])

    const result = await approveAndImport(3441)

    expect(result).toEqual({ ok: true, skipped: true })
    expect(updateCalls[0]!.values).toMatchObject({ status: 'imported' })
    expect(updateCalls[0]!.values).not.toHaveProperty('dealHistoryId')
  })
})
