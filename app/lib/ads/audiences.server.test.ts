import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import { classifyFile } from '~/lib/migration-classify.server'
import type { ChannelAdapter, ChannelId, NormalizedAudience, NormalizedEntity, TokenHealth } from './channels/types'
import {
  auditExclusions, buildAudienceUpsertQuery, deriveRoles, loadAudiencesPage, syncChannelAudiences,
  type AdsetMirrorRow, type AudienceRow, type AudienceStore,
} from './audiences.server'
import { syncAllChannels, type EntityStore } from './sync.server'

const T1 = new Date('2026-10-19T06:35:00Z')
const T2 = new Date('2026-10-19T12:35:00Z')

function memoryAudienceStore(adsets: AdsetMirrorRow[] = []) {
  const rows = new Map<string, AudienceRow>()
  const store: AudienceStore = {
    async adsets(platform) { return adsets.filter(a => a.platform === platform && a.status !== 'MISSING') },
    async upsert(input, now) {
      return input.map(r => {
        const k = `${r.platform}|${r.externalId}`
        const inserted = !rows.has(k)
        rows.set(k, { ...r, syncedAt: now })
        return { externalId: r.externalId, inserted }
      })
    },
    async list(platform) { return [...rows.values()].filter(r => !platform || r.platform === platform) },
  }
  return { store, rows }
}

function audience(externalId: string, name: string, kind: NormalizedAudience['kind'] = 'custom', over: Partial<NormalizedAudience> = {}): NormalizedAudience {
  return { platform: 'meta', externalId, name, kind, approxSize: 1000, approxSizeUpper: 1200, status: 'Normal', raw: { id: externalId, approximate_count_upper_bound: 1200 }, ...over }
}

function adset(externalId: string, name: string, targeting: Record<string, unknown> | null, over: Partial<AdsetMirrorRow> = {}): AdsetMirrorRow {
  return { platform: 'meta', externalId, name, status: 'ACTIVE', effectiveStatus: 'ACTIVE', raw: targeting ? { id: externalId, targeting } : { id: externalId }, ...over }
}

const CUSTOMERS = audience('900', 'Shopify customers')
const SUBSCRIBERS = audience('901', 'Klaviyo Email List subscribers')
const LAL = audience('902', 'LAL 1% buyers', 'lookalike')
const SAVED = audience('903', 'US 25-54', 'saved')

const GUARDED = adset('s1', 'Leads | guarded', {
  custom_audiences: [{ id: '902', name: 'LAL 1% buyers' }],
  excluded_custom_audiences: [{ id: '900', name: 'Shopify customers' }, { id: '901', name: 'Klaviyo Email List subscribers' }],
})
const BARE = adset('s2', 'Leads | bare', { geo_locations: { countries: ['US'] } })

function fakeAdapter(list: () => NormalizedAudience[], audiences: 'none' | 'read' = 'read'): ChannelAdapter {
  return {
    id: 'meta',
    capabilities: { read: true, insights: true, mutate: [], audiences, preview: false },
    auth: { health: vi.fn(async (): Promise<TokenHealth> => ({ valid: true, expiresAt: null, scopes: [], checkedAt: T1.toISOString() })) },
    syncEntities: vi.fn(async () => [] as NormalizedEntity[]),
    pullInsights: vi.fn(),
    createPaused: vi.fn(),
    mutate: vi.fn(),
    audiences: { list: vi.fn(async () => list()) },
    policyCheck: vi.fn(),
  } as unknown as ChannelAdapter
}

