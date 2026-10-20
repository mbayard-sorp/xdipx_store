import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { BlockerInput } from '~/lib/owner-blockers-core'
import { classifyFile } from '~/lib/migration-classify.server'
import {
  FUNNEL_BREAK_KEY,
  GROWTH_ACTIVE_KEY,
  GROWTH_CAMPAIGN_EXTERNAL_ID,
  HEALTH_KEYS,
  LEAD_POST_EVENT_KEY,
  evaluateFunnelBreak,
  landingDelta,
  probeAdHealth,
  recordLeadPostEvent,
  runAdHealth,
  type CampaignStatus,
  type HealthSample,
  type HealthStore,
  type HelloResult,
  type RuleEventInput,
} from './health.server'

const HOUR = 3_600_000
const T0 = new Date('2026-10-19T12:05:00Z')
const hoursAgo = (h: number, from = T0) => new Date(from.getTime() - h * HOUR).toISOString()

/**
 * An in-memory stand-in for the Drizzle store. It keeps samples, landing-view
 * sums, the mirror row and ad_rule_events the way the real tables would, so a
 * run of several hours can be replayed without Neon or Meta.
 */
function memoryStore(opts: { samples?: HealthSample[]; landingToday?: number; growth?: CampaignStatus | null } = {}) {
  const samples: HealthSample[] = [...(opts.samples ?? [])]
  const ruleEvents: Array<RuleEventInput & { id: number }> = []
  const state = { landingToday: opts.landingToday ?? 0, growth: opts.growth ?? null }
  const t = (s: HealthSample) => new Date(s.sampledAt).getTime()
  const store: HealthStore = {
    async insertSamples(rows) { samples.push(...rows) },
    async countEvents(key, since) { return samples.filter(s => s.key === key && t(s) >= since.getTime()).length },
    async latestSample(key) {
      return samples.filter(s => s.key === key).sort((a, b) => t(b) - t(a))[0] ?? null
    },
    async recentSamples(keys, since) { return samples.filter(s => keys.includes(s.key) && t(s) >= since.getTime()) },
    async actionSumForDay() { return state.landingToday },
    async campaignStatus() { return state.growth },
    async lastRuleEventAt(ruleId) {
      const hits = ruleEvents.filter(r => r.ruleId === ruleId).sort((a, b) => b.firedAt.getTime() - a.firedAt.getTime())
      return hits[0]?.firedAt ?? null
    },
    async insertRuleEvent(row) {
      const id = ruleEvents.length + 1
      ruleEvents.push({ ...row, id })
      return id
    },
  }
  return { store, samples, ruleEvents, state }
}

/** fileBlocker's dedupe-by-key behaviour, plus clear-by-key. */
function blockerBook() {
  const open = new Map<string, { id: number; input: BlockerInput; files: number }>()
  const cleared: string[] = []
  let next = 1
  const fileBlocker = vi.fn(async (input: BlockerInput) => {
    const hit = open.get(input.dedupeKey)
    if (hit) { hit.files++; hit.input = input; return { id: hit.id, created: false, reopened: false } }
    const id = next++
    open.set(input.dedupeKey, { id, input, files: 1 })
    return { id, created: true, reopened: false }
  })
  const clearBlocker = vi.fn(async (key: string) => {
    if (!open.has(key)) return false
    open.delete(key)
    cleared.push(key)
    return true
  })
  return { open, cleared, fileBlocker, clearBlocker }
}

const helloUp = async (): Promise<HelloResult> => ({ ok: true, status: 200, ms: 120 })
const helloDown = async (): Promise<HelloResult> => ({ ok: false, status: 503, ms: 80 })

/** Prior hourly samples: an hour each of the given landing views, no lead posts, /hello up. */
function priorHours(views: number[], end = T0): HealthSample[] {
  return views.flatMap((v, i) => {
    const sampledAt = hoursAgo(views.length - i, end)
    return [
      { sampledAt, key: HEALTH_KEYS.landingViews1h, value: v },
      { sampledAt, key: HEALTH_KEYS.leadPosts1h, value: 0 },
      { sampledAt, key: HEALTH_KEYS.helloOk, value: 1 },
    ]
  })
}

