import { describe, expect, it, vi } from 'vitest'
import type { AdActionRow, NewAdAction } from '../../ledger.server'
import type { ExoClient } from './client.server'
import { createExoclickMutate } from './mutate.server'
import { dispatchExoclickAction, type ExoOperatorStore } from './operator.server'
import type { ExoOperatorSettings } from './operator-core'

type Row = Record<string, unknown>

const campaignRow = (id: number, over: Row = {}): Row => ({
  id, name: `c${id}`, status: 1, daily_limit_type: 1, max_daily_budget_reset: 2000, total_budget_limit: 3000, total_budget_spent: 1000, ...over,
})

/** An in-memory ledger that honours the idempotency key and the legal transitions we use. */
function memoryStore() {
  const rows: AdActionRow[] = []
  const store: ExoOperatorStore = {
    async findByKey(k) { return rows.find(r => r.idempotencyKey === k) ?? null },
    async insert(input: NewAdAction) {
      const hit = rows.find(r => r.idempotencyKey === input.idempotencyKey)
      if (hit) return { inserted: false, row: null }
      const row = {
        id: rows.length + 1, idempotencyKey: input.idempotencyKey, platform: input.platform, targetLevel: input.targetLevel,
        targetExternalId: input.targetExternalId, verb: input.verb, params: input.params ?? null, before: input.before ?? null,
        after: input.after ?? null, proposedBy: input.proposedBy, reason: input.reason ?? null, ruleEventId: null, tier: input.tier,
        status: input.status ?? 'proposed', approvedBy: null, approvedAt: null, appliedAt: null, platformResponse: null, error: null,
        expiresAt: null, createdAt: new Date(),
      } as AdActionRow
      rows.push(row)
      return { inserted: true, row }
    },
    async transition(id, to, actor, extra = {}) {
      const row = rows.find(r => r.id === id)!
      row.status = to
      if (to === 'approved') row.approvedBy = actor
      if (extra.error !== undefined) row.error = extra.error
      if (extra.after !== undefined) row.after = extra.after
      return row
    },
  }
  return { store, rows }
}

function setup(campaigns: Row[], s: ExoOperatorSettings) {
  const writes: Array<{ method: string; path: string; body: unknown }> = []
  const client = {
    session: vi.fn(), reset: vi.fn(),
    get: vi.fn(async (path: string) => {
      const one = /^campaigns\/(\d+)$/.exec(path)
      if (one) return { result: { campaign: campaigns.find(c => String(c['id']) === one[1]) } }
      if (path === 'campaigns') return { result: Object.fromEntries(campaigns.map(c => [String(c['id']), c])) }
      return { result: [] }
    }),
    post: vi.fn(async (path: string, body?: unknown) => { writes.push({ method: 'POST', path, body }); return {} }),
    put: vi.fn(async (path: string, body?: unknown) => { writes.push({ method: 'PUT', path, body }); return {} }),
    del: vi.fn(),
  } as unknown as ExoClient
  const mutate = createExoclickMutate({ client, settings: async () => s, syncAfterWrite: async () => ({}) })
  const mem = memoryStore()
  return { ...mem, mutate, writes, client }
}

const target = (id = '1', level: 'campaign' | 'ad' = 'campaign') => ({ platform: 'adult:exoclick' as const, level, externalId: id })
const NOW = new Date('2026-11-15T12:00:00Z')
const base = { proposedBy: 'rule:exoclick-kill-rules', now: NOW }

