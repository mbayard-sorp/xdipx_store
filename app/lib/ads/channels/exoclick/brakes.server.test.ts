import { describe, expect, it, vi } from 'vitest'
import type { ExoClient } from './client.server'
import { BRAKES_PROPOSER, planBrakes, runExoclickBrakes } from './brakes.server'
import type { KillAction } from './kill-rules-core'
import type { ExoActionRequest, ExoActionResult } from './operator.server'

const NOW = new Date('2026-11-15T12:00:00Z')

/** A fake client serving the same shapes the live API returned on 2026-11-15. */
function fakeClient(opts: { siteRows?: unknown[]; campaignStats?: unknown[]; hourCost?: number } = {}) {
  const gets: Array<{ path: string; params: Record<string, unknown> }> = []
  const client = {
    session: vi.fn(), reset: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(),
    get: vi.fn(async (path: string, params: Record<string, unknown> = {}) => {
      gets.push({ path, params })
      if (path === 'statistics/a/site') return { result: (opts.siteRows ?? []).slice(Number(params['offset'] ?? 0), Number(params['offset'] ?? 0) + Number(params['limit'])) }
      if (path === 'statistics/a/variation') return { result: [] }
      if (path === 'statistics/a/campaign') return { result: opts.campaignStats ?? [] }
      if (path === 'statistics/a/hour') return { result: opts.hourCost == null ? [] : [{ hour: 3, cost: opts.hourCost }] }
      if (path === 'campaigns') return { result: { 1: { id: 1, status: 1 }, 2: { id: 2, status: 1 } } }
      if (path === 'user') return { result: { balance: 172.34 } }
      return { result: [] }
    }),
  } as unknown as ExoClient
  return { client, gets }
}

const noop = async (r: ExoActionRequest): Promise<ExoActionResult> => ({
  status: 'applied', tier: 'auto', actionId: 1, applied: true, error: false, note: 'ok', target: r.target,
})

describe('planBrakes', () => {
  const block = (hostname: string, ids: string[]): KillAction => ({ kind: 'block_site', rule: 'site_zero_click', hostname, campaignIds: ids, reason: `${hostname} no clicks` })

  it('groups site blocks into one list per campaign', () => {
    const { planned } = planBrakes([block('a.com', ['1', '2']), block('b.com', ['1', '2'])], false)
    expect(planned.map(p => [p.verb, p.targetId, (p.params as { hostnames: string[] }).hostnames])).toEqual([
      ['block_placement', '1', ['a.com', 'b.com']],
      ['block_placement', '2', ['a.com', 'b.com']],
    ])
  })

  it('chunks a long list at 100 hostnames per call', () => {
    const rules = Array.from({ length: 230 }, (_, i) => block(`site${i}.com`, ['1']))
    const { planned } = planBrakes(rules, false)
    expect(planned.map(p => (p.params as { hostnames: string[] }).hostnames.length)).toEqual([100, 100, 30])
  })

  it('drops a hostname that is not plain, and reports variation pauses it cannot send', () => {
    const rules: KillAction[] = [
      block('http://bad/x', ['1']),
      { kind: 'pause_variation', rule: 'variation_zero_click', variationId: '9', campaignId: '1', reason: 'v9' },
      { kind: 'pause_campaign', rule: 'campaign_low_ctr', campaignId: '2', reason: 'low ctr' },
    ]
    const { planned, unsupported } = planBrakes(rules, false)
    expect(planned).toEqual([expect.objectContaining({ verb: 'pause', targetLevel: 'campaign', targetId: '2' })])
    expect(unsupported).toEqual([{ variationId: '9', campaignId: '1', reason: 'v9' }])
    expect(planBrakes(rules, true).planned.map(p => [p.targetLevel, p.targetId])).toEqual([['ad', '9'], ['campaign', '2']])
  })
})

describe('runExoclickBrakes', () => {
  const sites = [
    { site_hostname: 'rat.xxx', impressions: 2237, clicks: 0, cost: 2.87 },
    { site_hostname: 'good.com', impressions: 9000, clicks: 40, cost: 3 },
  ]

  it('defaults to a dry run: reads, plans, and dispatches nothing', async () => {
    const { client } = fakeClient({ siteRows: sites })
    const dispatch = vi.fn(noop)
    const r = await runExoclickBrakes({ campaignIds: ['1', '2'], now: NOW }, { client, dispatch, operatorEnabled: async () => false })
    expect(r).toMatchObject({ dryRun: true, operatorEnabled: false, balanceCents: 17234, read: { sites: 2 }, results: [] })
    expect(r.planned.map(p => [p.verb, p.targetId])).toEqual([['block_placement', '1'], ['block_placement', '2']])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('only an explicit dryRun false dispatches, as the brakes proposer', async () => {
    const { client } = fakeClient({ siteRows: sites })
    const dispatch = vi.fn(noop)
    const r = await runExoclickBrakes({ campaignIds: ['1', '2'], dryRun: false, now: NOW }, { client, dispatch, operatorEnabled: async () => true })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      verb: 'block_placement', proposedBy: BRAKES_PROPOSER,
      target: { platform: 'adult:exoclick', level: 'campaign', externalId: '1' }, params: { hostnames: ['rat.xxx'] },
    })
    expect(r.results).toHaveLength(2)
  })

  it('pauses a campaign that spent over $5 in an hour, and reads the window defaults', async () => {
    const { client, gets } = fakeClient({
      campaignStats: [{ idcampaign: 1, impressions: 1000, clicks: 5, cost: 1 }], hourCost: 5.5,
    })
    const r = await runExoclickBrakes({ campaignIds: ['1'], now: NOW }, { client, dispatch: noop, operatorEnabled: async () => true })
    expect(r.planned).toEqual([expect.objectContaining({ verb: 'pause', targetId: '1' })])
    expect(r.window).toEqual({ campaignIds: ['1'], dateFrom: '2026-11-01', dateTo: '2026-11-15' })
    const hour = gets.find(g => g.path === 'statistics/a/hour')!
    expect(hour.params).toMatchObject({ campaignid: ['1'], 'date-from': '2026-11-15', 'date-to': '2026-11-15' })
  })

  it('pages the site stats past the first page', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ site_hostname: `s${i}.com`, impressions: 10, clicks: 1, cost: 0.01 }))
    const { client, gets } = fakeClient({ siteRows: many })
    const r = await runExoclickBrakes({ campaignIds: ['1'], now: NOW }, { client, dispatch: noop, operatorEnabled: async () => true })
    expect(r.read.sites).toBe(1200)
    expect(gets.filter(g => g.path === 'statistics/a/site').map(g => g.params['offset'])).toEqual([0, 500, 1000])
  })

  it('passes arrivals through to the arrivals rule', async () => {
    const { client } = fakeClient({ campaignStats: [{ idcampaign: 1, impressions: 1000, clicks: 80, cost: 1 }] })
    const r = await runExoclickBrakes({ campaignIds: ['1'], now: NOW, arrivals: { '1': 10 } }, { client, dispatch: noop, operatorEnabled: async () => true })
    expect(r.rules).toEqual([expect.objectContaining({ rule: 'arrivals_shortfall' })])
    const skipped = await runExoclickBrakes({ campaignIds: ['1'], now: NOW, arrivals: null }, { client, dispatch: noop, operatorEnabled: async () => true })
    expect(skipped.rules).toEqual([])
  })
})
