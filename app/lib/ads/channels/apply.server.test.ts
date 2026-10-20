import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch, type ApplyDeps, type ApplySettings, type ApplyStore } from './apply.server'
import type { MirrorBudgetRow } from './apply-core'
import type { ChannelAdapter, MutationRequest, MutationResult } from './types'
import type { AdActionRow, NewAdAction } from '../ledger.server'
import { isLegalTransition, type AdActionStatus } from '../ledger-core'
import { metaAdapter } from './meta/adapter.server'

const NOW = new Date('2026-10-19T15:00:00Z')

// An in-memory ledger that keeps the real ledger's two rules: one row per
// idempotency key, and only legal status moves.
function memoryStore(mirror: MirrorBudgetRow[]) {
  const rows: AdActionRow[] = []
  let nextId = 1
  const store: ApplyStore = {
    mirrorRows: async ids => mirror.filter(r => ids.includes(r.externalId)),
    countAutoActionsSince: async since => rows.filter(r =>
      r.tier === 'auto' && ['approved', 'applied', 'failed'].includes(r.status) && r.createdAt >= since).length,
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
      return row
    },
  }
  return { store, rows }
}

const mirror: MirrorBudgetRow[] = [
  { platform: 'meta', level: 'ad', externalId: 'ad1', parentExternalId: 'as1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'adset', externalId: 'as1', parentExternalId: 'c1', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: 1000, lifetimeBudgetCents: null },
  { platform: 'meta', level: 'campaign', externalId: 'c1', parentExternalId: null, status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
]

const ALL_ON: ApplySettings = { spendEnabled: true, autoApplyEnabled: true, autoActionsMaxPerDay: 10, budgetMaxStepPct: 20 }

function fakeAdapter(impl?: (m: MutationRequest) => Promise<MutationResult>) {
  const mutate = vi.fn(impl ?? (async () => ({ applied: true, after: { status: 'PAUSED' }, platformResponse: { success: true } })))
  const adapter = { id: 'meta', mutate } as unknown as ChannelAdapter
  return { adapter, mutate }
}

function deps(over: { settings?: Partial<ApplySettings>; store?: ApplyStore; adapter?: ChannelAdapter; sync?: ApplyDeps['syncAfterWrite'] } = {}): ApplyDeps {
  return {
    store: over.store,
    settings: async () => ({ ...ALL_ON, ...over.settings }),
    adapterFor: () => over.adapter ?? null,
    syncAfterWrite: over.sync ?? (async () => ({})),
  }
}

describe('dispatch', () => {
  let mem: ReturnType<typeof memoryStore>
  beforeEach(() => { mem = memoryStore(mirror) })

  it('with both valves off writes dry_run rows only and never calls mutate', async () => {
    const { adapter, mutate } = fakeAdapter()
    const d = deps({ store: mem.store, adapter, settings: { spendEnabled: false, autoApplyEnabled: false } })
    const pause = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', reason: 'Pause: R1', now: NOW }, d)
    const brake = await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.9, proposedBy: 'rule:R6', now: NOW }, d)
    const scale = await dispatch({ verb: 'scale', adExternalId: 'ad1', budgetFactor: 1.2, proposedBy: 'rule:R5', now: NOW }, d)
    const resume = await dispatch({ verb: 'resume', adExternalId: 'ad1', proposedBy: 'rule:R4', now: NOW }, d)
    const refresh = await dispatch({ verb: 'update_creative', adExternalId: 'ad1', proposedBy: 'rule:R8', now: NOW }, d)
    for (const r of [pause, brake, scale, resume, refresh]) {
      expect(r.status).toBe('dry_run')
      expect(r.applied).toBe(false)
    }
    expect(mem.rows.map(r => r.status)).toEqual(['dry_run', 'dry_run', 'dry_run', 'dry_run', 'dry_run'])
    expect(mem.rows.map(r => r.tier)).toEqual(['auto', 'auto', 'approve', 'approve', 'owner'])
    expect(mem.rows[0]!.reason).toBe('Dry run: ads_spend_enabled is off. Pause: R1')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('no mutate is reachable while any valve is off, for any verb', async () => {
    const { adapter, mutate } = fakeAdapter()
    const offs: Array<Partial<ApplySettings>> = [
      { spendEnabled: false }, { autoApplyEnabled: false }, { spendEnabled: false, autoApplyEnabled: false },
    ]
    for (const off of offs) {
      const m = memoryStore(mirror)
      const d = deps({ store: m.store, adapter, settings: off })
      await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: NOW }, d)
      await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.85, proposedBy: 'rule:R6', now: NOW }, d)
      await dispatch({ verb: 'halt_all', target: { platform: 'meta', level: 'campaign', externalId: 'c1' }, proposedBy: 'rule:R7', now: NOW }, d)
      expect(m.rows.every(r => r.status === 'dry_run')).toBe(true)
    }
    // The caller's own read of the spend valve holds the row too.
    const m = memoryStore(mirror)
    await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', spendEnabledHint: false, now: NOW }, deps({ store: m.store, adapter }))
    expect(m.rows[0]!.status).toBe('dry_run')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('a budget increase never classifies auto and never reaches mutate, even with both valves on', async () => {
    const { adapter, mutate } = fakeAdapter()
    const d = deps({ store: mem.store, adapter })
    const scale = await dispatch({ verb: 'scale', adExternalId: 'ad1', budgetFactor: 1.1, proposedBy: 'rule:R5', now: NOW }, d)
    const up = await dispatch({ verb: 'set_budget', adExternalId: 'ad1', newDailyBudgetCents: 1100, proposedBy: 'agent:paid-media-buyer', now: NOW }, d)
    const brakeUp = await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 1.05, proposedBy: 'rule:R6', now: NOW }, d)
    for (const r of [scale, up, brakeUp]) {
      expect(r.tier).toBe('approve')
      expect(r.status).toBe('dry_run')
    }
    expect(mem.rows.every(r => r.tier !== 'auto')).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('targets the budget owner for budget verbs and the ad for pause, with before and after from the mirror', async () => {
    const d = deps({ store: mem.store, settings: { spendEnabled: false } })
    await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.8, proposedBy: 'rule:R6', ruleEventId: 42, now: NOW }, d)
    await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: NOW }, d)
    expect(mem.rows[0]).toMatchObject({
      verb: 'set_budget', targetLevel: 'adset', targetExternalId: 'as1', ruleEventId: 42,
      before: { dailyBudgetCents: 1000 }, after: { dailyBudgetCents: 800 }, params: { dailyBudgetCents: 800, via: 'brake' },
    })
    expect(mem.rows[1]).toMatchObject({
      verb: 'pause', targetLevel: 'ad', targetExternalId: 'ad1', before: { status: 'ACTIVE' }, after: { status: 'PAUSED' },
    })
  })

  it('the same idempotency key inserts once', async () => {
    const { adapter, mutate } = fakeAdapter()
    const d = deps({ store: mem.store, adapter })
    const first = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: NOW }, d)
    const second = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'owner', now: new Date('2026-10-19T22:00:00Z') }, d)
    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(false)
    expect(second.applied).toBe(false)
    expect(mem.rows).toHaveLength(1)
    expect(mutate).toHaveBeenCalledTimes(1)
    // A new UTC day is a new key.
    await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: new Date('2026-10-20T01:00:00Z') }, d)
    expect(mem.rows).toHaveLength(2)
  })

  it('the auto path with both valves on reaches the adapter exactly once and records applied', async () => {
    const { adapter, mutate } = fakeAdapter()
    const sync = vi.fn(async () => ({}))
    const r = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: NOW }, deps({ store: mem.store, adapter, sync }))
    expect(r).toMatchObject({ status: 'applied', applied: true, tier: 'auto', inserted: true })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({ verb: 'pause', target: { platform: 'meta', level: 'ad', externalId: 'ad1' }, params: null })
    expect(mem.rows[0]).toMatchObject({ status: 'applied', approvedBy: 'auto' })
    expect(sync).toHaveBeenCalledWith('meta', ['ad1'])
  })

  it('a brake inside the step cap auto-applies; one past it stays dry_run', async () => {
    const { adapter, mutate } = fakeAdapter(async () => ({ applied: true }))
    const d = deps({ store: mem.store, adapter })
    const small = await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.85, proposedBy: 'rule:R6', now: NOW }, d)
    const big = await dispatch({ verb: 'brake', adExternalId: 'ad1', budgetFactor: 0.7, proposedBy: 'rule:R6', now: NOW }, d)
    expect(small.status).toBe('applied')
    expect(big.status).toBe('dry_run')
    expect(mem.rows[1]!.reason).toMatch(/ads_budget_max_step_pct \(20%\)/)
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('stops at the daily auto cap', async () => {
    const { adapter, mutate } = fakeAdapter()
    const m = memoryStore([
      ...mirror,
      { ...mirror[0]!, externalId: 'ad2' },
      { ...mirror[0]!, externalId: 'ad3' },
    ])
    const d = deps({ store: m.store, adapter, settings: { autoActionsMaxPerDay: 2 } })
    for (const ad of ['ad1', 'ad2', 'ad3']) await dispatch({ verb: 'pause', adExternalId: ad, proposedBy: 'rule:R1', now: NOW }, d)
    expect(m.rows.map(r => r.status)).toEqual(['applied', 'applied', 'dry_run'])
    expect(m.rows[2]!.reason).toMatch(/daily cap reached: 2 automatic actions today, cap 2/)
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('the real Meta adapter throws NotEnabled, which lands as failed with the error', async () => {
    const r = await dispatch(
      { verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: NOW },
      { ...deps({ store: mem.store }), adapterFor: () => metaAdapter },
    )
    expect(r).toMatchObject({ status: 'failed', applied: false, error: true })
    expect(mem.rows[0]).toMatchObject({ status: 'failed', tier: 'auto' })
    expect(mem.rows[0]!.error).toMatch(/^not_enabled: mutate:pause is not enabled for channel meta/)
  })

  it('a channel with no adapter lands as failed, not applied', async () => {
    const r = await dispatch({ verb: 'pause', adExternalId: 'ad1', proposedBy: 'rule:R1', now: NOW }, deps({ store: mem.store }))
    expect(r.status).toBe('failed')
    expect(mem.rows[0]!.error).toBe('No adapter for channel meta.')
  })

  it('writes no row when the target cannot be resolved', async () => {
    const d = deps({ store: mem.store, settings: { spendEnabled: false } })
    const noOwner = await dispatch({ verb: 'scale', adExternalId: 'ghost', budgetFactor: 1.2, proposedBy: 'rule:R5', now: NOW }, d)
    const noPlatform = await dispatch({ verb: 'pause', adExternalId: 'ghost', proposedBy: 'rule:R1', now: NOW }, d)
    const viaLane = await dispatch({ verb: 'pause', adExternalId: 'ghost', platform: 'google', proposedBy: 'rule:R1', now: NOW }, d)
    expect(noOwner.status).toBe('skipped')
    expect(noPlatform.status).toBe('skipped')
    expect(viaLane.status).toBe('dry_run')
    expect(mem.rows).toHaveLength(1)
    expect(mem.rows[0]).toMatchObject({ platform: 'google', targetExternalId: 'ghost', before: null })
  })
})
