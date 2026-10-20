/**
 * POST /api/team/ad-action (ticket #16433, plan §5 and §9.4). The ledger and
 * the mirror are an in-memory fake, so no database is touched.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

interface FakeRow {
  id: number
  idempotencyKey: string
  platform: string
  targetLevel: string
  targetExternalId: string
  verb: string
  params: Record<string, unknown> | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  proposedBy: string
  reason: string | null
  tier: string
  status: string
  approvedBy: string | null
  approvedAt: Date | null
  appliedAt: Date | null
  error: string | null
  expiresAt: Date | null
  createdAt: Date
}

const h = vi.hoisted(() => ({
  rows: [] as FakeRow[],
  mirror: [] as Array<Record<string, unknown>>,
  nextId: 1,
}))

vi.mock('~/lib/ads/ledger.server', () => ({
  insertAction: vi.fn(async (input: Record<string, unknown>) => {
    if (h.rows.some(r => r.idempotencyKey === input['idempotencyKey'])) return { inserted: false, row: null }
    const row = {
      id: h.nextId++,
      approvedBy: null, approvedAt: null, appliedAt: null, error: null,
      createdAt: new Date(),
      ...input,
    } as unknown as FakeRow
    h.rows.push(row)
    return { inserted: true, row }
  }),
}))

vi.mock('~/lib/ads/ad-action-propose.server', () => ({
  findMirrorTarget: vi.fn(async (platform: string, level: string, externalId: string) =>
    h.mirror.find(m => m['platform'] === platform && m['level'] === level && m['externalId'] === externalId) ?? null),
  findActionByKey: vi.fn(async (key: string) => h.rows.find(r => r.idempotencyKey === key) ?? null),
  countProposedSince: vi.fn(async (by: string, since: Date) =>
    h.rows.filter(r => r.proposedBy === by && r.createdAt >= since).length),
  listProposedSince: vi.fn(async (by: string, since: Date) =>
    h.rows.filter(r => r.proposedBy === by && r.createdAt >= since).reverse()),
}))

import { action } from '~/routes/api.team.ad-action'
import { insertAction } from '~/lib/ads/ledger.server'
import { PROPOSE_ONLY_MESSAGE } from '~/lib/ads/ad-action-propose-core'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/ad-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

function mirrorRow(level: string, externalId: string, extra: Record<string, unknown> = {}) {
  return {
    platform: 'meta', level, externalId,
    status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    dailyBudgetCents: null, lifetimeBudgetCents: null, creativeId: null,
    ...extra,
  }
}

function propose(overrides: Record<string, unknown> = {}) {
  return post({
    op: 'propose',
    platform: 'meta',
    target: { level: 'ad', externalId: 'ad1' },
    verb: 'pause',
    params: {},
    reason: 'CPL is 2x the Proven median after $40.',
    expectedContributionCents: 400,
    source: 'paid-media-buyer',
    ...overrides,
  })
}

beforeEach(() => {
  h.rows = []
  h.nextId = 1
  h.mirror = [
    mirrorRow('campaign', 'c1'),
    mirrorRow('adset', 'as1', { dailyBudgetCents: 1750 }),
    mirrorRow('adset', 'as2', { dailyBudgetCents: 750 }),
    mirrorRow('ad', 'ad1', { creativeId: 11 }),
    mirrorRow('ad', 'ad2', { status: 'PAUSED', effectiveStatus: 'PAUSED' }),
    mirrorRow('ad', 'ad3'),
  ]
  vi.mocked(insertAction).mockClear()
})

describe("op:'propose'", () => {
  it('inserts a proposed row once; a same-day replay returns inserted false', async () => {
    const first = await propose()
    expect(first.status).toBe(200)
    const a = await first.json() as Record<string, unknown>
    expect(a).toMatchObject({ ok: true, inserted: true, status: 'proposed' })
    expect(typeof a['id']).toBe('number')

    const again = await propose({ params: {}, reason: 'different words, same change' })
    const b = await again.json() as Record<string, unknown>
    expect(again.status).toBe(200)
    expect(b).toMatchObject({ inserted: false, id: a['id'] })
    expect(h.rows).toHaveLength(1)

    const row = h.rows[0]!
    expect(row.status).toBe('proposed')
    expect(row.proposedBy).toBe('agent:paid-media-buyer')
    expect(row.before).toEqual({ status: 'ACTIVE', effectiveStatus: 'ACTIVE' })
    expect(row.after).toMatchObject({ status: 'PAUSED', expectedContribution7dCents: 400 })
    const ttl = row.expiresAt!.getTime() - row.createdAt.getTime()
    expect(ttl).toBeGreaterThan(47.9 * 3600_000)
    expect(ttl).toBeLessThanOrEqual(48 * 3600_000 + 1000)
  })

  it('never writes tier auto: a pause and a budget cut are approve', async () => {
    await propose()
    await propose({ target: { level: 'adset', externalId: 'as1' }, verb: 'set_budget', params: { dailyBudgetCents: 1200 } })
    expect(h.rows.map(r => r.tier)).toEqual(['approve', 'approve'])
    expect(h.rows[1]!.before).toEqual({ dailyBudgetCents: 1750, lifetimeBudgetCents: null })
    expect(h.rows[1]!.after).toMatchObject({ dailyBudgetCents: 1200 })
  })

  it('keeps owner tier for update_creative', async () => {
    const res = await propose({ verb: 'update_creative', params: { creativeId: 22 } })
    expect((await res.json() as Record<string, unknown>)['tier']).toBe('owner')
    expect(h.rows[0]!.before).toEqual({ creativeId: 11 })
  })

  it('returns 429 on the 4th buyer proposal of the day', async () => {
    expect((await propose({ target: { level: 'ad', externalId: 'ad1' } })).status).toBe(200)
    expect((await propose({ target: { level: 'ad', externalId: 'ad2' }, verb: 'resume' })).status).toBe(200)
    expect((await propose({ target: { level: 'ad', externalId: 'ad3' } })).status).toBe(200)
    const fourth = await propose({ target: { level: 'adset', externalId: 'as2' }, verb: 'set_budget', params: { dailyBudgetCents: 900 } })
    expect(fourth.status).toBe(429)
    expect((await fourth.json() as Record<string, unknown>)['error']).toMatch(/cap is 3/)
    expect(h.rows).toHaveLength(3)
    // A replay of one of today's three is still inserted:false, not 429.
    const replay = await propose({ target: { level: 'ad', externalId: 'ad3' } })
    expect(replay.status).toBe(200)
    expect((await replay.json() as Record<string, unknown>)['inserted']).toBe(false)
  })

  it('does not count allocator proposals against the buyer cap', async () => {
    for (const id of ['ad1', 'ad3']) await propose({ target: { level: 'ad', externalId: id }, source: 'allocator' })
    expect(h.rows.every(r => r.proposedBy === 'agent:allocator')).toBe(true)
    for (const id of ['ad1', 'ad3']) expect((await propose({ target: { level: 'ad', externalId: id } })).status).toBe(200)
  })

  it('404s an unknown target and writes nothing', async () => {
    const res = await propose({ target: { level: 'ad', externalId: 'nope' } })
    expect(res.status).toBe(404)
    expect(insertAction).not.toHaveBeenCalled()
  })

  it('404s when the external id exists at a different level', async () => {
    const res = await propose({ target: { level: 'adset', externalId: 'ad1' } })
    expect(res.status).toBe(404)
  })

  it('400s a bad body', async () => {
    expect((await propose({ verb: 'halt_all' })).status).toBe(400)
    expect((await propose({ source: 'someone-else' })).status).toBe(400)
    expect((await propose({ reason: '' })).status).toBe(400)
    expect((await propose({ verb: 'set_budget', target: { level: 'adset', externalId: 'as1' }, params: {} })).status).toBe(400)
    expect((await propose({ verb: 'set_budget', params: { dailyBudgetCents: 900 } })).status).toBe(400)
    expect(insertAction).not.toHaveBeenCalled()
  })
})

describe('approval and apply are refused', () => {
  for (const op of ['approve', 'apply', 'transition', 'reject', undefined]) {
    it(`op ${String(op)} is 403 with the propose-only sentence`, async () => {
      const res = await post({ op, id: 1 })
      expect(res.status).toBe(403)
      expect((await res.json() as Record<string, unknown>)['error']).toBe(PROPOSE_ONLY_MESSAGE)
    })
  }

  for (const status of ['approved', 'applied']) {
    it(`propose with status ${status} is 403 and writes nothing`, async () => {
      const res = await propose({ status })
      expect(res.status).toBe(403)
      expect((await res.json() as Record<string, unknown>)['error']).toBe(PROPOSE_ONLY_MESSAGE)
      expect(insertAction).not.toHaveBeenCalled()
    })
  }

  it('propose with an approvedBy is 403', async () => {
    expect((await propose({ approvedBy: 'owner' })).status).toBe(403)
  })
})

describe("op:'list'", () => {
  it("returns the buyer's own rows with status, not the allocator's", async () => {
    await propose()
    await propose({ target: { level: 'ad', externalId: 'ad3' }, source: 'allocator' })
    const res = await post({ op: 'list' })
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      target: { level: 'ad', externalId: 'ad1' }, verb: 'pause', status: 'proposed', tier: 'approve',
    })

    const alloc = await (await post({ op: 'list', source: 'allocator' })).json() as { items: unknown[] }
    expect(alloc.items).toHaveLength(1)
  })
})
