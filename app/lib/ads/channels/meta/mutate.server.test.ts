import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_PAUSE_CAP_BLOCKER_KEY, dispatch, type ApplyDeps, type ApplySettings, type ApplyStore } from '../apply.server'
import type { MirrorBudgetRow } from '../apply-core'
import { MutationRefusedError } from '../errors'
import type { MutationRequest } from '../types'
import type { AdActionRow, NewAdAction } from '../../ledger.server'
import { buildIdempotencyKey, isLegalTransition, type AdActionStatus } from '../../ledger-core'
import { createMetaAdapter } from './adapter.server'
import { GraphError, type GraphClient, type GraphJson } from './graph.server'
import { createMetaMutate, isAutomatedPauseOf, type MetaMutateSettings } from './mutate.server'

const NOW = new Date('2026-10-19T15:00:00Z')
const ALL_ON: ApplySettings = { spendEnabled: true, autoApplyEnabled: true, autoActionsMaxPerDay: 10, budgetMaxStepPct: 20 }
const CAPS: MetaMutateSettings = { dailyCapCents: 10_000, budgetMaxStepPct: 20 }

const baseMirror = (): MirrorBudgetRow[] => [
  { platform: 'meta', level: 'ad', externalId: 'ad1', parentExternalId: 'as1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'ad', externalId: 'ad2', parentExternalId: 'as1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'ad', externalId: 'ad3', parentExternalId: 'as1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'ad', externalId: 'ad4', parentExternalId: 'as1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'ad', externalId: 'ad9', parentExternalId: 'as1', status: 'PAUSED', effectiveStatus: 'PAUSED', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'adset', externalId: 'as1', parentExternalId: 'c1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: 1000, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'adset', externalId: 'as2', parentExternalId: 'c2', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: 4000, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'campaign', externalId: 'c1', parentExternalId: null, status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'campaign', externalId: 'c2', parentExternalId: null, status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
]

/**
 * One in-memory world: the ledger (one row per key, legal moves only), the
 * mirror, a mocked Graph client that records every POST, and the sync that
 * writes the change back into the mirror the way syncAfterWrite would.
 */
function world(opts: { campaigns?: GraphJson[]; postImpl?: (path: string, body: unknown) => Promise<GraphJson> } = {}) {
  const rows: AdActionRow[] = []
  const mirror = baseMirror()
  let nextId = 1
  const posts: Array<{ path: string; body: unknown }> = []
  const synced: string[][] = []
  const blockers: Array<{ dedupeKey: string; title: string }> = []

  const store: ApplyStore = {
    mirrorRows: async ids => mirror.filter(r => ids.includes(r.externalId)),
    countAutoActionsSince: async since => rows.filter(r =>
      r.tier === 'auto' && ['approved', 'applied', 'failed'].includes(r.status) && r.createdAt >= since).length,
    countAutoPausesSince: async since => rows.filter(r =>
      r.tier === 'auto' && r.verb === 'pause' && r.status === 'applied' && r.createdAt >= since).length,
    findByKey: async key => rows.find(r => r.idempotencyKey === key) ?? null,
    insert: async (input: NewAdAction) => {
      if (rows.some(r => r.idempotencyKey === input.idempotencyKey)) return { inserted: false, row: null }
      const row = {
        id: nextId++, idempotencyKey: input.idempotencyKey, platform: input.platform,
        targetLevel: input.targetLevel, targetExternalId: input.targetExternalId, verb: input.verb,
        params: input.params ?? null, before: input.before ?? null, after: input.after ?? null,
        proposedBy: input.proposedBy, reason: input.reason ?? null, ruleEventId: input.ruleEventId ?? null,
        tier: input.tier, status: input.status ?? 'proposed', approvedBy: null, approvedAt: null, appliedAt: null,
        platformResponse: null, error: null, expiresAt: null, createdAt: NOW,
      } as AdActionRow
      rows.push(row)
      return { inserted: true, row }
    },
    transition: async (id: number, to: AdActionStatus, actor: string, extra = {}) => {
      const row = rows.find(r => r.id === id)
      if (!row || !isLegalTransition(row.status, to)) throw new Error(`illegal ${row?.status} -> ${to}`)
      row.status = to
      if (to === 'approved') row.approvedBy = actor
      if (extra.error !== undefined) row.error = extra.error
      if (extra.after !== undefined) row.after = extra.after
      if (extra.platformResponse !== undefined) row.platformResponse = extra.platformResponse
      return { ...row }
    },
  }

  const post = vi.fn(async (path: string, body: unknown = {}) => {
    posts.push({ path, body })
    return opts.postImpl ? opts.postImpl(path, body) : { success: true }
  })
  const getAll = vi.fn(async () => opts.campaigns ?? [])
  const graph = { get: vi.fn(), post, getAll } as unknown as GraphClient

  const syncAfterWrite = vi.fn(async (_platform: string, ids: string[]) => {
    synced.push(ids)
    // Read the "platform" back: the last POST to each id decides its mirrored state.
    for (const id of ids) {
      const last = [...posts].reverse().find(p => p.path === id)
      const r = mirror.find(m => m.externalId === id)
      if (!last || !r) continue
      const b = last.body as Record<string, unknown>
      if (typeof b['status'] === 'string') r.status = r.effectiveStatus = b['status'] as string
      if (typeof b['daily_budget'] === 'number') r.dailyBudgetCents = b['daily_budget'] as number
    }
    return {}
  })

  const metaMutate = createMetaMutate({
    graph,
    accountId: () => 'act_920738511029316',
    settings: async () => CAPS,
    syncAfterWrite,
    store: {
      entity: async id => mirror.find(r => r.externalId === id) ?? null,
      liveBudgetRows: async () => mirror.filter(r => (r.level === 'campaign' || r.level === 'adset') && r.status === 'ACTIVE'),
      hadAutomatedPause: async id => rows.some(r => isAutomatedPauseOf(r, id)),
    },
  })
  const adapter = createMetaAdapter({ graph, credentials: () => ({ token: 't', accountId: 'act_920738511029316' } as never), mutate: m => metaMutate(m) })
  const fileBlocker = vi.fn(async (input: { dedupeKey: string; title: string }) => {
    blockers.push(input)
    return { id: 1, created: blockers.length === 1, reopened: false }
  })

  const deps = (settings: Partial<ApplySettings> = {}): ApplyDeps => ({
    store,
    settings: async () => ({ ...ALL_ON, ...settings }),
    adapterFor: () => adapter,
    syncAfterWrite,
    fileBlocker,
  })

  return { rows, mirror, posts, synced, blockers, post, getAll, syncAfterWrite, fileBlocker, metaMutate, store, deps }
}

describe('Meta mutate through the ledger dispatcher', () => {
  let w: ReturnType<typeof world>
  beforeEach(() => { w = world() })

  it('an approved automatic pause sends exactly one Graph POST and the mirror sync runs in the same request', async () => {
    const r = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:L1', now: NOW }, w.deps())
    expect(r).toMatchObject({ status: 'applied', applied: true, tier: 'auto' })
    expect(w.posts).toEqual([{ path: 'ad1', body: { status: 'PAUSED' } }])
    expect(w.synced).toEqual([['ad1']])
    expect(w.mirror.find(m => m.externalId === 'ad1')!.status).toBe('PAUSED')
    expect(w.rows[0]).toMatchObject({ status: 'applied', approvedBy: 'auto', platformResponse: { success: true }, after: { status: 'PAUSED' } })
  })

  it('a replay with the same idempotency key sends nothing', async () => {
    await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:L1', now: NOW }, w.deps())
    const again = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:L1', now: new Date('2026-10-19T18:00:00Z') }, w.deps())
    expect(again).toMatchObject({ status: 'applied', applied: false, inserted: false })
    expect(again.note).toMatch(/^Replay/)
    expect(w.post).toHaveBeenCalledTimes(1)
    expect(w.rows).toHaveLength(1)
  })

  it('a key whose row sits at approved is applied once by the next dispatch, then never again', async () => {
    const key = buildIdempotencyKey({ platform: 'meta', level: 'ad', externalId: 'ad2', verb: 'pause', day: '2026-10-19', params: null })
    const ins = await w.store.insert({
      idempotencyKey: key, platform: 'meta', targetLevel: 'ad', targetExternalId: 'ad2', verb: 'pause',
      params: null, before: { status: 'ACTIVE' }, after: { status: 'PAUSED' }, proposedBy: 'owner', tier: 'auto', status: 'proposed',
    })
    await w.store.transition(ins.row!.id, 'approved', 'owner')
    const first = await dispatch({ verb: 'pause', adExternalId: 'ad2', proposedBy: 'rule:L1', now: NOW }, w.deps())
    const second = await dispatch({ verb: 'pause', adExternalId: 'ad2', proposedBy: 'rule:L1', now: NOW }, w.deps())
    expect(first).toMatchObject({ status: 'applied', applied: true, inserted: false })
    expect(second).toMatchObject({ status: 'applied', applied: false })
    expect(w.posts).toEqual([{ path: 'ad2', body: { status: 'PAUSED' } }])
    // An approved row still waits while a valve is off.
    const v = world()
    const k = await v.store.insert({
      idempotencyKey: key, platform: 'meta', targetLevel: 'ad', targetExternalId: 'ad2', verb: 'pause',
      params: null, proposedBy: 'owner', tier: 'auto', status: 'proposed',
    })
    await v.store.transition(k.row!.id, 'approved', 'owner')
    const held = await dispatch({ verb: 'pause', adExternalId: 'ad2', proposedBy: 'rule:L1', now: NOW }, v.deps({ autoApplyEnabled: false }))
    expect(held).toMatchObject({ status: 'approved', applied: false })
    expect(v.post).not.toHaveBeenCalled()
  })

  it('a budget increase without approval sends nothing, through the dispatcher or straight to metaMutate', async () => {
    const scale = await dispatch({ verb: 'scale', adExternalId: 'ad1', budgetFactor: 1.2, proposedBy: 'rule:L5', now: NOW }, w.deps())
    const up = await dispatch({ verb: 'set_budget', adExternalId: 'ad1', newDailyBudgetCents: 1100, proposedBy: 'agent:paid-media-buyer', now: NOW }, w.deps())
    expect(scale.status).toBe('dry_run')
    expect(up.status).toBe('dry_run')
    const direct: MutationRequest = {
      verb: 'set_budget', target: { platform: 'meta', level: 'adset', externalId: 'as1' }, params: { dailyBudgetCents: 1100 },
      ledger: { actionId: 9, tier: 'auto', status: 'approved', approvedBy: 'auto' },
    }
    await expect(w.metaMutate(direct)).rejects.toMatchObject({ code: 'approval_required' })
    expect(w.post).not.toHaveBeenCalled()
  })

  it('a resume of an entity the machine never paused is refused under M4', async () => {
    const m: MutationRequest = {
      verb: 'resume', target: { platform: 'meta', level: 'ad', externalId: 'ad9' }, params: null,
      ledger: { actionId: 1, tier: 'approve', status: 'approved', approvedBy: 'owner' },
    }
    const err = await w.metaMutate(m).catch(e => e)
    expect(err).toBeInstanceOf(MutationRefusedError)
    expect(err.code).toBe('m4_resume_refused')
    expect(err.message).toMatch(/M4/)
    expect(w.post).not.toHaveBeenCalled()
  })

  it('a resume undoes the machine\'s own pause and nothing else', async () => {
    await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:L1', now: NOW }, w.deps())
    const m = (id: string): MutationRequest => ({
      verb: 'resume', target: { platform: 'meta', level: 'ad', externalId: id }, params: null,
      ledger: { actionId: 2, tier: 'approve', status: 'approved', approvedBy: 'owner' },
    })
    await expect(w.metaMutate(m('ad1'))).resolves.toMatchObject({ applied: true, after: { status: 'ACTIVE' } })
    await expect(w.metaMutate(m('ad2'))).rejects.toMatchObject({ code: 'm4_resume_refused' })
    expect(w.posts).toEqual([{ path: 'ad1', body: { status: 'PAUSED' } }, { path: 'ad1', body: { status: 'ACTIVE' } }])
    // An owner pause is not an automatic one.
    expect(isAutomatedPauseOf({ verb: 'pause', status: 'applied', approvedBy: 'owner', tier: 'auto', targetExternalId: 'x', before: { status: 'ACTIVE' }, after: null }, 'x')).toBe(false)
    // Nor is a pause of something that was already paused.
    expect(isAutomatedPauseOf({ verb: 'pause', status: 'applied', approvedBy: 'auto', tier: 'auto', targetExternalId: 'x', before: { status: 'PAUSED' }, after: null }, 'x')).toBe(false)
  })

  it('set_budget past the daily cap across live campaigns and ad sets is refused, even when approved', async () => {
    // Live today: as1 1000 + as2 4000. Cap 10000. as1 to 6500 sums to 10500.
    const m: MutationRequest = {
      verb: 'set_budget', target: { platform: 'meta', level: 'adset', externalId: 'as1' }, params: { dailyBudgetCents: 6500 },
      ledger: { actionId: 3, tier: 'approve', status: 'approved', approvedBy: 'owner' },
    }
    await expect(w.metaMutate(m)).rejects.toMatchObject({ code: 'daily_cap_exceeded' })
    // Inside the cap, an approved approve-tier raise goes through even past the 20% step.
    await expect(w.metaMutate({ ...m, params: { dailyBudgetCents: 6000 } })).resolves.toMatchObject({ applied: true })
    expect(w.posts).toEqual([{ path: 'as1', body: { daily_budget: 6000 } }])
    // A cut is never refused for the cap, but an unapproved cut past the step is.
    await expect(w.metaMutate({ ...m, params: { dailyBudgetCents: 3000 }, ledger: { actionId: 4, tier: 'auto', status: 'approved' } }))
      .rejects.toMatchObject({ code: 'budget_step_exceeded' })
  })

  it('halt_all pauses each ACTIVE campaign with one POST each and counts as one action', async () => {
    const h = world({
      campaigns: [
        { id: 'c1', status: 'ACTIVE' }, { id: 'c2', status: 'ACTIVE' }, { id: 'c3', status: 'PAUSED' },
      ],
    })
    const r = await dispatch({ verb: 'halt_all', platform: 'meta', proposedBy: 'rule:L3', now: NOW }, h.deps())
    expect(r).toMatchObject({ status: 'applied', applied: true, tier: 'auto' })
    expect(h.getAll).toHaveBeenCalledWith('act_920738511029316/campaigns', expect.objectContaining({ fields: expect.stringContaining('status') }))
    expect(h.posts).toEqual([{ path: 'c1', body: { status: 'PAUSED' } }, { path: 'c2', body: { status: 'PAUSED' } }])
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ verb: 'halt_all', status: 'applied', targetExternalId: 'all', after: { pausedIds: ['c1', 'c2'] } })
    expect(await h.store.countAutoActionsSince(new Date('2026-10-19T00:00:00Z'))).toBe(1)
    expect(h.synced).toEqual([['c1', 'c2']])
    // The ledger now licenses a resume of c1, which the halt paused while ACTIVE, and not of c3.
    expect(isAutomatedPauseOf(h.rows[0]!, 'c1')).toBe(true)
    expect(isAutomatedPauseOf(h.rows[0]!, 'c3')).toBe(false)
  })

  it('the 4th automatic pause in a day becomes dry_run and files one owner blocker', async () => {
    for (const ad of ['ad1', 'ad2', 'ad3']) {
      expect((await dispatch({ verb: 'pause', adExternalId: ad, proposedBy: 'rule:L1', now: NOW }, w.deps())).status).toBe('applied')
    }
    const fourth = await dispatch({ verb: 'pause', adExternalId: 'ad4', proposedBy: 'rule:L1', now: NOW }, w.deps())
    expect(fourth.status).toBe('dry_run')
    expect(w.rows[3]!.reason).toMatch(/^Dry run: auto-pause cap: owner page/)
    expect(w.posts).toHaveLength(3)
    expect(w.fileBlocker).toHaveBeenCalledTimes(1)
    expect(w.blockers[0]!.dedupeKey).toBe(AUTO_PAUSE_CAP_BLOCKER_KEY)
    // A brake is not a pause: it still runs under the action cap.
    const brake = await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.9, proposedBy: 'rule:R6', now: NOW }, w.deps())
    expect(brake.status).toBe('applied')
  })

  it('a brake above the step cap is clamped to it and sent as that budget', async () => {
    const r = await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.7, proposedBy: 'rule:R6', now: NOW }, w.deps())
    expect(r.status).toBe('applied')
    expect(w.posts).toEqual([{ path: 'as1', body: { daily_budget: 800 } }])
    expect(w.rows[0]!.reason).toMatch(/Brake clamped from 30% to 20% by ads_budget_max_step_pct/)
    expect(w.mirror.find(m => m.externalId === 'as1')!.dailyBudgetCents).toBe(800)
  })

  it('typed errors land in ad_actions.error with status failed', async () => {
    // A Graph refusal.
    const g = world({ postImpl: async () => { throw new GraphError('api_error', 'Graph POST ad1 refused: Invalid parameter', { status: 400, code: 100 }) } })
    const r = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:L1', now: NOW }, g.deps())
    expect(r).toMatchObject({ status: 'failed', error: true })
    expect(g.rows[0]).toMatchObject({ status: 'failed' })
    expect(g.rows[0]!.error).toBe('api_error: Graph POST ad1 refused: Invalid parameter')
    // A refusal from metaMutate itself: an approved resume of something the machine never paused.
    const key = buildIdempotencyKey({ platform: 'meta', level: 'ad', externalId: 'ad9', verb: 'resume', day: '2026-10-19', params: null })
    const ins = await w.store.insert({
      idempotencyKey: key, platform: 'meta', targetLevel: 'ad', targetExternalId: 'ad9', verb: 'resume',
      params: null, proposedBy: 'agent:paid-media-buyer', tier: 'approve', status: 'proposed',
    })
    await w.store.transition(ins.row!.id, 'approved', 'owner')
    const resume = await dispatch({ verb: 'resume', adExternalId: 'ad9', proposedBy: 'agent:paid-media-buyer', now: NOW }, w.deps())
    expect(resume).toMatchObject({ status: 'failed', error: true })
    expect(w.rows[0]!.status).toBe('failed')
    expect(w.rows[0]!.error).toMatch(/^m4_resume_refused: /)
    expect(w.post).not.toHaveBeenCalled()
  })
})

