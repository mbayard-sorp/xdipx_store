import { describe, expect, it, vi } from 'vitest'
import { ChannelNotEnabledError, MutationRefusedError } from '../errors'
import type { MutationRequest } from '../types'
import { ExoClickError, type ExoClient } from './client.server'
import { createExoclickMutate } from './mutate.server'
import type { ExoOperatorSettings } from './operator-core'

type Row = Record<string, unknown>

/** Cents, as the live API reports them. status 1 active, 0 paused. */
const campaignRow = (id: number, over: Row = {}): Row => ({
  id, name: `c${id}`, status: 1, daily_limit_type: 1, max_daily_budget: 2000, max_daily_budget_reset: 2000,
  total_budget_limit: 3000, total_budget_spent: 1000, price: 75, media_storage_template: 'img_banner', ...over,
})

function fakeClient(campaigns: Row[]) {
  const writes: Array<{ method: string; path: string; body: unknown; opts: unknown }> = []
  const gets: string[] = []
  const client = {
    session: vi.fn(),
    reset: vi.fn(),
    get: vi.fn(async (path: string) => {
      gets.push(path)
      const one = /^campaigns\/(\d+)$/.exec(path)
      if (one) {
        const c = campaigns.find(x => String(x['id']) === one[1])
        if (!c) throw new ExoClickError('api_error', 'not found', { status: 404 })
        return { result: { campaign: c } }
      }
      if (path === 'campaigns') return { result: Object.fromEntries(campaigns.map(c => [String(c['id']), c])) }
      return { result: [] }
    }),
    post: vi.fn(async (path: string, body?: unknown, opts?: unknown) => { writes.push({ method: 'POST', path, body, opts }); return path === 'campaigns' ? { result: { id: 777 } } : {} }),
    put: vi.fn(async (path: string, body?: unknown, opts?: unknown) => { writes.push({ method: 'PUT', path, body, opts }); return {} }),
    del: vi.fn(async (path: string, body?: unknown, opts?: unknown) => { writes.push({ method: 'DELETE', path, body, opts }); return {} }),
  } as unknown as ExoClient
  return { client, writes, gets }
}

const target = (id: string, level: 'campaign' | 'ad' = 'campaign') => ({ platform: 'adult:exoclick' as const, level, externalId: id })
const req = (verb: MutationRequest['verb'], id: string, params: unknown = {}): MutationRequest => ({ verb, target: target(id), params })

function build(campaigns: Row[], s: ExoOperatorSettings) {
  const f = fakeClient(campaigns)
  const sync = vi.fn(async () => ({}))
  const m = createExoclickMutate({ client: f.client, settings: async () => s, syncAfterWrite: sync })
  return { ...f, m, sync }
}

const OFF: ExoOperatorSettings = { operatorEnabled: false, totalCapCents: 50000 }
const ON_NO_CAP: ExoOperatorSettings = { operatorEnabled: true, totalCapCents: 0 }
const ON: ExoOperatorSettings = { operatorEnabled: true, totalCapCents: 13500 }

describe('operator switch off', () => {
  it('every verb throws ChannelNotEnabledError with no network read or write', async () => {
    const { m, client, writes } = build([campaignRow(1)], OFF)
    for (const verb of ['pause', 'resume', 'set_budget', 'block_placement', 'update_creative'] as const) {
      await expect(m.mutate(req(verb, '1', { dailyBudgetCents: 2000, hostnames: ['a.com'], body: {} }))).rejects.toBeInstanceOf(ChannelNotEnabledError)
    }
    await expect(m.createPaused({ body: {}, dailyBudgetCents: 2000 })).rejects.toBeInstanceOf(ChannelNotEnabledError)
    expect(writes).toEqual([])
    expect(client.get).not.toHaveBeenCalled()
  })
})

