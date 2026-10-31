import { describe, expect, it } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
import { vi } from 'vitest'
vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  ensureOwnerBuiltCreatives, resolveCampaignExternalId, selectEligibleAds,
  type MirrorAdRow, type MirrorCampaignRow, type OwnerBuiltCreativesStore,
} from './owner-built-creatives.server'

function ad(over: Partial<MirrorAdRow> = {}): MirrorAdRow {
  return {
    platform: 'meta', externalId: 'ad-1', parentExternalId: 'adset-1', name: 'womanizer-24 Connection',
    status: 'ACTIVE', effectiveStatus: 'ACTIVE', ...over,
  }
}

describe('selectEligibleAds (ticket #18774)', () => {
  it('keeps ACTIVE and PAUSED ads, by effective_status when present', () => {
    const ads = [
      ad({ externalId: 'a', effectiveStatus: 'ACTIVE', status: 'ACTIVE' }),
      ad({ externalId: 'b', effectiveStatus: 'PAUSED', status: 'ACTIVE' }),
      ad({ externalId: 'c', effectiveStatus: null, status: 'active' }), // falls back to status, case-insensitive
    ]
    expect(selectEligibleAds(ads).map(a => a.externalId)).toEqual(['a', 'b', 'c'])
  })

  it('drops archived, deleted, disapproved and missing ads', () => {
    const ads = [
      ad({ externalId: 'archived', effectiveStatus: 'ARCHIVED' }),
      ad({ externalId: 'deleted', effectiveStatus: 'DELETED' }),
      ad({ externalId: 'disapproved', status: 'DISAPPROVED', effectiveStatus: null }),
      ad({ externalId: 'missing', status: 'MISSING', effectiveStatus: null }),
      ad({ externalId: 'no-status', status: null, effectiveStatus: null }),
    ]
    expect(selectEligibleAds(ads)).toEqual([])
  })
})

describe('resolveCampaignExternalId (ticket #18774)', () => {
  it('walks ad -> adset -> campaign through the mirror parent chain', () => {
    const parents = new Map([['adset-1', 'campaign-1']])
    expect(resolveCampaignExternalId(ad({ parentExternalId: 'adset-1' }), parents)).toBe('campaign-1')
  })

  it('returns null when the ad has no parent, or the adset was not in this mirror pass', () => {
    const parents = new Map([['adset-1', 'campaign-1']])
    expect(resolveCampaignExternalId(ad({ parentExternalId: null }), parents)).toBeNull()
    expect(resolveCampaignExternalId(ad({ parentExternalId: 'adset-unknown' }), parents)).toBeNull()
  })

  it('returns null when the mirrored adset itself has no parent yet', () => {
    const parents = new Map([['adset-1', null]])
    expect(resolveCampaignExternalId(ad({ parentExternalId: 'adset-1' }), parents)).toBeNull()
  })
})

/** In-memory twin of the store, enough to prove the orchestration end to end. */
function memoryStore(opts: {
  ads?: MirrorAdRow[]
  adsetParents?: Map<string, string | null>
  campaigns?: MirrorCampaignRow[]
  existingCampaignIds?: Map<string, number>
} = {}) {
  const linked: Array<{ platform: string; externalId: string; creativeId: number }> = []
  const createdCampaigns: MirrorCampaignRow[] = []
  const createdCreatives: Array<{ adCampaignId: number; assetId: number; ad: MirrorAdRow }> = []
  let nextCampaignId = 1000
  let nextCreativeId = 2000
  let assetCreated = 0

  const store: OwnerBuiltCreativesStore = {
    async unlinkedAds() { return opts.ads ?? [] },
    async adsetParents() { return opts.adsetParents ?? new Map() },
    async campaigns() { return opts.campaigns ?? [] },
    async existingCampaignIds() { return new Map(opts.existingCampaignIds ?? new Map()) },
    async createCampaign(c) {
      createdCampaigns.push(c)
      return nextCampaignId++
    },
    async placeholderAssetId() {
      assetCreated++
      return 42
    },
    async createCreative(c) {
      createdCreatives.push(c)
      return nextCreativeId++
    },
    async linkCreative(platform, externalId, creativeId) {
      linked.push({ platform, externalId, creativeId })
    },
  }
  return { store, linked, createdCampaigns, createdCreatives, assetCreatedCount: () => assetCreated }
}

