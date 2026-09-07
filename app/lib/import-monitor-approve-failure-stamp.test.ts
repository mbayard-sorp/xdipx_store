/**
 * Ticket #7983: approveAndImport() failures (e.g. "master no longer in
 * feed") were silent on the candidate row -- no count, no reason -- so a
 * systemically-broken import queue (confirmed during this ticket: the live
 * Nalpac feed's Brand column is empty feed-wide, so collapseMasters()
 * currently returns zero masters for the entire catalog, not just these
 * candidates) read as an ordinary, empty /admin/imports page instead of a
 * visible fleet of failures.
 *
 * This pins the "Independently" clause of the ticket's DONE WHEN:
 * approveAndImport() stamps import_attempt_count/import_last_error on the
 * candidate row on every failed attempt, so the failure is visible without a
 * manual per-row approve probe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateCalls = vi.hoisted(() => [] as { values: Record<string, unknown> }[])
const candidateRow = vi.hoisted(() => ({
  id: 1,
  sku: '98668',
  masterKey: 'shots|xkin bodyforms vivica lenore dual entry vibrating masturbator',
  importAttemptCount: 0,
  status: 'pending',
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [candidateRow],
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
vi.mock('~/lib/bulk-import.server', () => ({
  isSkuAlreadyImported: vi.fn(async () => false),
  importProductGroupRaw: vi.fn(),
}))

import { approveAndImport } from '~/lib/import-monitor.server'

beforeEach(() => {
  updateCalls.length = 0
})

describe('approveAndImport failure stamping (ticket #7983)', () => {
  it('stamps import_attempt_count and import_last_error when no live master matches the stored masterKey', async () => {
    const result = await approveAndImport(1, undefined, { preloadedMasters: [] })

    expect(result).toEqual({ ok: false, error: 'master no longer in feed' })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]!.values).toMatchObject({
      importAttemptCount: 1,
      importLastError:    'master no longer in feed',
    })
  })

  it('increments from the candidate row\'s existing attempt count rather than resetting it', async () => {
    candidateRow.importAttemptCount = 2
    const result = await approveAndImport(1, undefined, { preloadedMasters: [] })

    expect(result.ok).toBe(false)
    expect(updateCalls[0]!.values).toMatchObject({ importAttemptCount: 3 })
    candidateRow.importAttemptCount = 0
  })
})
