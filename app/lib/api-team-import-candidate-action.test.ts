/**
 * Ticket #4099: the approve path used to chunk at 10 ids per request. Each
 * approve is ~12-15s of sequential Shopify Admin calls, so a 10-id chunk
 * (~120-150s) reliably meets or exceeds the serverless+proxy timeout -- it
 * reset mid-chunk on the 2026-08-18 product-daily run (curl exit 35), while a
 * 4-id batch succeeded. `MAX_APPROVALS_PER_REQUEST` is now 5. These tests
 * pin that ceiling and prove the `deferred` remainder mechanism still drains
 * a full-cap (20-id) approve batch correctly at the smaller size, plus that
 * reject/watch stay unchunked since they are cheap DB writes, not Shopify
 * calls.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => 'true') }))
vi.mock('~/lib/import-monitor.server', () => ({
  approveAndImport: vi.fn(async (id: number) => ({ ok: true, id })),
  updateCandidateStatus: vi.fn(async () => undefined),
}))
vi.mock('~/lib/nalpac-feeds.server', () => ({ fetchAllNalpacFeeds: vi.fn(async () => ({ snapshots: [] })) }))
vi.mock('~/lib/master-collapse.server', () => ({ collapseMasters: vi.fn(() => []) }))
vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 0 }]),
      }),
    }),
  },
}))

import { action, splitApprovalChunk } from '~/routes/api.team.import-candidate-action'

describe('splitApprovalChunk', () => {
  it('caps approve at the default (5) chunk size and defers the rest', () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1)
    const { toProcess, deferred } = splitApprovalChunk(ids, 'approve')
    expect(toProcess).toEqual([1, 2, 3, 4, 5])
    expect(deferred).toEqual(ids.slice(5))
    expect(toProcess.length).toBeLessThanOrEqual(5)
  })

  it('does not chunk reject/watch, which are cheap DB writes', () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(splitApprovalChunk(ids, 'reject')).toEqual({ toProcess: ids, deferred: [] })
    expect(splitApprovalChunk(ids, 'watch')).toEqual({ toProcess: ids, deferred: [] })
  })

  it('drains a full-cap batch across repeated calls, resubmitting only the deferred remainder', () => {
    let remaining = Array.from({ length: 20 }, (_, i) => i + 1)
    const drained: number[] = []
    let iterations = 0
    while (remaining.length > 0) {
      const { toProcess, deferred } = splitApprovalChunk(remaining, 'approve')
      expect(toProcess.length).toBeLessThanOrEqual(5)
      drained.push(...toProcess)
      remaining = deferred
      iterations += 1
      expect(iterations).toBeLessThanOrEqual(10) // guard against an infinite loop
    }
    expect(drained).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(iterations).toBe(4) // 20 ids / 5 per chunk
  })

  it('respects an explicit perRequestLimit override', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7]
    expect(splitApprovalChunk(ids, 'approve', 3)).toEqual({ toProcess: [1, 2, 3], deferred: [4, 5, 6, 7] })
  })
})

function post(body: URLSearchParams): Request {
  return new Request('https://xdipx.com/api/team/import-candidate-action', {
    method: 'POST',
    body,
  })
}

describe('action (bulk approve)', () => {
  it('returns at most 5 results per request and reports the rest as deferred', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1)
    const body = new URLSearchParams({ intent: 'approve', ids: ids.join(',') })
    const res = await action({ request: post(body) } as never)
    const json = await (res as Response).json()
    expect(json.ok).toBe(true)
    expect(json.results.length).toBeLessThanOrEqual(5)
    expect(json.deferred.length).toBe(15)
  })
})
