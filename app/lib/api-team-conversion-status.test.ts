/**
 * Guard tests for GET /api/team/conversion-status, the QA-gate substitute for
 * a direct psql count on meta_capi_outbox / ga4_purchase_outbox (routine
 * QA's egress is restricted to xdipx.com, so it cannot reach DATABASE_URL
 * directly). db.server and team.server are mocked at import time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  // Queued in call order: first call is metaCapiOutbox, second is
  // ga4PurchaseOutbox (Promise.all preserves array order regardless of
  // resolution order).
  selectResults: [] as Array<Array<Record<string, unknown>>>,
}

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.selectResults.shift() ?? []),
      }),
    }),
  },
}))
vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))

import { loader } from '~/routes/api.team.conversion-status'

function get(): Promise<Response> {
  const request = new Request('http://localhost/api/team/conversion-status')
  return loader({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  state.selectResults = []
})

describe('GET /api/team/conversion-status', () => {
  it('returns unresolved counts and oldest-age-in-hours for both queues', async () => {
    state.selectResults = [
      [{ count: 3, oldestHours: 26.5 }],
      [{ count: 0, oldestHours: null }],
    ]
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      metaCapiUnresolvedCount: 3,
      metaCapiOldestAgeHours: 26.5,
      ga4UnresolvedCount: 0,
      ga4OldestAgeHours: null,
    })
  })

  it('defaults to zero/null when a queue has no rows at all', async () => {
    state.selectResults = [[], []]
    const res = await get()
    expect(await res.json()).toEqual({
      metaCapiUnresolvedCount: 0,
      metaCapiOldestAgeHours: null,
      ga4UnresolvedCount: 0,
      ga4OldestAgeHours: null,
    })
  })
})