describe('brakes', () => {
  it('pause sends PUT /campaigns/pause and syncs, with no cap needed', async () => {
    const { m, writes, sync } = build([campaignRow(1)], ON_NO_CAP)
    const r = await m.mutate(req('pause', '1'))
    expect(writes).toEqual([{ method: 'PUT', path: 'campaigns/pause', body: { campaign_ids: [1] }, opts: undefined }])
    expect(r).toMatchObject({ applied: true, touchedIds: ['1'], before: { status: 'ACTIVE' }, after: { status: 'PAUSED' }, synced: true })
    expect(sync).toHaveBeenCalledWith('adult:exoclick', ['1'])
  })

  it('block_placement POSTs the hostnames to the block list, additive only', async () => {
    const { m, writes } = build([campaignRow(1)], ON_NO_CAP)
    const r = await m.mutate(req('block_placement', '1', { hostnames: ['Rat.XXX', 'rat.xxx', 'hog.tv'] }))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ method: 'POST', path: 'campaigns/1/blocked/sites', body: ['rat.xxx', 'hog.tv'] })
    expect(r.applied).toBe(true)
  })

  it('block_placement reports entries it dropped and refuses an empty or oversized list', async () => {
    const { m, writes } = build([campaignRow(1)], ON_NO_CAP)
    const r = await m.mutate(req('block_placement', '1', { hostnames: ['a.com', 'http://evil.example/x', 'not a host'] }))
    expect(writes[0]!.body).toEqual(['a.com'])
    expect(r.warning).toMatch(/2 of 3 entries/)
    await expect(m.mutate(req('block_placement', '1', { hostnames: ['nope'] }))).rejects.toMatchObject({ code: 'bad_params' })
    const many = Array.from({ length: 101 }, (_, i) => `site${i}.com`)
    await expect(m.mutate(req('block_placement', '1', { hostnames: many }))).rejects.toMatchObject({ code: 'bad_params' })
    expect(writes).toHaveLength(1)
  })

  it('never uses PUT or DELETE on a block list', async () => {
    const { m, writes } = build([campaignRow(1)], ON)
    await m.mutate(req('block_placement', '1', { hostnames: ['a.com'] }))
    expect(writes.every(w => w.method === 'POST')).toBe(true)
  })

  it('a lowered daily budget is a brake: PUT with cents, no cap needed', async () => {
    const { m, writes } = build([campaignRow(1, { max_daily_budget_reset: 5000 })], ON_NO_CAP)
    const r = await m.mutate(req('set_budget', '1', { dailyBudgetCents: 2000 }))
    expect(writes[0]).toMatchObject({ method: 'PUT', path: 'campaigns/1', body: { daily_limit_type: 1, max_daily_budget: 2000 } })
    expect(r).toMatchObject({ before: { dailyBudgetCents: 5000 }, after: { dailyBudgetCents: 2000 } })
  })

  it('refuses a budget under the $20 floor, a non-integer, and a lifetime budget', async () => {
    const { m, writes } = build([campaignRow(1, { max_daily_budget_reset: 5000 })], ON)
    await expect(m.mutate(req('set_budget', '1', { dailyBudgetCents: 1999 }))).rejects.toMatchObject({ code: 'bad_params' })
    await expect(m.mutate(req('set_budget', '1', { dailyBudgetCents: 20.5 }))).rejects.toMatchObject({ code: 'bad_params' })
    await expect(m.mutate(req('set_budget', '1', { lifetimeBudgetCents: 5000 }))).rejects.toMatchObject({ code: 'bad_params' })
    expect(writes).toEqual([])
  })

  it('dryRun builds the request and sends nothing', async () => {
    const { m, writes, sync } = build([campaignRow(1)], ON)
    const r = await m.mutate(req('pause', '1'), { dryRun: true })
    expect(r).toMatchObject({ applied: false, dryRun: true, touchedIds: [] })
    expect(r.requests).toEqual([{ method: 'PUT', path: 'campaigns/pause', body: { campaign_ids: [1] } }])
    expect(writes).toEqual([])
    expect(sync).not.toHaveBeenCalled()
  })

  it('refuses a variation pause and an unknown campaign, and halt_all is not enabled', async () => {
    const { m, writes } = build([campaignRow(1)], ON)
    await expect(m.mutate({ verb: 'pause', target: target('157351362', 'ad'), params: {} })).rejects.toMatchObject({ code: 'bad_target' })
    await expect(m.mutate(req('pause', '404'))).rejects.toMatchObject({ code: 'bad_target' })
    await expect(m.mutate(req('halt_all', '1'))).rejects.toBeInstanceOf(ChannelNotEnabledError)
    expect(writes).toEqual([])
  })
})

