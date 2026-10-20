import { describe, expect, it, vi } from 'vitest'
import { applyApprovedActions, EXPIRED_REASON, isStaleProposal, type ApplyRunStore } from './apply-run.server'
import type { ApplySettings, DispatchResult } from './channels/apply.server'
import type { AdActionRow } from './ledger.server'
import { isLegalTransition } from './ledger-core'

const NOW = new Date('2026-10-19T15:00:00Z')
const HOUR = 3_600_000
const ALL_ON: ApplySettings = { spendEnabled: true, autoApplyEnabled: true, autoActionsMaxPerDay: 10, budgetMaxStepPct: 20 }

function row(id: number, over: Partial<AdActionRow> = {}): AdActionRow {
  return {
    id, idempotencyKey: `k${id}`, platform: 'meta', targetLevel: 'ad', targetExternalId: `ad-${id}`,
    verb: 'resume', params: null, before: null, after: null, proposedBy: 'rule:R4', reason: 'Revive: R4',
    ruleEventId: null, tier: 'approve', status: 'approved', approvedBy: 'mike@xdipx.com', approvedAt: NOW,
    appliedAt: null, platformResponse: null, error: null, expiresAt: null,
    createdAt: new Date(NOW.getTime() - id * HOUR), ...over,
  } as AdActionRow
}

function memory(rows: AdActionRow[], attemptedToday = 0) {
  const store: ApplyRunStore = {
    listOldestFirst: async (status, limit) => rows.filter(r => r.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).slice(0, limit),
    countAttemptedSince: async () => attemptedToday,
    transition: async (id, to, _actor, extra = {}) => {
      const r = rows.find(x => x.id === id)!
      if (!isLegalTransition(r.status, to)) throw new Error(`illegal ${r.status} -> ${to}`)
      r.status = to
      if (extra.reason !== undefined) r.reason = extra.reason
      return r
    },
  }
  return store
}

const applied = (r: AdActionRow): DispatchResult => ({
  status: 'applied', tier: r.tier, actionId: r.id, inserted: false, applied: true, error: false, note: 'ok', target: null,
})

describe('applyApprovedActions', () => {
  it('applies approved rows oldest first', async () => {
    const rows = [row(1), row(3), row(2)]
    const dispatch = vi.fn(async (r: AdActionRow) => applied(r))
    const out = await applyApprovedActions({ store: memory(rows), settings: async () => ALL_ON, dispatch, now: () => NOW })
    expect(dispatch.mock.calls.map(c => c[0].id)).toEqual([3, 2, 1])
    expect(out).toMatchObject({ applied: 3, considered: 3, stoppedAtCap: false, skipped: null })
  })

  it('stops at the daily cap, counting attempts already made today', async () => {
    const rows = [row(1), row(2), row(3), row(4)]
    const dispatch = vi.fn(async (r: AdActionRow) => applied(r))
    const out = await applyApprovedActions({
      store: memory(rows, 8), settings: async () => ({ ...ALL_ON, autoActionsMaxPerDay: 10 }), dispatch, now: () => NOW,
    })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls.map(c => c[0].id)).toEqual([4, 3])
    expect(out).toMatchObject({ applied: 2, stoppedAtCap: true, attemptedBefore: 8, cap: 10 })
  })

  it('expires proposed rows older than 48h, and keeps the fresh ones', async () => {
    const stale = row(50, { status: 'proposed', approvedBy: null, approvedAt: null, reason: 'Scale: R5' })
    const fresh = row(5, { status: 'proposed', approvedBy: null, approvedAt: null })
    const pastExpiry = row(2, { status: 'proposed', approvedBy: null, approvedAt: null, expiresAt: new Date(NOW.getTime() - 1) })
    const rows = [stale, fresh, pastExpiry]
    const out = await applyApprovedActions({ store: memory(rows), settings: async () => ALL_ON, dispatch: vi.fn(), now: () => NOW })
    expect(out.expired).toBe(2)
    expect(stale.status).toBe('expired')
    expect(stale.reason).toBe(`${EXPIRED_REASON}. Scale: R5`)
    expect(pastExpiry.status).toBe('expired')
    expect(fresh.status).toBe('proposed')
    expect(isStaleProposal(row(48, { status: 'proposed' }), NOW)).toBe(true)
    expect(isStaleProposal(row(47, { status: 'proposed' }), NOW)).toBe(false)
  })

  it('expires even with the valves off, and then sends nothing', async () => {
    const stale = row(60, { status: 'proposed', approvedBy: null, approvedAt: null })
    const rows = [stale, row(1)]
    const dispatch = vi.fn()
    const out = await applyApprovedActions({
      store: memory(rows), settings: async () => ({ ...ALL_ON, autoApplyEnabled: false }), dispatch, now: () => NOW,
    })
    expect(out.expired).toBe(1)
    expect(out.skipped).toMatch(/ads_auto_apply_enabled is off/)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('a dispatch error does not stop the loop', async () => {
    const rows = [row(1), row(2), row(3)]
    const dispatch = vi.fn(async (r: AdActionRow) => {
      if (r.id === 2) throw new Error('graph 500')
      return applied(r)
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await applyApprovedActions({ store: memory(rows), settings: async () => ALL_ON, dispatch, now: () => NOW })
    err.mockRestore()
    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(out).toMatchObject({ applied: 2, errors: 1 })
    expect(out.notes.join(' ')).toMatch(/#2: dispatch threw, graph 500/)
  })

  it('hands stranded auto rows to adopt, in age order with the approved ones', async () => {
    const stranded = row(2, { status: 'proposed', tier: 'auto', verb: 'pause', approvedBy: null, approvedAt: null })
    const tapped = row(1)
    const order: string[] = []
    const dispatch = vi.fn(async (r: AdActionRow) => { order.push(`dispatch:${r.id}`); return applied(r) })
    const adopt = vi.fn(async (r: AdActionRow) => { order.push(`adopt:${r.id}`); return applied(r) })
    await applyApprovedActions({ store: memory([stranded, tapped]), settings: async () => ALL_ON, dispatch, adopt, now: () => NOW })
    expect(order).toEqual(['adopt:2', 'dispatch:1'])
  })

  it('counts failures against the cap and leaves waiting rows out of it', async () => {
    const rows = [row(1), row(2), row(3)]
    const dispatch = vi.fn(async (r: AdActionRow): Promise<DispatchResult> => r.id === 3
      ? { ...applied(r), status: 'failed', applied: false, error: true, note: 'refused' }
      : { ...applied(r), status: 'approved', applied: false, note: 'waits' })
    const out = await applyApprovedActions({
      store: memory(rows, 0), settings: async () => ({ ...ALL_ON, autoActionsMaxPerDay: 1 }), dispatch, now: () => NOW,
    })
    expect(out).toMatchObject({ failed: 1, waiting: 0, stoppedAtCap: true })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