describe('syncChannelAudiences', () => {
  it('upserts every audience, maps kinds and derives roles from ad set targeting', async () => {
    const m = memoryAudienceStore([GUARDED, BARE])
    const r = await syncChannelAudiences('meta', { store: m.store, adapterFor: () => fakeAdapter(() => [CUSTOMERS, SUBSCRIBERS, LAL, SAVED]), now: () => T1 })
    expect(r).toMatchObject({ seen: 4, inserted: 4, updated: 0, byRole: { exclusion: 2, targeting: 1, unknown: 1 } })
    const got = (id: string) => m.rows.get(`meta|${id}`)
    expect(got('900')).toMatchObject({ kind: 'custom', role: 'exclusion', approxSize: 1000 })
    expect(got('902')).toMatchObject({ kind: 'lookalike', role: 'targeting' })
    expect(got('903')).toMatchObject({ kind: 'saved', role: 'unknown' })
  })

  it('is idempotent: a second identical run updates in place and inserts nothing', async () => {
    const m = memoryAudienceStore([GUARDED])
    const deps = { store: m.store, adapterFor: () => fakeAdapter(() => [CUSTOMERS, SUBSCRIBERS]) }
    await syncChannelAudiences('meta', { ...deps, now: () => T1 })
    const second = await syncChannelAudiences('meta', { ...deps, now: () => T2 })
    expect(second).toMatchObject({ seen: 2, inserted: 0, updated: 2 })
    expect(m.rows.size).toBe(2)
    expect(m.rows.get('meta|900')?.syncedAt).toEqual(T2)
  })

  it('dedupes an id the platform returned twice', async () => {
    const m = memoryAudienceStore()
    const r = await syncChannelAudiences('meta', { store: m.store, adapterFor: () => fakeAdapter(() => [CUSTOMERS, { ...CUSTOMERS, name: 'Renamed' }]) })
    expect(r.seen).toBe(1)
    expect(m.rows.get('meta|900')?.name).toBe('Renamed')
  })

  it('refuses a channel that cannot list audiences', async () => {
    const m = memoryAudienceStore()
    await expect(syncChannelAudiences('meta', { store: m.store, adapterFor: () => fakeAdapter(() => [], 'none') })).rejects.toThrow('cannot list audiences')
    await expect(syncChannelAudiences('meta', { store: m.store, adapterFor: () => null })).rejects.toThrow('cannot list audiences')
  })
})

describe('deriveRoles', () => {
  it('lets exclusion win when one ad set targets an audience another excludes', () => {
    const a = adset('a', 'a', { custom_audiences: [{ id: '900' }] })
    const b = adset('b', 'b', { excluded_custom_audiences: [{ id: '900' }] })
    expect(deriveRoles([a, b]).get('900')).toBe('exclusion')
    expect(deriveRoles([b, a]).get('900')).toBe('exclusion')
  })
})

describe('auditExclusions', () => {
  it('passes an ad set with two exclusions and names the M8 pair', async () => {
    const m = memoryAudienceStore([GUARDED, BARE])
    await syncChannelAudiences('meta', { store: m.store, adapterFor: () => fakeAdapter(() => [CUSTOMERS, SUBSCRIBERS]) })
    const audit = await auditExclusions({ store: m.store })
    const guarded = audit.find(a => a.externalId === 's1')!
    expect(guarded.ok).toBe(true)
    expect(guarded.excluded.map(x => x.id)).toEqual(['900', '901'])
    expect(guarded.customer).toEqual({ id: '900', name: 'Shopify customers' })
    expect(guarded.subscriber).toEqual({ id: '901', name: 'Klaviyo Email List subscribers' })
  })

  it('fails an ad set with no exclusions, and lists failures first', async () => {
    const m = memoryAudienceStore([GUARDED, BARE])
    const audit = await auditExclusions({ store: m.store })
    expect(audit.map(a => [a.externalId, a.ok])).toEqual([['s2', false], ['s1', true]])
    expect(audit[0]).toMatchObject({ excluded: [], customer: null, subscriber: null })
  })

  it('reports ids when the names do not identify the pair', async () => {
    const m = memoryAudienceStore([adset('s3', 'ids only', { excluded_custom_audiences: [{ id: '700' }, { id: '701' }] })])
    const [a] = await auditExclusions({ store: m.store })
    expect(a).toMatchObject({ ok: true, excluded: [{ id: '700', name: null }, { id: '701', name: null }], customer: null, subscriber: null })
  })

  it('skips deleted, archived and missing ad sets but keeps paused ones', async () => {
    const m = memoryAudienceStore([
      adset('p', 'paused', null, { status: 'PAUSED', effectiveStatus: 'PAUSED' }),
      adset('d', 'deleted', null, { effectiveStatus: 'DELETED' }),
      adset('x', 'archived', null, { effectiveStatus: 'ARCHIVED' }),
      adset('m', 'missing', null, { status: 'MISSING' }),
    ])
    expect((await auditExclusions({ store: m.store })).map(a => a.externalId)).toEqual(['p'])
  })
})

