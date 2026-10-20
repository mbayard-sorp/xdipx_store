import { describe, expect, it, vi } from 'vitest'

// Never touch the real database from a test: .env DATABASE_URL is production.
vi.mock('~/lib/db.server', () => ({ db: {} }))

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import type { ChannelAdapter, DateRange, NormalizedInsightRow, TokenHealth } from './channels/types'
import {
  API_SOURCE, buildCreativeMetricsUpsertQuery, buildInsightsUpsertQuery, cronRange, daysInRange, planCreativeMetrics,
  pullChannelInsights, runInsightsCron,
  type CreativeMetricRow, type InsightsStore, type RollupOutcome,
} from './insights.server'

/** In-memory twin of the Drizzle store, holding the same keys and rules the SQL does. */
function memoryStore(creativeByAd: Record<string, number> = {}) {
  const insights = new Map<string, NormalizedInsightRow & { pulledAt: Date }>()
  // ad_creative_daily_metrics, with an orders column the pull must never touch.
  const metrics = new Map<string, CreativeMetricRow & { orders: number; source: string }>()
  const accountRows: Array<CreativeMetricRow & { source: string }> = []
  const store: InsightsStore = {
    async upsertInsights(rows, now) {
      for (const r of rows) insights.set(`${r.platform}|${r.level}|${r.externalId}|${r.day}`, { ...r, pulledAt: now })
      return rows.length
    },
    async creativeIdsForAds(_platform, ids) {
      const out = new Map<string, number>()
      for (const id of ids) if (creativeByAd[id] !== undefined) out.set(id, creativeByAd[id])
      return out
    },
    async upsertCreativeMetrics(rows) {
      for (const r of rows) {
        const k = `${r.creativeId}|${r.day}|${r.platform}`
        const prev = metrics.get(k)
        metrics.set(k, { ...r, orders: prev?.orders ?? 0, source: API_SOURCE })
      }
      return rows.length
    },
    async replaceAccountMetrics(platform, days, rows) {
      const drop = new Set(days)
      for (let i = accountRows.length - 1; i >= 0; i--) {
        const r = accountRows[i]!
        if (r.platform === platform && r.source === API_SOURCE && drop.has(r.day)) accountRows.splice(i, 1)
      }
      for (const r of rows) accountRows.push({ ...r, source: API_SOURCE })
      return rows.length
    },
  }
  return { store, insights, metrics, accountRows }
}

function row(externalId: string, day: string, over: Partial<NormalizedInsightRow> = {}): NormalizedInsightRow {
  return {
    platform: 'meta', level: 'ad', externalId, day,
    spendCents: 1000, impressions: 500, reach: 400, frequency: 1.25, clicks: 20, linkClicks: 12,
    leads: 2, platformPurchases: 0, platformPurchaseValueCents: 0, actions: { lead: 2 },
    ...over,
  }
}

const VALID: TokenHealth = { valid: true, expiresAt: null, scopes: ['ads_read'], checkedAt: '2026-10-19T00:00:00Z' }

function fakeAdapter(pull: (range: DateRange) => NormalizedInsightRow[], health: TokenHealth = VALID, insights = true) {
  const pullInsights = vi.fn(async (range: DateRange, _level: string) => pull(range))
  const adapter = {
    id: 'meta',
    capabilities: { read: true, insights, mutate: [], audiences: 'none', preview: false },
    auth: { health: vi.fn(async () => health) },
    syncEntities: vi.fn(),
    pullInsights,
    createPaused: vi.fn(),
    mutate: vi.fn(),
    policyCheck: vi.fn(),
  } as unknown as ChannelAdapter
  return { adapter, pullInsights }
}

const RANGE = { since: '2026-10-18', until: '2026-10-19' }
const T_HOURLY = new Date('2026-10-19T14:05:00Z')
const T_RESTATE = new Date('2026-10-19T09:05:00Z')

