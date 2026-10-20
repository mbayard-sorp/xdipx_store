/**
 * Ticket #16435: the /admin/ads/audiences loader.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 *
 * loadAudiencesPage is swapped for the real one run against an in-memory
 * store, so the test covers the route wiring and the assembly together
 * without a database or Meta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/lib/session.server', () => ({ requireAdmin: requireAdminMock }))

const storeRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('~/lib/ads/audiences.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/audiences.server')>('~/lib/ads/audiences.server')
  return {
    ...actual,
    loadAudiencesPage: () => actual.loadAudiencesPage(storeRef.current as Parameters<typeof actual.loadAudiencesPage>[0]),
  }
})

import { loader } from '~/routes/admin.ads.audiences'
import type { AdsetMirrorRow, AudienceRow, AudienceStore } from '~/lib/ads/audiences.server'

function store(adsets: AdsetMirrorRow[], audiences: AudienceRow[]): AudienceStore {
  return {
    adsets: async () => adsets,
    upsert: async () => [],
    list: async () => audiences,
  }
}

async function run() {
  const request = new Request('https://xdipx.com/admin/ads/audiences')
  return loader({ request, params: {}, context: {} } as unknown as Parameters<typeof loader>[0])
}

describe('admin.ads.audiences loader', () => {
  beforeEach(() => { requireAdminMock.mockClear() })

  it('guards with requireAdmin and returns the empty state', async () => {
    storeRef.current = store([], [])
    const data = await run()
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
    expect(data).toEqual({ audiences: [], exclusions: [], lastSyncedAt: null })
  })

  it('returns audiences and a red mark for an ad set missing its exclusions', async () => {
    const syncedAt = new Date('2026-10-19T06:35:00Z')
    storeRef.current = store(
      [{ platform: 'meta', externalId: 's1', name: 'Leads | bare', status: 'PAUSED', effectiveStatus: 'PAUSED', raw: { targeting: {} } }],
      [{ platform: 'meta', externalId: '900', name: 'Shopify customers', kind: 'custom', role: 'unknown', approxSize: 1000, status: 'Normal', raw: null, syncedAt }],
    )
    const data = await run()
    expect(data.audiences).toEqual([expect.objectContaining({ externalId: '900', sizeLower: 1000, sizeUpper: null, syncedAt: syncedAt.toISOString() })])
    expect(data.exclusions).toEqual([expect.objectContaining({ externalId: 's1', ok: false, excluded: [] })])
  })
})