describe('ensureOwnerBuiltCreatives (ticket #18774)', () => {
  it('does nothing when there are no unlinked ads', async () => {
    const { store, createdCampaigns, createdCreatives } = memoryStore({ ads: [] })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result).toEqual({ campaignsCreated: 0, creativesCreated: 0, linked: 0, skippedNoCampaign: 0 })
    expect(createdCampaigns).toEqual([])
    expect(createdCreatives).toEqual([])
  })

  it('does nothing for an unlinked ad whose status is not ACTIVE/PAUSED', async () => {
    const { store, createdCreatives } = memoryStore({
      ads: [ad({ externalId: 'archived-ad', effectiveStatus: 'ARCHIVED' })],
    })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result.creativesCreated).toBe(0)
    expect(createdCreatives).toEqual([])
  })

  it('creates a placeholder campaign and creative for a fresh owner-built ad, and links it back', async () => {
    const { store, linked, createdCampaigns, createdCreatives, assetCreatedCount } = memoryStore({
      ads: [ad({ platform: 'meta', externalId: 'ad-1', parentExternalId: 'adset-1' })],
      adsetParents: new Map([['adset-1', 'campaign-1']]),
      campaigns: [{ externalId: 'campaign-1', platform: 'meta', name: 'Advent26', objective: 'OUTCOME_SALES' }],
    })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result).toEqual({ campaignsCreated: 1, creativesCreated: 1, linked: 1, skippedNoCampaign: 0 })
    expect(createdCampaigns).toEqual([{ externalId: 'campaign-1', platform: 'meta', name: 'Advent26', objective: 'OUTCOME_SALES' }])
    expect(createdCreatives).toHaveLength(1)
    expect(createdCreatives[0]!.ad.externalId).toBe('ad-1')
    expect(linked).toEqual([{ platform: 'meta', externalId: 'ad-1', creativeId: 2000 }])
    expect(assetCreatedCount()).toBe(1)
  })

  it('reuses an already-mirrored ad_campaigns row by external_campaign_id instead of creating a duplicate', async () => {
    const { store, createdCampaigns, createdCreatives } = memoryStore({
      ads: [ad({ externalId: 'ad-1', parentExternalId: 'adset-1' })],
      adsetParents: new Map([['adset-1', 'campaign-1']]),
      campaigns: [{ externalId: 'campaign-1', platform: 'meta', name: 'Advent26', objective: 'OUTCOME_SALES' }],
      existingCampaignIds: new Map([['campaign-1', 777]]),
    })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result.campaignsCreated).toBe(0)
    expect(createdCampaigns).toEqual([])
    expect(createdCreatives[0]!.adCampaignId).toBe(777)
  })

  it('creates one shared placeholder campaign for two ads under the same campaign, not two', async () => {
    const { store, createdCampaigns, createdCreatives } = memoryStore({
      ads: [
        ad({ externalId: 'ad-1', parentExternalId: 'adset-1' }),
        ad({ externalId: 'ad-2', parentExternalId: 'adset-2' }),
      ],
      adsetParents: new Map([['adset-1', 'campaign-1'], ['adset-2', 'campaign-1']]),
      campaigns: [{ externalId: 'campaign-1', platform: 'meta', name: 'Advent26', objective: 'OUTCOME_SALES' }],
    })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result.campaignsCreated).toBe(1)
    expect(createdCampaigns).toHaveLength(1)
    expect(createdCreatives).toHaveLength(2)
    expect(createdCreatives[0]!.adCampaignId).toBe(createdCreatives[1]!.adCampaignId)
  })

  it('skips an eligible ad whose campaign was not itself in this mirror pass, and counts it', async () => {
    const { store, createdCreatives } = memoryStore({
      ads: [ad({ externalId: 'ad-1', parentExternalId: 'adset-1' })],
      adsetParents: new Map([['adset-1', 'campaign-1']]),
      campaigns: [], // the campaign-level row has not been mirrored yet
    })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result.skippedNoCampaign).toBe(1)
    expect(result.creativesCreated).toBe(0)
    expect(createdCreatives).toEqual([])
  })

  it('skips an eligible ad with no parent adset at all', async () => {
    const { store, createdCreatives } = memoryStore({ ads: [ad({ parentExternalId: null })] })
    const result = await ensureOwnerBuiltCreatives(store)
    expect(result.skippedNoCampaign).toBe(1)
    expect(createdCreatives).toEqual([])
  })

  it('creates the placeholder media asset at most once per run even across several new creatives', async () => {
    const { store, assetCreatedCount } = memoryStore({
      ads: [
        ad({ externalId: 'ad-1', parentExternalId: 'adset-1' }),
        ad({ externalId: 'ad-2', parentExternalId: 'adset-1' }),
      ],
      adsetParents: new Map([['adset-1', 'campaign-1']]),
      campaigns: [{ externalId: 'campaign-1', platform: 'meta', name: 'Advent26', objective: 'OUTCOME_SALES' }],
    })
    await ensureOwnerBuiltCreatives(store)
    expect(assetCreatedCount()).toBe(1)
  })
})