describe('pullChannelInsights', () => {
  it('asks the adapter for ad level over the range and upserts idempotently', async () => {
    const m = memoryStore({ a1: 7 })
    const f = fakeAdapter(() => [row('a1', '2026-10-18'), row('a1', '2026-10-19', { spendCents: 250 })])
    const deps = { store: m.store, adapterFor: () => f.adapter, now: () => T_HOURLY }

    const first = await pullChannelInsights('meta', RANGE, deps)
    expect(f.pullInsights).toHaveBeenCalledWith(RANGE, 'ad')
    expect(first.insightRows).toBe(2)

    // The next hour Meta has more spend for today. Same keys, new numbers, no new rows.
    f.pullInsights.mockImplementation(async () => [row('a1', '2026-10-18'), row('a1', '2026-10-19', { spendCents: 900 })])
    await pullChannelInsights('meta', RANGE, deps)
    await pullChannelInsights('meta', RANGE, deps)
    expect(m.insights.size).toBe(2)
    expect(m.insights.get('meta|ad|a1|2026-10-19')!.spendCents).toBe(900)
    expect(m.metrics.size).toBe(2)
    expect(m.metrics.get('7|2026-10-19|meta')!.spendCents).toBe(900)
  })

  it('maps ads to creatives through the mirror and lands leads on the creative row', async () => {
    const m = memoryStore({ a1: 7, a2: 7, a3: 8 })
    const f = fakeAdapter(() => [
      row('a1', '2026-10-18', { spendCents: 1000, leads: 2, clicks: 10, impressions: 100 }),
      // Same creative in a second ad set: summed, never two rows for one (creative, day, platform).
      row('a2', '2026-10-18', { spendCents: 500, leads: 3, clicks: 5, impressions: 50 }),
      row('a3', '2026-10-18', { spendCents: 300, leads: 0 }),
    ])
    const r = await pullChannelInsights('meta', RANGE, { store: m.store, adapterFor: () => f.adapter, now: () => T_HOURLY })
    expect(r.matchedAds).toBe(3)
    expect(r.unmatchedAds).toBe(0)
    expect(m.metrics.get('7|2026-10-18|meta')).toMatchObject({ spendCents: 1500, leads: 5, clicks: 15, impressions: 150, source: 'api' })
    expect(m.metrics.get('8|2026-10-18|meta')).toMatchObject({ spendCents: 300, leads: 0 })
    expect(m.accountRows).toHaveLength(0)
  })

  it('never touches orders, which Shopify attribution owns', async () => {
    const m = memoryStore({ a1: 7 })
    m.metrics.set('7|2026-10-18|meta', { creativeId: 7, day: '2026-10-18', platform: 'meta', spendCents: 0, impressions: 0, clicks: 0, leads: 0, orders: 3, source: 'api' })
    const f = fakeAdapter(() => [row('a1', '2026-10-18')])
    await pullChannelInsights('meta', RANGE, { store: m.store, adapterFor: () => f.adapter })
    expect(m.metrics.get('7|2026-10-18|meta')!.orders).toBe(3)

    const sql = buildCreativeMetricsUpsertQuery(drizzle(neon('postgresql://u:p@localhost/never')) as never, [
      { creativeId: 7, day: '2026-10-18', platform: 'meta', spendCents: 1, impressions: 1, clicks: 1, leads: 1 },
    ]).toSQL().sql
    const setClause = sql.slice(sql.indexOf('do update set'))
    expect(sql).toContain('on conflict ("creative_id","day","platform") do update set')
    expect(setClause).toContain('"leads" = excluded.leads')
    expect(setClause).not.toContain('orders')
    expect(setClause).not.toContain('net_revenue_cents')
  })

  it('puts spend from unmatched ads on one account row per day, and replaces it on the next pull', async () => {
    const m = memoryStore({ a1: 7 })
    const f = fakeAdapter(() => [
      row('a1', '2026-10-18', { spendCents: 1000 }),
      row('x1', '2026-10-18', { spendCents: 200, leads: 1 }),
      row('x2', '2026-10-18', { spendCents: 300, leads: 0 }),
      row('x1', '2026-10-19', { spendCents: 50 }),
    ])
    const deps = { store: m.store, adapterFor: () => f.adapter }
    const r = await pullChannelInsights('meta', RANGE, deps)
    expect(r.unmatchedAds).toBe(2)
    expect(m.accountRows.map(a => [a.day, a.spendCents, a.leads])).toEqual([['2026-10-18', 500, 1], ['2026-10-19', 50, 2]])

    // Meta restates: the unmatched spend on the 18th drops, and the 19th is gone.
    f.pullInsights.mockImplementation(async () => [row('a1', '2026-10-18'), row('x1', '2026-10-18', { spendCents: 150 })])
    await pullChannelInsights('meta', RANGE, deps)
    expect(m.accountRows.map(a => [a.day, a.spendCents])).toEqual([['2026-10-18', 150]])
  })

  it('reports spend per day so yesterday can be checked against Ads Manager to the cent', async () => {
    const m = memoryStore({ a1: 7 })
    const f = fakeAdapter(() => [
      row('a1', '2026-10-18', { spendCents: 1234 }),
      row('x1', '2026-10-18', { spendCents: 1 }),
      row('a1', '2026-10-19', { spendCents: 99 }),
    ])
    const r = await pullChannelInsights('meta', RANGE, { store: m.store, adapterFor: () => f.adapter })
    expect(r.spendCentsByDay).toEqual({ '2026-10-18': 1235, '2026-10-19': 99 })
    // Creative rows plus the account row add back to the platform's own total.
    const stored = [...m.metrics.values(), ...m.accountRows].filter(x => x.day === '2026-10-18').reduce((s, x) => s + x.spendCents, 0)
    expect(stored).toBe(1235)
  })

  it('drops rows outside the range and keeps the last copy of a duplicate', async () => {
    const m = memoryStore({ a1: 7 })
    const f = fakeAdapter(() => [
      row('a1', '2026-10-10', { spendCents: 999 }),
      row('a1', '2026-10-18', { spendCents: 100 }),
      row('a1', '2026-10-18', { spendCents: 200 }),
    ])
    const r = await pullChannelInsights('meta', RANGE, { store: m.store, adapterFor: () => f.adapter })
    expect(r.insightRows).toBe(1)
    expect(m.metrics.get('7|2026-10-18|meta')!.spendCents).toBe(200)
    expect(m.metrics.has('7|2026-10-10|meta')).toBe(false)
  })

  it('refuses a channel without insights and writes nothing when the pull throws', async () => {
    const m = memoryStore()
    const none = fakeAdapter(() => [], VALID, false)
    await expect(pullChannelInsights('meta', RANGE, { store: m.store, adapterFor: () => none.adapter })).rejects.toThrow(/cannot report insights/)
    const boom = fakeAdapter(() => { throw new Error('graph 500') })
    await expect(pullChannelInsights('meta', RANGE, { store: m.store, adapterFor: () => boom.adapter })).rejects.toThrow('graph 500')
    expect(m.insights.size).toBe(0)
    expect(m.accountRows).toHaveLength(0)
  })
})