describe('evaluateFunnelBreak (L3, pure)', () => {
  it('fires on 30 landing views in 6h with no lead posts', () => {
    const ev = evaluateFunnelBreak(priorHours([5, 5, 5, 5, 5, 5]), new Date(T0.getTime() - 1))
    expect(ev.fires).toBe(true)
    expect(ev.reasons).toEqual(['no_leads'])
    expect(ev.landingViews6h).toBe(30)
    expect(ev.sentence).toMatch(/30 landing views in the last 6 hours/)
  })

  it('holds at 29 views, and with one lead post', () => {
    expect(evaluateFunnelBreak(priorHours([5, 5, 5, 5, 5, 4])).fires).toBe(false)
    const withLead = priorHours([10, 10, 10])
    withLead.push({ sampledAt: hoursAgo(1), key: HEALTH_KEYS.leadPosts1h, value: 1 })
    expect(evaluateFunnelBreak(withLead).fires).toBe(false)
  })

  it('only sums inside the rolling 6h', () => {
    // 40 views seven hours ago fall outside the window.
    const s = [...priorHours([40], new Date(T0.getTime() - 6 * HOUR)), ...priorHours([1, 1])]
    expect(evaluateFunnelBreak(s, T0).landingViews6h).toBe(2)
  })

  it('reads a window with no lead counter as unknown, not as zero leads', () => {
    const s: HealthSample[] = [{ sampledAt: hoursAgo(1), key: HEALTH_KEYS.landingViews1h, value: 50 }]
    expect(evaluateFunnelBreak(s, T0).fires).toBe(false)
  })

  it('fires on hello_ok 0 on the two latest samples, and not on one', () => {
    const one = [
      { sampledAt: hoursAgo(2), key: HEALTH_KEYS.helloOk, value: 1 },
      { sampledAt: hoursAgo(1), key: HEALTH_KEYS.helloOk, value: 0 },
    ]
    expect(evaluateFunnelBreak(one, T0).fires).toBe(false)
    const two = [...one, { sampledAt: T0.toISOString(), key: HEALTH_KEYS.helloOk, value: 0 }]
    const ev = evaluateFunnelBreak(two, T0)
    expect(ev.fires).toBe(true)
    expect(ev.reasons).toEqual(['hello_down'])
    expect(ev.helloLatest).toEqual([0, 0])
  })
})

describe('landingDelta', () => {
  it('records the first sample ever as a 0 baseline, a new day as the whole day, and floors restatements at 0', () => {
    expect(landingDelta('2026-10-19', 80, null)).toEqual({ value: 0, baseline: true })
    expect(landingDelta('2026-10-19', 12, { value: 300, day: '2026-10-18' })).toEqual({ value: 12, baseline: false })
    expect(landingDelta('2026-10-19', 50, { value: 42, day: '2026-10-19' })).toEqual({ value: 8, baseline: false })
    expect(landingDelta('2026-10-19', 40, { value: 42, day: '2026-10-19' })).toEqual({ value: 0, baseline: false })
  })
})

