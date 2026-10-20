import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import type { ChannelAdapter, ChannelId, EntityLevel, NormalizedEntity, TokenHealth } from './channels/types'
import {
  MISSING_STATUS, buildUpsertQuery, syncAfterWrite, syncAllChannels, syncChannelEntities,
  type EntityStore, type EntityUpsertRow, type UpsertOutcome,
} from './sync.server'

type StoredRow = EntityUpsertRow & { firstSeenAt: Date; lastSyncedAt: Date }

/** In-memory twin of the Drizzle store, holding the same rules the SQL does. */
function memoryStore(creatives: Record<string, number> = {}) {
  const rows = new Map<string, StoredRow>()
  const key = (platform: string, id: string) => `${platform}|${id}`
  const store: EntityStore = {
    async creativeIdsByExternalAdId(ids) {
      const out = new Map<string, number>()
      for (const id of ids) if (creatives[id] !== undefined) out.set(id, creatives[id])
      return out
    },
    async upsert(input, now) {
      const out: UpsertOutcome[] = []
      for (const r of input) {
        const k = key(r.platform, r.externalId)
        const prev = rows.get(k)
        rows.set(k, {
          ...r,
          creativeId: r.creativeId ?? prev?.creativeId ?? null,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSyncedAt: now,
        })
        out.push({ externalId: r.externalId, level: r.level, inserted: !prev })
      }
      return out
    },
    async markMissing(platform, seen) {
      const keep = new Set(seen)
      const changed: EntityLevel[] = []
      for (const r of rows.values()) {
        if (r.platform !== platform || keep.has(r.externalId) || r.status === MISSING_STATUS) continue
        r.status = MISSING_STATUS
        changed.push(r.level)
      }
      return changed
    },
  }
  return { store, rows, get: (id: string) => rows.get(key('meta', id)) }
}

