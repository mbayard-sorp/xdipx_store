import { describe, expect, it } from 'vitest'
import { buildAdsDigestFacts, gatherAdsDigest, renderAdsDigestSection, type AdsDigestStore } from './digest.server'
import { verifyApproveLink } from './approve-link.server'
import type { AdActionRow } from './ledger.server'

const NOW = new Date('2026-10-19T09:00:00Z')
const HOUR = 3_600_000
const SECRET = 'digest-secret'

function row(id: number, over: Partial<AdActionRow>): AdActionRow {
  return {
    id, idempotencyKey: `k${id}`, platform: 'meta', targetLevel: 'ad', targetExternalId: `ad-${id}`,
    verb: 'pause', params: null, before: null, after: null, proposedBy: 'rule:L1', reason: null,
    ruleEventId: null, tier: 'auto', status: 'applied', approvedBy: 'auto', approvedAt: NOW,
    appliedAt: new Date(NOW.getTime() - HOUR), platformResponse: null, error: null, expiresAt: null,
    createdAt: new Date(NOW.getTime() - 2 * HOUR), ...over,
  } as AdActionRow
}

const applied = [
  row(1, { targetExternalId: 'ad-img07', reason: '$24 spent, 0 leads' }),
  row(2, { verb: 'halt_all', targetLevel: 'campaign', targetExternalId: 'all', proposedBy: 'rule:R7', reason: 'R7 paused all: spend passed the cap' }),
  // Applied 30 hours ago: outside the 24h window.
  row(3, { appliedAt: new Date(NOW.getTime() - 30 * HOUR) }),
]

const pending = [
  row(10, {
    status: 'proposed', tier: 'approve', verb: 'set_budget', targetLevel: 'adset', targetExternalId: 'as-proven',
    params: { dailyBudgetCents: 1200 }, before: { dailyBudgetCents: 1000 },
    after: { dailyBudgetCents: 1200, expectedContribution7dCents: 1800 }, proposedBy: 'rule:L5', approvedBy: null, appliedAt: null,
  }),
  row(11, {
    status: 'proposed', tier: 'approve', verb: 'resume', targetExternalId: 'ad-old', proposedBy: 'rule:L7',
    after: { status: 'ACTIVE', expectedContribution7dCents: 400 }, approvedBy: null, appliedAt: null,
  }),
  row(12, { status: 'proposed', tier: 'approve', verb: 'resume', targetExternalId: 'ad-x', approvedBy: null, appliedAt: null }),
  row(13, { status: 'proposed', tier: 'approve', verb: 'resume', targetExternalId: 'ad-y', approvedBy: null, appliedAt: null }),
  // Older than 48h: the applier is about to expire it, so it is no tap.
  row(14, { status: 'proposed', tier: 'approve', verb: 'resume', approvedBy: null, appliedAt: null, createdAt: new Date(NOW.getTime() - 49 * HOUR) }),
]

const entities = [
  { platform: 'meta', externalId: 'ad-img07', name: 'img07', level: 'ad' },
  { platform: 'meta', externalId: 'as-proven', name: 'Proven', level: 'adset' },
]

describe('ads digest section', () => {
  const facts = buildAdsDigestFacts({ applied, pending, entities }, { now: NOW, secret: SECRET, baseUrl: 'https://xdipx.com' })

  it('lists what the machine applied in the last 24h with the rule and its inputs', () => {
    expect(facts.machine.map(m => m.text)).toEqual([
      'paused img07 (L1: $24 spent, 0 leads)',
      'halted everything on the meta account (R7: R7 paused all: spend passed the cap)',
    ])
    expect(facts.machine.every(m => m.undoUrl === 'https://xdipx.com/admin/ads/actions?tab=applied')).toBe(true)
  })

  it('counts live taps, ranks by expected 7-day contribution, and signs a 24h approve link for each', () => {
    expect(facts.tapCount).toBe(4)
    expect(facts.taps.map(t => t.id)).toEqual([10, 11, 12])
    expect(facts.taps[0]!.text).toBe('raise the budget on Proven from $10.00 to $12.00 a day, expected +$18.00 over 7d')
    const u = new URL(facts.taps[0]!.approveUrl!)
    expect(u.pathname).toBe('/admin/ads/approve')
    expect(verifyApproveLink(u.searchParams.get('id'), u.searchParams.get('exp'), u.searchParams.get('sig'), { now: NOW, secret: SECRET }))
      .toMatchObject({ ok: true, id: 10 })
  })

  it('renders lines 6 and 7 of plan §9.8', () => {
    const html = renderAdsDigestSection(facts)
    expect(html).toContain('Machine did: paused img07 (L1: $24 spent, 0 leads). Undo: <a href="https://xdipx.com/admin/ads/actions?tab=applied"')
    expect(html).toContain('Your taps: 4. Top: raise the budget on Proven from $10.00 to $12.00 a day, expected +$18.00 over 7d.')
    expect(html).toContain('Approve #10</a>')
    expect(html).not.toContain(String.fromCharCode(0x2014))
  })

  it('says so plainly when there is nothing to report', () => {
    const empty = renderAdsDigestSection(buildAdsDigestFacts({ applied: [], pending: [], entities: [] }, { now: NOW, secret: SECRET }))
    expect(empty).toContain('Machine did: nothing in the last 24 hours.')
    expect(empty).toContain('Your taps: 0. Nothing is waiting for you.')
  })

  it('a dry run of the gatherer on a fixture store produces the section, and a broken store yields null', async () => {
    const store: AdsDigestStore = {
      appliedSince: async () => applied,
      pending: async () => pending,
      entities: async () => entities,
    }
    const f = await gatherAdsDigest({ store, now: NOW, secret: SECRET })
    expect(f?.tapCount).toBe(4)
    const broken: AdsDigestStore = { ...store, pending: async () => { throw new Error('no table') } }
    const warn = (await import('vitest')).vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await gatherAdsDigest({ store: broken, now: NOW, secret: SECRET })).toBeNull()
    warn.mockRestore()
  })
})