describe('planCreativeMetrics', () => {
  it('ignores non-ad rows and writes no account row for a day with nothing on it', () => {
    const p = planCreativeMetrics('meta', [
      row('c1', '2026-10-18', { level: 'campaign' }),
      row('x1', '2026-10-18', { spendCents: 0, impressions: 0, clicks: 0, leads: 0 }),
    ], new Map())
    expect(p.creativeRows).toEqual([])
    expect(p.accountRows).toEqual([])
    expect(p.unmatchedAds).toBe(1)
  })
})

describe('cron range', () => {
  it('is yesterday and today on an hourly run and the last 7 days plus today on the restatement run', () => {
    expect(cronRange(T_HOURLY, false)).toEqual({ since: '2026-10-18', until: '2026-10-19' })
    expect(cronRange(T_RESTATE, true)).toEqual({ since: '2026-10-12', until: '2026-10-19' })
    expect(daysInRange({ since: '2026-10-30', until: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
})

describe('runInsightsCron', () => {
  function cronDeps(now: Date, adapter: ChannelAdapter, m = memoryStore({ a1: 7 })) {
    const rollup = vi.fn(async (day: string): Promise<RollupOutcome> => ({ day, spendCents: 0, written: true }))
    const runRules = vi.fn(async () => ({ evaluated: 1 }))
    const health = vi.fn(async (_at: Date): Promise<unknown> => ({ stub: true }))
    return { deps: { store: m.store, adapterFor: () => adapter, channels: () => ['meta' as const], now: () => now, rollup, runRules, health }, rollup, runRules, health, m }
  }

  it('hourly: pulls today and yesterday, rolls both up, and leaves the rules alone', async () => {
    const f = fakeAdapter(() => [row('a1', '2026-10-19')])
    const { deps, rollup, runRules } = cronDeps(T_HOURLY, f.adapter)
    const r = await runInsightsCron(deps)
    expect(r.restatement).toBe(false)
    expect(f.pullInsights).toHaveBeenCalledWith({ since: '2026-10-18', until: '2026-10-19' }, 'ad')
    expect(rollup.mock.calls.map(c => c[0])).toEqual(['2026-10-18', '2026-10-19'])
    expect(runRules).not.toHaveBeenCalled()
    expect(r.rules).toBeUndefined()
    expect(r.channels[0]!.outcome).toBe('pulled')
  })

  it('09:00 UTC: re-pulls the last 7 days, rolls every one up, then runs the rules after the rollup', async () => {
    const f = fakeAdapter(() => [row('a1', '2026-10-13')])
    const { deps, rollup, runRules } = cronDeps(T_RESTATE, f.adapter)
    const order: string[] = []
    rollup.mockImplementation(async (day: string) => { order.push(`rollup:${day}`); return { day, spendCents: 0, written: true } })
    runRules.mockImplementation(async () => { order.push('rules'); return { evaluated: 1 } })
    const r = await runInsightsCron(deps)
    expect(r.restatement).toBe(true)
    expect(f.pullInsights).toHaveBeenCalledWith({ since: '2026-10-12', until: '2026-10-19' }, 'ad')
    expect(rollup).toHaveBeenCalledTimes(8)
    expect(runRules).toHaveBeenCalledWith(T_RESTATE)
    expect(order[order.length - 1]).toBe('rules')
    expect(r.rules).toEqual({ ok: true, summary: { evaluated: 1 } })
  })

  it('restate forces the restatement branch off the hour', async () => {
    const f = fakeAdapter(() => [])
    const { deps, runRules } = cronDeps(T_HOURLY, f.adapter)
    const r = await runInsightsCron({ ...deps, restate: true })
    expect(r.restatement).toBe(true)
    expect(runRules).toHaveBeenCalled()
  })

  it('reports a rules failure without hiding the pull', async () => {
    const f = fakeAdapter(() => [row('a1', '2026-10-19')])
    const { deps, runRules } = cronDeps(T_RESTATE, f.adapter)
    runRules.mockRejectedValue(new Error('rules broke'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runInsightsCron(deps)
    err.mockRestore()
    expect(r.rules).toEqual({ ok: false, error: 'rules broke' })
    expect(r.channels[0]!.outcome).toBe('pulled')
  })

  it('skips a channel with an invalid token and rolls nothing up', async () => {
    const f = fakeAdapter(() => [row('a1', '2026-10-19')], { ...VALID, valid: false, error: 'expired' })
    const { deps, rollup } = cronDeps(T_HOURLY, f.adapter)
    const r = await runInsightsCron(deps)
    expect(r.channels[0]).toMatchObject({ outcome: 'skipped', reason: 'token not valid: expired' })
    expect(f.pullInsights).not.toHaveBeenCalled()
    expect(rollup).not.toHaveBeenCalled()
  })

  it('records a failed pull as failed', async () => {
    const f = fakeAdapter(() => { throw new Error('rate limited') })
    const { deps } = cronDeps(T_HOURLY, f.adapter)
    const r = await runInsightsCron(deps)
    expect(r.channels[0]).toMatchObject({ outcome: 'failed', reason: 'rate limited' })
  })

  it('runs the health step on every run, even with no channel pulled', async () => {
    const f = fakeAdapter(() => [row('a1', '2026-10-19')], { ...VALID, valid: false, error: 'expired' })
    const { deps, health } = cronDeps(T_HOURLY, f.adapter)
    const r = await runInsightsCron(deps)
    expect(health).toHaveBeenCalledWith(T_HOURLY)
    expect(r.health).toEqual({ ok: true, summary: { stub: true } })
  })

  it('reports a health step failure without failing the pull', async () => {
    const f = fakeAdapter(() => [row('a1', '2026-10-19')])
    const { deps, health } = cronDeps(T_HOURLY, f.adapter)
    health.mockRejectedValue(new Error('samples table missing'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runInsightsCron(deps)
    err.mockRestore()
    expect(r.health).toEqual({ ok: false, error: 'samples table missing' })
    expect(r.channels[0]!.outcome).toBe('pulled')
  })

  it('by default runs only channels whose adapter reports insights', async () => {
    const f = fakeAdapter(() => [])
    const { deps } = cronDeps(T_HOURLY, f.adapter)
    const { channels: _drop, ...rest } = deps
    const r = await runInsightsCron(rest)
    // Meta is the only channel in the registry with an adapter today.
    expect(r.channels.map(c => c.channel)).toEqual(['meta'])
  })
})

describe('buildInsightsUpsertQuery', () => {
  it('upserts on (platform, level, external_id, day) and refreshes pulled_at', () => {
    const offline = drizzle(neon('postgresql://u:p@localhost/never'))
    const q = buildInsightsUpsertQuery(offline as never, [row('a1', '2026-10-18')], T_HOURLY).toSQL()
    expect(q.sql).toContain('on conflict ("platform","level","external_id","day") do update set')
    const setClause = q.sql.slice(q.sql.indexOf('do update set'))
    expect(setClause).toContain('"spend_cents" = excluded.spend_cents')
    expect(setClause).toContain('"leads" = excluded.leads')
    expect(setClause).toContain('"pulled_at" = excluded.pulled_at')
  })
})