function entity(level: NormalizedEntity['level'], externalId: string, over: Partial<NormalizedEntity> = {}): NormalizedEntity {
  return {
    platform: 'meta', accountId: 'act_1', level, externalId,
    parentExternalId: null, name: `${level} ${externalId}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    objective: level === 'campaign' ? 'OUTCOME_LEADS' : null,
    dailyBudgetCents: level === 'adset' ? 1500 : null, lifetimeBudgetCents: null, bidStrategy: null,
    reviewFeedback: null, raw: { id: externalId },
    ...over,
  }
}

const ACCOUNT = [
  entity('campaign', 'c1'),
  entity('adset', 's1', { parentExternalId: 'c1' }),
  entity('ad', 'a1', { parentExternalId: 's1' }),
  entity('ad', 'a2', { parentExternalId: 's1' }),
]

const VALID: TokenHealth = { valid: true, expiresAt: null, scopes: ['ads_read'], checkedAt: '2026-10-19T00:00:00Z' }

function fakeAdapter(pull: () => NormalizedEntity[], health: TokenHealth = VALID, read = true) {
  const syncEntities = vi.fn(async (_opts: { since?: Date }) => pull())
  const mutate = vi.fn()
  const createPaused = vi.fn()
  const adapter = {
    id: 'meta',
    capabilities: { read, insights: true, mutate: [], audiences: 'none', preview: false },
    auth: { health: vi.fn(async () => health) },
    syncEntities,
    pullInsights: vi.fn(),
    createPaused,
    mutate,
    policyCheck: vi.fn(),
  } as unknown as ChannelAdapter
  return { adapter, syncEntities, mutate, createPaused }
}

const T1 = new Date('2026-10-19T06:35:00Z')
const T2 = new Date('2026-10-19T12:35:00Z')

describe('syncChannelEntities', () => {
  it('inserts every entity on the first run and counts per level', async () => {
    const m = memoryStore()
    const f = fakeAdapter(() => ACCOUNT)
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    expect(f.syncEntities).toHaveBeenCalledWith({})
    expect(r.full).toBe(true)
    expect(r.counts.campaign).toEqual({ seen: 1, inserted: 1, updated: 0, missing: 0 })
    expect(r.counts.adset).toEqual({ seen: 1, inserted: 1, updated: 0, missing: 0 })
    expect(r.counts.ad).toEqual({ seen: 2, inserted: 2, updated: 0, missing: 0 })
    expect(m.get('a1')?.firstSeenAt).toEqual(T1)
    expect(m.get('a1')?.parentExternalId).toBe('s1')
    expect(f.mutate).not.toHaveBeenCalled()
    expect(f.createPaused).not.toHaveBeenCalled()
  })

  it('updates on a later run, keeps first_seen_at and moves last_synced_at', async () => {
    const m = memoryStore()
    let pull = ACCOUNT
    const f = fakeAdapter(() => pull)
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    pull = ACCOUNT.map(e => (e.externalId === 'a1' ? { ...e, effectiveStatus: 'DISAPPROVED' } : e))
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T2 })
    expect(r.counts.ad).toEqual({ seen: 2, inserted: 0, updated: 2, missing: 0 })
    expect(m.get('a1')?.effectiveStatus).toBe('DISAPPROVED')
    expect(m.get('a1')?.firstSeenAt).toEqual(T1)
    expect(m.get('a1')?.lastSyncedAt).toEqual(T2)
  })

  it('links ads to ad_creatives by external_ad_id and keeps a link once found', async () => {
    const creatives: Record<string, number> = { a1: 42 }
    const m = memoryStore(creatives)
    const f = fakeAdapter(() => ACCOUNT)
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    expect(r.creativeMatches).toBe(1)
    expect(m.get('a1')?.creativeId).toBe(42)
    expect(m.get('a2')?.creativeId).toBeNull()
    expect(m.get('c1')?.creativeId).toBeNull()

    delete creatives['a1']
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T2 })
    expect(m.get('a1')?.creativeId).toBe(42)
  })

  it('only looks up creatives for ad-level rows', async () => {
    const m = memoryStore()
    const spy = vi.spyOn(m.store, 'creativeIdsByExternalAdId')
    const f = fakeAdapter(() => ACCOUNT)
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    expect(spy).toHaveBeenCalledWith(['a1', 'a2'])
  })

  it('marks entities the platform stopped returning as MISSING after a full sync', async () => {
    const m = memoryStore()
    let pull = ACCOUNT
    const f = fakeAdapter(() => pull)
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    pull = ACCOUNT.filter(e => e.externalId !== 'a2')
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T2 })
    expect(r.counts.ad.missing).toBe(1)
    expect(m.get('a2')?.status).toBe(MISSING_STATUS)
    expect(m.get('a2')?.lastSyncedAt).toEqual(T1)
    expect(m.get('a1')?.status).toBe('ACTIVE')

    // It comes back: the platform's status replaces MISSING.
    pull = ACCOUNT
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T2 })
    expect(m.get('a2')?.status).toBe('ACTIVE')
  })

  it('marks nothing MISSING when the pull fails', async () => {
    const m = memoryStore()
    const spy = vi.spyOn(m.store, 'markMissing')
    const f = fakeAdapter(() => { throw new Error('rate_limited') })
    await expect(syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter })).rejects.toThrow('rate_limited')
    expect(spy).not.toHaveBeenCalled()
  })

  it('marks nothing MISSING when a full pull comes back empty', async () => {
    const m = memoryStore()
    let pull = ACCOUNT
    const f = fakeAdapter(() => pull)
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    pull = []
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T2 })
    expect(r.full).toBe(false)
    expect([...m.rows.values()].every(row => row.status === 'ACTIVE')).toBe(true)
  })

  it('is idempotent: a second identical run inserts nothing and marks nothing', async () => {
    const m = memoryStore({ a1: 7 })
    const f = fakeAdapter(() => ACCOUNT.filter(e => e.externalId !== 'a2'))
    await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    const snapshot = JSON.stringify([...m.rows.values()].map(r => ({ ...r, lastSyncedAt: null })))
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T2 })
    for (const level of ['campaign', 'adset', 'ad', 'creative'] as const) {
      expect(r.counts[level].inserted, level).toBe(0)
      expect(r.counts[level].missing, level).toBe(0)
    }
    expect(m.rows.size).toBe(3)
    expect(JSON.stringify([...m.rows.values()].map(row => ({ ...row, lastSyncedAt: null })))).toBe(snapshot)
  })

  it('dedupes an id the platform returned twice', async () => {
    const m = memoryStore()
    const spy = vi.spyOn(m.store, 'upsert')
    const f = fakeAdapter(() => [...ACCOUNT, entity('ad', 'a1', { name: 'renamed' })])
    const r = await syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    expect(r.counts.ad.seen).toBe(2)
    expect(spy.mock.calls[0]?.[0].filter(x => x.externalId === 'a1')).toHaveLength(1)
    expect(m.get('a1')?.name).toBe('renamed')
  })

  it('refuses a channel with no adapter or no read capability', async () => {
    const m = memoryStore()
    await expect(syncChannelEntities('reddit', { store: m.store, adapterFor: () => null })).rejects.toThrow(/no adapter/)
    const f = fakeAdapter(() => ACCOUNT, VALID, false)
    await expect(syncChannelEntities('meta', { store: m.store, adapterFor: () => f.adapter })).rejects.toThrow(/cannot read/)
    expect(f.syncEntities).not.toHaveBeenCalled()
  })
})

describe('syncAfterWrite', () => {
  it('upserts only the ids asked for and never marks MISSING', async () => {
    const m = memoryStore()
    const spy = vi.spyOn(m.store, 'markMissing')
    const f = fakeAdapter(() => ACCOUNT)
    const r = await syncAfterWrite('meta', ['a1', 'gone'], { store: m.store, adapterFor: () => f.adapter, now: () => T1 })
    expect([...m.rows.keys()]).toEqual(['meta|a1'])
    expect(r.full).toBe(false)
    expect(r.counts.ad.inserted).toBe(1)
    expect(r.notFound).toEqual(['gone'])
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing for an empty id list', async () => {
    const f = fakeAdapter(() => ACCOUNT)
    const r = await syncAfterWrite('meta', [], { store: memoryStore().store, adapterFor: () => f.adapter })
    expect(f.syncEntities).not.toHaveBeenCalled()
    expect(r.notFound).toEqual([])
  })
})

describe('syncAllChannels', () => {
  it('syncs channels with a valid token and skips the rest', async () => {
    const m = memoryStore()
    const good = fakeAdapter(() => ACCOUNT)
    const badToken = fakeAdapter(() => ACCOUNT, { ...VALID, valid: false, error: 'not_configured' })
    const adapters: Record<string, ChannelAdapter | null> = { meta: good.adapter, microsoft: badToken.adapter, google: null }
    const reports = await syncAllChannels({
      store: m.store, now: () => T1,
      channels: () => ['meta', 'microsoft', 'google'] as ChannelId[],
      adapterFor: id => adapters[id] ?? null,
    })
    expect(reports.map(r => [r.channel, r.outcome])).toEqual([['meta', 'synced'], ['microsoft', 'skipped'], ['google', 'skipped']])
    expect(reports[1]?.reason).toContain('not_configured')
    expect(badToken.syncEntities).not.toHaveBeenCalled()
    expect(reports[0]?.result?.counts.ad.inserted).toBe(2)
  })

  it('reports a failing channel without stopping the others', async () => {
    const m = memoryStore()
    const broken = fakeAdapter(() => { throw new Error('api_error') })
    const good = fakeAdapter(() => ACCOUNT)
    const adapters: Record<string, ChannelAdapter> = { meta: broken.adapter, microsoft: good.adapter }
    const reports = await syncAllChannels({
      store: m.store,
      channels: () => ['meta', 'microsoft'] as ChannelId[],
      adapterFor: id => adapters[id] ?? null,
    })
    expect(reports.map(r => r.outcome)).toEqual(['failed', 'synced'])
    expect(reports[0]?.reason).toBe('api_error')
  })

  it('defaults to the registry: only Meta has a readable adapter today', async () => {
    const m = memoryStore()
    const f = fakeAdapter(() => [])
    const seen: string[] = []
    await syncAllChannels({ store: m.store, adapterFor: id => { seen.push(id); return f.adapter } })
    expect(seen).toEqual(['meta'])
  })
})

describe('buildUpsertQuery', () => {
  it('upserts on (platform, external_id), leaves first_seen_at alone and keeps an existing creative link', () => {
    const offline = drizzle(neon('postgresql://u:p@localhost/never'))
    const row: EntityUpsertRow = { ...entity('ad', 'a1'), creativeId: 9 }
    const q = buildUpsertQuery(offline as never, [row], T1).toSQL()
    expect(q.sql).toContain('on conflict ("platform","external_id") do update set')
    const setClause = q.sql.slice(q.sql.indexOf('do update set'))
    expect(setClause).not.toContain('first_seen_at')
    expect(setClause).toContain('"last_synced_at" = excluded.last_synced_at')
    expect(setClause).toContain('coalesce(excluded.creative_id, "ad_platform_entities"."creative_id")')
    expect(q.sql).toContain('(xmax = 0)')
  })
})
