/**
 * createMetaSignalReads (ticket #16686): the GET-only Graph reads behind the
 * Signals and Breakdowns tabs. The Graph client is a fake that records every
 * call, so the test pins paths, fields and params.
 */
import { describe, expect, it, vi } from 'vitest'

import { createMetaSignalReads, normalizeMetaAccount, normalizeMetaBreakdownRow } from './adapter.server'
import type { GraphClient, GraphJson, GraphParams } from './graph.server'

const CREDS = () => ({ token: 'tok', accountId: 'act_920738511029316', pageId: null })

function fakeGraph(answers: { get?: (path: string, p?: GraphParams) => GraphJson; getAll?: (path: string, p?: GraphParams) => GraphJson[] }) {
  const graph: GraphClient = {
    get: vi.fn(async (path: string, p?: GraphParams) => (answers.get ? answers.get(path, p) : {})),
    post: vi.fn(async () => { throw new Error('signal reads must never POST') }),
    getAll: vi.fn(async (path: string, p?: GraphParams) => (answers.getAll ? answers.getAll(path, p) : [])),
  }
  return graph
}

describe('Meta signal reads', () => {
  it('configured() needs both the token and the account id', () => {
    expect(createMetaSignalReads({ credentials: CREDS, graph: fakeGraph({}) }).configured()).toBe(true)
    expect(createMetaSignalReads({ credentials: () => ({ ...CREDS(), token: null }), graph: fakeGraph({}) }).configured()).toBe(false)
    expect(createMetaSignalReads({ credentials: () => ({ ...CREDS(), accountId: null }), graph: fakeGraph({}) }).configured()).toBe(false)
  })

  it('reads account_status and disable_reason off the ad account', async () => {
    const graph = fakeGraph({
      get: () => ({ id: 'act_920738511029316', name: 'xdipx', account_status: 3, disable_reason: 0, currency: 'USD', amount_spent: '359', spend_cap: '0', balance: '1200' }),
    })
    const a = await createMetaSignalReads({ credentials: CREDS, graph }).account()
    expect(graph.get).toHaveBeenCalledWith('act_920738511029316', { fields: expect.stringContaining('account_status,disable_reason') })
    expect(a).toEqual({
      accountId: 'act_920738511029316', name: 'xdipx', accountStatus: 3, disableReason: 0, currency: 'USD',
      amountSpentCents: 359, spendCapCents: 0, balanceCents: 1200,
    })
  })

  it('reads the activity edge with a unix window and drops rows outside it', async () => {
    const since = new Date('2026-10-19T12:00:00Z')
    const until = new Date('2026-10-20T12:00:00Z')
    const graph = fakeGraph({
      getAll: () => [
        { event_time: '2026-10-20T10:00:00+0000', actor_id: '1', object_id: 'c1' },
        { event_time: '2026-10-18T10:00:00+0000', actor_id: '1', object_id: 'c1' },
      ],
    })
    const rows = await createMetaSignalReads({ credentials: CREDS, graph }).activities(since, until)
    expect(rows).toHaveLength(1)
    const [path, params] = (graph.getAll as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(path).toBe('act_920738511029316/activities')
    expect(params).toMatchObject({ since: since.getTime() / 1000, until: until.getTime() / 1000 })
    expect(String(params.fields)).toContain('actor_id')
    expect(String(params.fields)).toContain('translated_event_type')
  })

  it('pulls ad-set insights with the breakdowns and counts leads once', async () => {
    const graph = fakeGraph({
      getAll: () => [{
        adset_id: 's1', adset_name: 'US 25-54', publisher_platform: 'instagram', platform_position: 'feed',
        spend: '3.59', impressions: '900', inline_link_clicks: '12',
        actions: [{ action_type: 'lead', value: '2' }, { action_type: 'onsite_conversion.lead_grouped', value: '2' }],
      }],
    })
    const rows = await createMetaSignalReads({ credentials: CREDS, graph })
      .breakdown({ since: '2026-10-13', until: '2026-10-19' }, ['publisher_platform', 'platform_position'])
    expect(graph.getAll).toHaveBeenCalledWith('act_920738511029316/insights', expect.objectContaining({
      level: 'adset', breakdowns: 'publisher_platform,platform_position', time_range: { since: '2026-10-13', until: '2026-10-19' },
    }))
    expect(rows).toEqual([{ adsetId: 's1', adsetName: 'US 25-54', slice: 'instagram / feed', spendCents: 359, impressions: 900, linkClicks: 12, leads: 2 }])
  })

  it('whoAmI returns null when Meta will not say', async () => {
    const graph = fakeGraph({ get: () => { throw new Error('nope') } })
    expect(await createMetaSignalReads({ credentials: CREDS, graph }).whoAmI()).toBeNull()
  })

  it('normalizers tolerate missing fields', () => {
    expect(normalizeMetaAccount('act_1', {})).toMatchObject({ accountStatus: null, disableReason: null, amountSpentCents: null })
    expect(normalizeMetaBreakdownRow({ gender: 'female' }, ['gender'])).toMatchObject({ slice: 'female', spendCents: 0, leads: 0 })
    expect(normalizeMetaBreakdownRow({}, ['age'])).toMatchObject({ slice: 'unknown' })
  })
})