describe('loadAudiencesPage', () => {
  it('returns the empty state', async () => {
    const page = await loadAudiencesPage(memoryAudienceStore().store)
    expect(page).toEqual({ audiences: [], exclusions: [], lastSyncedAt: null })
  })

  it('returns rows with a size range and the exclusions check', async () => {
    const m = memoryAudienceStore([GUARDED])
    await syncChannelAudiences('meta', { store: m.store, adapterFor: () => fakeAdapter(() => [CUSTOMERS, SUBSCRIBERS]), now: () => T1 })
    const page = await loadAudiencesPage(m.store)
    expect(page.audiences[0]).toMatchObject({ externalId: '900', sizeLower: 1000, sizeUpper: 1200, role: 'exclusion', syncedAt: T1.toISOString() })
    expect(page.exclusions).toHaveLength(1)
    expect(page.lastSyncedAt).toBe(T1.toISOString())
  })
})

describe('syncAllChannels runs audiences after entities', () => {
  const entityStore: EntityStore = {
    creativeIdsByExternalAdId: async () => new Map(),
    upsert: async () => [],
    markMissing: async () => [],
  }

  it('reports the audiences pass alongside the entity sync', async () => {
    const m = memoryAudienceStore([GUARDED])
    const adapter = fakeAdapter(() => [CUSTOMERS])
    const [report] = await syncAllChannels({
      store: entityStore, audienceStore: m.store,
      channels: () => ['meta'] as ChannelId[], adapterFor: () => adapter,
    })
    expect(report?.outcome).toBe('synced')
    expect(report?.audiences).toMatchObject({ outcome: 'synced', result: { seen: 1 } })
  })

  it('an audiences failure does not fail the entity sync', async () => {
    const m = memoryAudienceStore()
    const adapter = fakeAdapter(() => { throw new Error('audiences down') })
    const [report] = await syncAllChannels({
      store: entityStore, audienceStore: m.store,
      channels: () => ['meta'] as ChannelId[], adapterFor: () => adapter,
    })
    expect(report?.outcome).toBe('synced')
    expect(report?.audiences).toEqual({ outcome: 'failed', reason: 'audiences down' })
  })
})

describe('buildAudienceUpsertQuery', () => {
  it('upserts on (platform, external_id) and moves synced_at', () => {
    const offline = drizzle(neon('postgresql://u:p@localhost/never'))
    const q = buildAudienceUpsertQuery(offline as never, [{
      platform: 'meta', externalId: '900', name: 'Shopify customers', kind: 'custom', role: 'exclusion', approxSize: 1000, status: null, raw: null,
    }], T1).toSQL()
    expect(q.sql).toContain('on conflict ("platform","external_id") do update set')
    expect(q.sql).toContain('"synced_at" = excluded.synced_at')
    expect(q.sql).toContain('"role" = excluded.role')
  })
})

describe('migration 132', () => {
  it('classifies as additive (auto)', () => {
    const body = readFileSync(join(process.cwd(), 'db/migrations/132_ad_audiences.sql'), 'utf8')
    const c = classifyFile(body)
    expect(c.verdict).toBe('auto')
    expect(c.statements).toHaveLength(2)
  })
})