describe('runAdHealth', () => {
  it('writes one sample per key, counting lead_post_event rows from the last hour', async () => {
    const m = memoryStore({
      samples: [
        { sampledAt: hoursAgo(0.5), key: LEAD_POST_EVENT_KEY, value: 1 },
        { sampledAt: hoursAgo(0.2), key: LEAD_POST_EVENT_KEY, value: 1 },
        { sampledAt: hoursAgo(3), key: LEAD_POST_EVENT_KEY, value: 1 },
        { sampledAt: hoursAgo(1), key: HEALTH_KEYS.landingViewsToday, value: 10, detail: { day: '2026-10-19' } },
      ],
      landingToday: 17,
    })
    const b = blockerBook()
    const r = await runAdHealth({ store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker, now: () => T0 })
    const byKey = Object.fromEntries(r.samples.map(s => [s.key, s]))
    expect(Object.keys(byKey).sort()).toEqual(Object.values(HEALTH_KEYS).sort())
    expect(byKey[HEALTH_KEYS.helloOk]!.value).toBe(1)
    expect(byKey[HEALTH_KEYS.leadPosts1h]!.value).toBe(2)
    expect(byKey[HEALTH_KEYS.landingViews1h]!.value).toBe(7)
    expect(byKey[HEALTH_KEYS.leadEvents6h]).toMatchObject({ value: 0, detail: { ledger: false } })
    expect(byKey[HEALTH_KEYS.growthCampaignActive]).toMatchObject({ value: 0, detail: { found: false } })
  })

  it('L3 fires once and not twice inside 6h, and files one blocker that clears on the next clean run', async () => {
    // Five quiet hours of traffic with no signups, then this run adds 6 more views.
    const m = memoryStore({
      samples: [
        ...priorHours([5, 5, 5, 5, 5]),
        { sampledAt: hoursAgo(1), key: HEALTH_KEYS.landingViewsToday, value: 25, detail: { day: '2026-10-19' } },
      ],
      landingToday: 31,
    })
    const b = blockerBook()
    const deps = { store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker }

    const first = await runAdHealth({ ...deps, now: () => T0 })
    expect(first.l3.fires).toBe(true)
    expect(first.l3.landingViews6h).toBe(31)
    expect(first.ruleEvent).toMatchObject({ written: true, id: 1 })
    expect(m.ruleEvents).toHaveLength(1)
    expect(m.ruleEvents[0]).toMatchObject({ ruleId: 'L3', action: 'pause', detail: { recommendation: true } })
    expect(b.open.get(FUNNEL_BREAK_KEY)?.input).toMatchObject({ verifyProbe: 'ad_health_clean', verifyArg: 'funnel', priority: 1 })

    // An hour later, still broken: no second rule row, the same blocker refreshed.
    m.state.landingToday = 40
    const second = await runAdHealth({ ...deps, now: () => new Date(T0.getTime() + HOUR) })
    expect(second.l3.fires).toBe(true)
    expect(second.ruleEvent.written).toBe(false)
    expect(second.ruleEvent.skipped).toMatch(/already fired/)
    expect(m.ruleEvents).toHaveLength(1)
    expect(b.open.size).toBe(1)
    expect(b.open.get(FUNNEL_BREAK_KEY)!.files).toBe(2)

    // A signup lands and traffic stops: clean, so the blocker clears itself.
    m.samples.push({ sampledAt: new Date(T0.getTime() + 1.5 * HOUR).toISOString(), key: LEAD_POST_EVENT_KEY, value: 1 })
    const third = await runAdHealth({ ...deps, now: () => new Date(T0.getTime() + 2 * HOUR) })
    expect(third.l3.fires).toBe(false)
    expect(third.funnelBlocker.action).toBe('cleared')
    expect(b.open.has(FUNNEL_BREAK_KEY)).toBe(false)
    expect(m.ruleEvents).toHaveLength(1)
  })

  it('fires again once the 6h cooldown has passed', async () => {
    const m = memoryStore({ samples: priorHours([10, 10, 10]), landingToday: 0 })
    m.ruleEvents.push({ id: 1, ruleId: 'L3', firedAt: new Date(T0.getTime() - 7 * HOUR), action: 'pause', detail: {} })
    const b = blockerBook()
    const r = await runAdHealth({ store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker, now: () => T0 })
    expect(r.ruleEvent).toMatchObject({ written: true, id: 2 })
  })

  it('hello_ok zero twice running fires L3', async () => {
    const m = memoryStore({ samples: [{ sampledAt: hoursAgo(1), key: HEALTH_KEYS.helloOk, value: 0, detail: { status: 503 } }] })
    const b = blockerBook()
    const r = await runAdHealth({ store: m.store, fetchHello: helloDown, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker, now: () => T0 })
    expect(r.l3.reasons).toEqual(['hello_down'])
    expect(r.ruleEvent.written).toBe(true)
    expect(b.fileBlocker).toHaveBeenCalledTimes(1)
    expect(b.fileBlocker.mock.calls[0]![0].dedupeKey).toBe(FUNNEL_BREAK_KEY)
    const hello = r.samples.find(s => s.key === HEALTH_KEYS.helloOk)!
    expect(hello).toMatchObject({ value: 0, detail: { status: 503 } })
  })

  it('a clean window files nothing and writes no rule row', async () => {
    const m = memoryStore({ samples: priorHours([2, 3, 1]), landingToday: 4 })
    const b = blockerBook()
    const r = await runAdHealth({ store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker, now: () => T0 })
    expect(r.l3.fires).toBe(false)
    expect(r.ruleEvent.written).toBe(false)
    expect(m.ruleEvents).toHaveLength(0)
    expect(b.fileBlocker).not.toHaveBeenCalled()
    expect(r.funnelBlocker.action).toBe('none')
    expect(r.growthBlocker.action).toBe('none')
  })

  it('the Growth campaign reading ACTIVE files one blocker, refreshed not stacked, and cleared once it reads PAUSED', async () => {
    const m = memoryStore({ growth: { effectiveStatus: 'ACTIVE', lastSyncedAt: '2026-10-19T11:30:00.000Z' } })
    const b = blockerBook()
    const deps = { store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker }

    const r = await runAdHealth({ ...deps, now: () => T0 })
    expect(r.samples.find(s => s.key === HEALTH_KEYS.growthCampaignActive)).toMatchObject({
      value: 1, detail: { externalId: GROWTH_CAMPAIGN_EXTERNAL_ID, found: true, effectiveStatus: 'ACTIVE' },
    })
    expect(r.growthBlocker.action).toBe('filed')
    expect(b.fileBlocker).toHaveBeenCalledTimes(1)
    expect(b.open.get(GROWTH_ACTIVE_KEY)?.input).toMatchObject({ verifyProbe: 'ad_health_clean', verifyArg: 'growth' })
    expect(r.l3.fires).toBe(false)

    await runAdHealth({ ...deps, now: () => new Date(T0.getTime() + HOUR) })
    expect(b.open.size).toBe(1)

    m.state.growth = { effectiveStatus: 'PAUSED', lastSyncedAt: '2026-10-19T13:30:00.000Z' }
    const later = await runAdHealth({ ...deps, now: () => new Date(T0.getTime() + 2 * HOUR) })
    expect(later.growthBlocker.action).toBe('cleared')
    expect(b.open.size).toBe(0)
  })

  it('a missing mirror row never clears the Growth blocker', async () => {
    const m = memoryStore({ growth: null })
    const b = blockerBook()
    await runAdHealth({ store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker, now: () => T0 })
    expect(b.clearBlocker).not.toHaveBeenCalledWith(GROWTH_ACTIVE_KEY, expect.anything())
  })

  it('a blocker filing failure is reported, not thrown', async () => {
    const m = memoryStore({ growth: { effectiveStatus: 'ACTIVE', lastSyncedAt: null } })
    const b = blockerBook()
    b.fileBlocker.mockRejectedValueOnce(new Error('neon down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runAdHealth({ store: m.store, fetchHello: helloUp, fileBlocker: b.fileBlocker, clearBlocker: b.clearBlocker, now: () => T0 })
    err.mockRestore()
    expect(r.growthBlocker).toMatchObject({ action: 'none', error: expect.stringContaining('neon down') })
  })
})

describe('probeAdHealth (ad_health_clean)', () => {
  it('funnel: false while L3 fires, true when clean, null on stale samples', async () => {
    const firing = memoryStore({ samples: priorHours([10, 10, 10]) })
    expect(await probeAdHealth('funnel', { store: firing.store, now: () => T0 })).toBe(false)
    const clean = memoryStore({ samples: priorHours([1, 1, 1]) })
    expect(await probeAdHealth('funnel', { store: clean.store, now: () => T0 })).toBe(true)
    expect(await probeAdHealth('funnel', { store: clean.store, now: () => new Date(T0.getTime() + 5 * HOUR) })).toBeNull()
  })

  it('growth: reads the latest sample, null when the mirror had no row', async () => {
    const m = memoryStore({
      samples: [{ sampledAt: hoursAgo(1), key: HEALTH_KEYS.growthCampaignActive, value: 1, detail: { found: true } }],
    })
    expect(await probeAdHealth('growth', { store: m.store, now: () => T0 })).toBe(false)
    m.samples.push({ sampledAt: T0.toISOString(), key: HEALTH_KEYS.growthCampaignActive, value: 0, detail: { found: false } })
    expect(await probeAdHealth('growth', { store: m.store, now: () => T0 })).toBeNull()
    expect(await probeAdHealth('nonsense', { store: m.store, now: () => T0 })).toBeNull()
  })
})

describe('recordLeadPostEvent', () => {
  it('writes one lead_post_event row and swallows a store failure', async () => {
    const m = memoryStore()
    await recordLeadPostEvent({ slug: 'hello' }, { store: m.store, now: () => T0 })
    expect(m.samples).toEqual([{ sampledAt: T0.toISOString(), key: LEAD_POST_EVENT_KEY, value: 1, detail: { slug: 'hello' } }])

    const broken = { ...m.store, insertSamples: async () => { throw new Error('no table') } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordLeadPostEvent({ slug: 'hello' }, { store: broken, now: () => T0 })).resolves.toBeUndefined()
    err.mockRestore()
  })
})

describe('migration 134', () => {
  it('classifies as additive (auto)', () => {
    const body = readFileSync(join(__dirname, '../../../db/migrations/134_ad_health_samples.sql'), 'utf8')
    expect(classifyFile(body).verdict).toBe('auto')
  })
})