describe('dispatchExoclickAction', () => {
  it('with the switch off: not_enabled, a dry_run row, and no network write', async () => {
    const t = setup([campaignRow(1)], { operatorEnabled: false, totalCapCents: 99999 })
    const r = await dispatchExoclickAction({ ...base, verb: 'pause', target: target(), params: null }, { store: t.store, mutate: t.mutate })
    expect(r).toMatchObject({ status: 'not_enabled', applied: false, error: false })
    expect(t.writes).toEqual([])
    expect(t.client.get).not.toHaveBeenCalled()
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toMatchObject({ status: 'dry_run', verb: 'pause', tier: 'auto' })
    expect(t.rows[0]!.reason).toMatch(/exoclick_operator_enabled is off/)
  })

  it('a brake with the switch on and no cap applies, and the row ends applied', async () => {
    const t = setup([campaignRow(1)], { operatorEnabled: true, totalCapCents: 0 })
    const r = await dispatchExoclickAction({ ...base, verb: 'block_placement', target: target(), params: { hostnames: ['rat.xxx'] } }, { store: t.store, mutate: t.mutate })
    expect(r).toMatchObject({ status: 'applied', applied: true, tier: 'auto' })
    expect(t.writes).toEqual([{ method: 'POST', path: 'campaigns/1/blocked/sites', body: ['rat.xxx'] }])
    expect(t.rows[0]).toMatchObject({ status: 'applied', approvedBy: 'auto', platform: 'adult:exoclick', verb: 'block_placement' })
  })

  it('a second identical brake the same day is a replay with no second write', async () => {
    const t = setup([campaignRow(1)], { operatorEnabled: true, totalCapCents: 0 })
    const req = { ...base, verb: 'pause' as const, target: target(), params: null }
    await dispatchExoclickAction(req, { store: t.store, mutate: t.mutate })
    const again = await dispatchExoclickAction(req, { store: t.store, mutate: t.mutate })
    expect(again).toMatchObject({ status: 'applied', applied: false })
    expect(t.writes).toHaveLength(1)
    expect(t.rows).toHaveLength(1)
  })

  it('gas with a zero cap is held as dry_run and sends nothing', async () => {
    const t = setup([campaignRow(1, { status: 0 })], { operatorEnabled: true, totalCapCents: 0 })
    const r = await dispatchExoclickAction({ ...base, verb: 'resume', target: target(), params: null }, { store: t.store, mutate: t.mutate })
    expect(r).toMatchObject({ status: 'dry_run', applied: false, tier: 'approve' })
    expect(t.writes).toEqual([])
    expect(t.rows[0]).toMatchObject({ status: 'dry_run', tier: 'approve' })
    expect(t.rows[0]!.reason).toMatch(/exoclick_total_cap_cents is 0 or missing/)
  })

  it('gas under the cap applies and is approved by its proposer', async () => {
    const t = setup([campaignRow(1, { status: 0 })], { operatorEnabled: true, totalCapCents: 13500 })
    const r = await dispatchExoclickAction({ ...base, proposedBy: 'owner', verb: 'resume', target: target(), params: null }, { store: t.store, mutate: t.mutate })
    expect(r).toMatchObject({ status: 'applied', applied: true, tier: 'approve' })
    expect(t.writes).toEqual([{ method: 'PUT', path: 'campaigns/play', body: { campaign_ids: [1] } }])
    expect(t.rows[0]).toMatchObject({ status: 'applied', approvedBy: 'owner' })
  })

  it('a held row does not block the same action once the switch is on the same day', async () => {
    const off = setup([campaignRow(1)], { operatorEnabled: false, totalCapCents: 0 })
    const req = { ...base, verb: 'pause' as const, target: target(), params: null }
    await dispatchExoclickAction(req, { store: off.store, mutate: off.mutate })
    const on = createExoclickMutate({ client: off.client, settings: async () => ({ operatorEnabled: true, totalCapCents: 0 }), syncAfterWrite: async () => ({}) })
    const r = await dispatchExoclickAction(req, { store: off.store, mutate: on })
    expect(r.status).toBe('applied')
    expect(off.rows.map(x => x.status)).toEqual(['dry_run', 'applied'])
  })

  it('a platform failure lands the row as failed with the error text', async () => {
    const t = setup([campaignRow(1)], { operatorEnabled: true, totalCapCents: 0 })
    ;(t.client.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ExoClick PUT campaigns/pause refused: boom'))
    const r = await dispatchExoclickAction({ ...base, verb: 'pause', target: target(), params: null }, { store: t.store, mutate: t.mutate })
    expect(r).toMatchObject({ status: 'failed', error: true })
    expect(t.rows[0]).toMatchObject({ status: 'failed' })
    expect(t.rows[0]!.error).toMatch(/boom/)
  })

  it('skips a variation pause with no row and no write, and a non-ExoClick target', async () => {
    const t = setup([campaignRow(1)], { operatorEnabled: true, totalCapCents: 0 })
    const v = await dispatchExoclickAction({ ...base, verb: 'pause', target: target('157351362', 'ad'), params: null }, { store: t.store, mutate: t.mutate })
    expect(v).toMatchObject({ status: 'skipped', actionId: null })
    const other = await dispatchExoclickAction({ ...base, verb: 'pause', target: { platform: 'meta', level: 'campaign', externalId: '1' }, params: null }, { store: t.store, mutate: t.mutate })
    expect(other.status).toBe('skipped')
    expect(t.rows).toEqual([])
    expect(t.writes).toEqual([])
  })
})
