/**
 * Owner-scoped media-asset adjudications (migration 100, ticket #10503).
 * Covers the storage seam: bare-url lookup (query string stripped, matching
 * social-asset-library.server's own convention), the upsert's input
 * validation, and delete. The db client is mocked; what's under test is this
 * module's contract, not drizzle itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResult: [] as unknown[],
  inserted: null as Record<string, unknown> | null,
  deleteResult: [] as unknown[],
}

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.selectResult,
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: (_opts: unknown) => ({
          returning: async () => {
            state.inserted = v
            return [{ id: 1, ...v, createdAt: new Date(), updatedAt: null }]
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => state.deleteResult,
      }),
    }),
  },
}))

import { clearAssetAdjudication, getAssetAdjudication, setAssetAdjudication } from './social-asset-adjudication.server'

beforeEach(() => {
  state.selectResult = []
  state.inserted = null
  state.deleteResult = []
})

describe('getAssetAdjudication', () => {
  it('returns null when nothing is on file', async () => {
    state.selectResult = []
    expect(await getAssetAdjudication('https://cdn.shopify.com/files/asset.jpg')).toBeNull()
  })

  it('returns the row when one is on file', async () => {
    state.selectResult = [{ id: 1, assetUrl: 'https://cdn.shopify.com/files/asset.jpg', overriddenFindings: ['age-ambiguity'], note: null, adjudicatedBy: 'owner', createdAt: new Date(), updatedAt: null }]
    const row = await getAssetAdjudication('https://cdn.shopify.com/files/asset.jpg')
    expect(row?.overriddenFindings).toEqual(['age-ambiguity'])
  })

  it('returns null for an empty url rather than querying', async () => {
    expect(await getAssetAdjudication('')).toBeNull()
  })
})

describe('setAssetAdjudication', () => {
  it('strips the query string before writing (Shopify appends ?v=<epoch>)', async () => {
    await setAssetAdjudication({
      url: 'https://cdn.shopify.com/files/asset.jpg?v=123',
      overriddenFindings: ['age-ambiguity'],
      adjudicatedBy: 'owner',
    })
    expect(state.inserted?.['assetUrl']).toBe('https://cdn.shopify.com/files/asset.jpg')
  })

  it('trims blank entries out of overriddenFindings', async () => {
    await setAssetAdjudication({
      url: 'https://cdn.shopify.com/files/asset.jpg',
      overriddenFindings: [' age-ambiguity ', '', '  '],
      adjudicatedBy: 'owner',
    })
    expect(state.inserted?.['overriddenFindings']).toEqual(['age-ambiguity'])
  })

  it('refuses an empty url', async () => {
    await expect(setAssetAdjudication({ url: '', overriddenFindings: ['x'], adjudicatedBy: 'owner' }))
      .rejects.toThrow(/url is required/)
  })

  it('refuses when every finding is blank (nothing to adjudicate)', async () => {
    await expect(setAssetAdjudication({ url: 'https://cdn.shopify.com/files/asset.jpg', overriddenFindings: ['', '  '], adjudicatedBy: 'owner' }))
      .rejects.toThrow(/at least one finding/)
  })
})

describe('clearAssetAdjudication', () => {
  it('returns true when a row existed and was removed', async () => {
    state.deleteResult = [{ id: 1 }]
    expect(await clearAssetAdjudication('https://cdn.shopify.com/files/asset.jpg')).toBe(true)
  })

  it('returns false when nothing was on file', async () => {
    state.deleteResult = []
    expect(await clearAssetAdjudication('https://cdn.shopify.com/files/asset.jpg')).toBe(false)
  })

  it('returns false for an empty url rather than deleting', async () => {
    expect(await clearAssetAdjudication('')).toBe(false)
  })
})