describe('gas', () => {
  it('resume is refused while the cap is 0 or missing', async () => {
    const { m, writes } = build([campaignRow(1, { status: 0 })], ON_NO_CAP)
    await expect(m.mutate(req('resume', '1'))).rejects.toMatchObject({ code: 'total_cap_exceeded' })
    expect(writes).toEqual([])
  })

  it('resume sends PUT /campaigns/play when the projection fits under the cap', async () => {
    // spent 1000 + remaining total 2000 = 3000, under 13500.
    const { m, writes } = build([campaignRow(1, { status: 0 })], ON)
    const r = await m.mutate(req('resume', '1'))
    expect(writes).toEqual([{ method: 'PUT', path: 'campaigns/play', body: { campaign_ids: [1] }, opts: undefined }])
    expect(r.after).toEqual({ status: 'ACTIVE' })
  })

  it('resume is refused when the projection is over the cap', async () => {
    const { m, writes } = build([campaignRow(1, { status: 0 }), campaignRow(2, { total_budget_spent: 12000, total_budget_limit: 0 })], ON)
    // spent 13000 + campaign 2 active daily 2000 + campaign 1 remaining 2000 = 17000 > 13500.
    await expect(m.mutate(req('resume', '1'))).rejects.toBeInstanceOf(MutationRefusedError)
    expect(writes).toEqual([])
  })

  it('refuses to resume an archived campaign', async () => {
    const { m, writes } = build([campaignRow(1, { status: -1 })], ON)
    await expect(m.mutate(req('resume', '1'))).rejects.toMatchObject({ code: 'bad_target' })
    expect(writes).toEqual([])
  })

  it('a raised budget is gas and is checked against the cap', async () => {
    const small = build([campaignRow(1, { total_budget_limit: 0, total_budget_spent: 1000 })], { operatorEnabled: true, totalCapCents: 6000 })
    await expect(small.m.mutate(req('set_budget', '1', { dailyBudgetCents: 6000 }))).rejects.toMatchObject({ code: 'total_cap_exceeded' })
    expect(small.writes).toEqual([])
    const roomy = build([campaignRow(1, { total_budget_limit: 0, total_budget_spent: 1000 })], { operatorEnabled: true, totalCapCents: 9000 })
    await roomy.m.mutate(req('set_budget', '1', { dailyBudgetCents: 6000 }))
    expect(roomy.writes[0]).toMatchObject({ path: 'campaigns/1', body: { max_daily_budget: 6000 } })
  })

  it('createPaused forces status 0, sends once with no retries, and returns the id', async () => {
    const { m, writes, sync } = build([], ON)
    const r = await m.createPaused({ body: { name: 'new', status: 1 }, dailyBudgetCents: 2000 })
    expect(writes).toEqual([{ method: 'POST', path: 'campaigns', body: { name: 'new', status: 0 }, opts: { retries: 0 } }])
    expect(r.campaignId).toBe('777')
    expect(sync).toHaveBeenCalledWith('adult:exoclick', ['777'])
  })

  it('createPaused refuses a budget under $20, a missing body, and an over-cap campaign', async () => {
    const { m, writes } = build([], ON)
    await expect(m.createPaused({ body: {}, dailyBudgetCents: 1500 })).rejects.toMatchObject({ code: 'bad_params' })
    await expect(m.createPaused(null)).rejects.toMatchObject({ code: 'bad_params' })
    await expect(m.createPaused({ body: {}, dailyBudgetCents: 2000, totalBudgetCents: 1000 })).rejects.toMatchObject({ code: 'bad_params' })
    await expect(m.createPaused({ body: {}, dailyBudgetCents: 20000 })).rejects.toMatchObject({ code: 'total_cap_exceeded' })
    expect(writes).toEqual([])
  })

  it('createPaused with the cap unset sends nothing', async () => {
    const { m, writes } = build([], ON_NO_CAP)
    await expect(m.createPaused({ body: {}, dailyBudgetCents: 2000 })).rejects.toMatchObject({ code: 'total_cap_exceeded' })
    expect(writes).toEqual([])
  })

  describe('banner upload (update_creative)', () => {
    const GOOD = 'https://curious.xdipx.com/p?utm_source=exoclick&utm_medium=display&utm_campaign=x&utm_content=y'

    it('refuses a URL without the four UTMs', async () => {
      const { m, writes } = build([campaignRow(1)], ON)
      await expect(m.mutate(req('update_creative', '1', { body: { url: 'https://xdipx.com/?utm_source=exoclick' } }))).rejects.toMatchObject({ code: 'bad_params' })
      expect(writes).toEqual([])
    })

    it('drops name on an img_banner campaign, sends once, and is gas', async () => {
      const { m, writes } = build([campaignRow(1)], ON)
      await m.mutate(req('update_creative', '1', { body: { url: GOOD, name: 'nope', imgurl: 'https://x/y.jpg' } }))
      expect(writes).toEqual([{ method: 'POST', path: 'campaigns/1/variation', body: { url: GOOD, imgurl: 'https://x/y.jpg' }, opts: { retries: 0 } }])
      const capped = build([campaignRow(1)], ON_NO_CAP)
      await expect(capped.m.mutate(req('update_creative', '1', { body: { url: GOOD } }))).rejects.toMatchObject({ code: 'total_cap_exceeded' })
      expect(capped.writes).toEqual([])
    })
  })
})