describe('metaMutate dryRun', () => {
  it('builds the exact Graph requests and sends nothing', async () => {
    const w = world({ campaigns: [{ id: 'c1', status: 'ACTIVE' }, { id: 'c2', status: 'PAUSED' }] })
    const pause = await w.metaMutate({ verb: 'pause', target: { platform: 'meta', level: 'adset', externalId: 'as1' }, params: null }, { dryRun: true })
    expect(pause).toMatchObject({ applied: false, dryRun: true, requests: [{ method: 'POST', path: 'as1', body: { status: 'PAUSED' } }] })
    const budget = await w.metaMutate({
      verb: 'set_budget', target: { platform: 'meta', level: 'adset', externalId: 'as1' }, params: { dailyBudgetCents: 900 },
      ledger: { actionId: 1, tier: 'auto', status: 'approved' },
    }, { dryRun: true })
    expect(budget.requests).toEqual([{ method: 'POST', path: 'as1', body: { daily_budget: 900 } }])
    const halt = await w.metaMutate({ verb: 'halt_all', target: { platform: 'meta', level: 'campaign', externalId: 'all' }, params: null }, { dryRun: true })
    expect(halt.requests).toEqual([{ method: 'POST', path: 'c1', body: { status: 'PAUSED' } }])
    // dryRun keeps every refusal: M4 still holds.
    await expect(w.metaMutate({ verb: 'resume', target: { platform: 'meta', level: 'ad', externalId: 'ad9' }, params: null }, { dryRun: true }))
      .rejects.toMatchObject({ code: 'm4_resume_refused' })
    expect(w.post).not.toHaveBeenCalled()
    expect(w.syncAfterWrite).not.toHaveBeenCalled()
  })

  it('update_creative stays NotEnabled', async () => {
    const w = world()
    await expect(w.metaMutate({ verb: 'update_creative', target: { platform: 'meta', level: 'ad', externalId: 'ad1' }, params: null }))
      .rejects.toMatchObject({ kind: 'not_enabled' })
  })
})
