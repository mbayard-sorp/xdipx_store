/**
 * /api/team/enrich-queue — the subagent (Max) enrichment transport's API.
 * These tests pin the server-side gating (kill switch, transport check, claim
 * cap clamp) so the R-ENRICH routine can rely on { ok:false, reason } being an
 * honest skip signal, and so a routine bug can never claim past the owner's
 * import_enrich_batch_cap.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = new Map<string, string>()
vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/feed-processor.server', () => ({
  getPipelineSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
}))

const claimMock    = vi.fn(async (cap: number, leaseId: string) => ({
  leaseId, claims: [], skippedNoBrief: 0, sharedContext: {},
  _cap: cap,
}))
const completeMock = vi.fn(async () => ({ ok: true, result: 'enriched' }))
const releaseMock  = vi.fn(async () => ({ ok: false, result: 'requeued', reason: 'subagent generation failed: x' }))
vi.mock('~/lib/import-enrich.server', () => ({
  claimEnrichmentForSubagent: (cap: number, leaseId: string) => claimMock(cap, leaseId),
  completeSubagentEnrichment: () => completeMock(),
  releaseSubagentClaim:       () => releaseMock(),
  snapshotEnrichFunnel:       vi.fn(async () => ({ pending: 0, importedUnenriched: 0, inFlight: 0, parked: 0, enriched: 0 })),
  getEnrichTransport:         vi.fn(async () => (settings.get('import_enrich_transport') === 'subagent' ? 'subagent' : 'batch-api')),
}))

import { action, clampClaimCap } from '~/routes/api.team.enrich-queue'

function post(body: unknown): Request {
  return new Request('https://xdipx.com/api/team/enrich-queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-team-secret': 'test' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  settings.clear()
  claimMock.mockClear()
})

describe('clampClaimCap', () => {
  it('defaults to the setting cap when no cap is requested', () => {
    expect(clampClaimCap(undefined, 10)).toBe(10)
  })
  it('never exceeds the owner setting cap', () => {
    expect(clampClaimCap(50, 10)).toBe(10)
  })
  it('never exceeds the per-request ceiling even with a big setting', () => {
    expect(clampClaimCap(100, 100)).toBe(15)
  })
  it('honours a smaller requested cap', () => {
    expect(clampClaimCap(3, 10)).toBe(3)
  })
  it('falls back to the default on a broken setting value', () => {
    expect(clampClaimCap(undefined, NaN)).toBe(10)
    expect(clampClaimCap(undefined, 0)).toBe(10)
  })
})

describe('action gating', () => {
  it('refuses every mutating op while import_enrich_enabled is off', async () => {
    settings.set('import_enrich_transport', 'subagent')
    for (const body of [
      { op: 'claim', leaseId: 'r1' },
      { op: 'complete', candidateId: 1, writes: {} },
      { op: 'release', candidateId: 1, reason: 'x' },
    ]) {
      const res = await action({ request: post(body), params: {}, context: {} } as never)
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.reason).toBe('disabled')
    }
  })

  it('refuses claim when the transport is batch-api (cron owns generation)', async () => {
    settings.set('import_enrich_enabled', 'true')
    const res = await action({ request: post({ op: 'claim', leaseId: 'r1' }), params: {}, context: {} } as never)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.reason).toBe('wrong_transport')
    expect(claimMock).not.toHaveBeenCalled()
  })

  it('claims with the clamped cap under the subagent transport', async () => {
    settings.set('import_enrich_enabled', 'true')
    settings.set('import_enrich_transport', 'subagent')
    settings.set('import_enrich_batch_cap', '10')
    const res = await action({ request: post({ op: 'claim', leaseId: 'run-42', cap: 99 }), params: {}, context: {} } as never)
    expect(res.status).toBe(200)
    expect(claimMock).toHaveBeenCalledWith(10, 'run-42')
  })

  it('requires a leaseId on claim', async () => {
    settings.set('import_enrich_enabled', 'true')
    settings.set('import_enrich_transport', 'subagent')
    const res = await action({ request: post({ op: 'claim' }), params: {}, context: {} } as never)
    expect(res.status).toBe(400)
  })

  it('status works without the kill switch (read-only)', async () => {
    const res = await action({ request: post({ op: 'status' }), params: {}, context: {} } as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.transport).toBe('batch-api')
    expect(json.enabled).toBe(false)
  })
})
