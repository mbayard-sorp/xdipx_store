/**
 * Ticket #554: reviewed_by/reviewed_at are review stamps, and a review is a
 * TERMINAL decision. Only 'rejected' (here) and 'imported' (approveAndImport)
 * may carry the stamp; 'watching' is bookkeeping and must not, because the
 * monitor's watching->pending reopen used to carry the stamp into 'pending',
 * where run137's sweep found 77 stamped-but-pending limbo rows burning the
 * daily action cap and cluttering every sweep.
 *
 * db.server and kv.server are mocked at import time; assertions run against
 * the values handed to the query builder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  selectResults: [] as unknown[][],
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(vals)
          return Promise.resolve()
        },
      }),
    }),
    select: () => ({
      from: () => {
        const chain: Record<string, unknown> = {}
        chain['where'] = () => chain
        chain['limit'] = () => Promise.resolve(state.selectResults.shift() ?? [])
        return chain
      },
    }),
    execute: vi.fn(async () => ({ rows: [] })),
  },
}))

vi.mock('~/lib/kv.server', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
}))

import { updateCandidateStatus } from '~/lib/import-monitor.server'

beforeEach(() => {
  state.updates = []
  state.selectResults = []
})

describe('updateCandidateStatus review stamping', () => {
  it('stamps reviewed_by/reviewed_at on the terminal reject', async () => {
    await updateCandidateStatus(41, 'rejected', {
      reviewedBy: 'product-manager-agent',
      rejectionReason: 'duplicate of carried SKU',
    })
    const vals = state.updates[0]!
    expect(vals['status']).toBe('rejected')
    expect(vals['reviewedBy']).toBe('product-manager-agent')
    expect(vals['reviewedAt']).toBeInstanceOf(Date)
    expect(vals['rejectionReason']).toBe('duplicate of carried SKU')
  })

  it('does NOT stamp a watch, which is bookkeeping rather than a terminal review', async () => {
    state.selectResults = [[{ dealScore: '7.5', proposedPrice: '19.99' }]]
    await updateCandidateStatus(42, 'watching', { reviewedBy: 'product-manager-agent' })
    const vals = state.updates[0]!
    expect(vals['status']).toBe('watching')
    // The stamp keys are absent entirely, not merely null: this write must be
    // unable to touch reviewed_by, so a later watching->pending reopen has
    // nothing to leak into the pending pool.
    expect('reviewedBy' in vals).toBe(false)
    expect('reviewedAt' in vals).toBe(false)
    // The watch snapshot still lands.
    expect(vals['watchScore']).toBe('7.5')
    expect(vals['watchPrice']).toBe('19.99')
  })
})
