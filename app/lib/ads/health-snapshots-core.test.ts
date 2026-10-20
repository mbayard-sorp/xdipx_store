import { describe, expect, it } from 'vitest'

import {
  EMQ_FLOOR, SnapshotValidationError, accountProblem, assembleSignalHealth, flagActivities, latestPerDimension,
  latestPerKind, leadGap, parseLatestInput, parseRecordInput, readAccount, readActivityRows, readAnomalies,
  readErrors, readOpportunity, readPixel, sliceFloor, snapshotAge, summarizeBreakdown,
  type BreakdownRow, type SnapshotRow,
} from './health-snapshots-core'

const NOW = new Date('2026-10-20T12:00:00Z')

function snap(kind: SnapshotRow['kind'], observedAt: string, payload: Record<string, unknown> = {}, channel = 'meta'): SnapshotRow {
  return { id: Math.floor(Math.random() * 1e6), channel, kind, observedAt, payload, source: 'routine', createdAt: observedAt }
}

describe('parseRecordInput', () => {
  const ok = { channel: 'meta', kind: 'pixel', observedAt: '2026-10-20T11:00:00Z', payload: { events: [] } }

  it('accepts the documented contract and defaults source to routine', () => {
    const r = parseRecordInput(ok, NOW)
    expect(r).toMatchObject({ channel: 'meta', kind: 'pixel', source: 'routine', payload: { events: [] } })
    expect(r.observedAt.toISOString()).toBe('2026-10-20T11:00:00.000Z')
    expect(parseRecordInput({ ...ok, source: 'mcp' }, NOW).source).toBe('mcp')
  })

  it('accepts every documented kind', () => {
    for (const kind of ['pixel', 'errors', 'activity', 'opportunity', 'anomaly', 'breakdown']) {
      expect(parseRecordInput({ ...ok, kind }, NOW).kind).toBe(kind)
    }
  })

  it.each([
    [{ ...ok, channel: 'Meta Ads' }, /channel/],
    [{ ...ok, kind: 'vibes' }, /kind must be one of/],
    [{ ...ok, observedAt: 'yesterday' }, /observedAt/],
    [{ ...ok, observedAt: '2026-10-21T12:00:00Z' }, /future/],
    [{ ...ok, payload: [1, 2] }, /payload must be a JSON object/],
    [{ ...ok, payload: 'x' }, /payload must be a JSON object/],
    [{ ...ok, payload: { big: 'x'.repeat(210_000) } }, /limit/],
    [{ ...ok, source: 'Has Spaces' }, /source/],
  ])('refuses %#', (body, msg) => {
    expect(() => parseRecordInput(body as Record<string, unknown>, NOW)).toThrow(SnapshotValidationError)
    expect(() => parseRecordInput(body as Record<string, unknown>, NOW)).toThrow(msg)
  })

  it('parseLatestInput takes an optional channel', () => {
    expect(parseLatestInput({})).toEqual({ channel: null })
    expect(parseLatestInput({ channel: 'meta' })).toEqual({ channel: 'meta' })
    expect(() => parseLatestInput({ channel: 'META!' })).toThrow(SnapshotValidationError)
  })
})

describe('latest readers', () => {
  it('keeps the newest row per channel and kind', () => {
    const rows = [
      snap('pixel', '2026-10-19T09:00:00Z'),
      snap('pixel', '2026-10-20T09:00:00Z', { newest: true }),
      snap('errors', '2026-10-18T09:00:00Z'),
      snap('pixel', '2026-10-17T09:00:00Z', {}, 'microsoft'),
    ]
    const out = latestPerKind(rows)
    expect(out.map(r => `${r.channel}:${r.kind}`)).toEqual(['meta:errors', 'meta:pixel', 'microsoft:pixel'])
    expect(out.find(r => r.kind === 'pixel' && r.channel === 'meta')?.payload).toEqual({ newest: true })
  })

  it('keeps the newest breakdown per dimension, in placement, age, gender order', () => {
    const rows = [
      snap('breakdown', '2026-10-12T09:00:00Z', { dimension: 'gender', old: true }),
      snap('breakdown', '2026-10-19T09:00:00Z', { dimension: 'gender' }),
      snap('breakdown', '2026-10-19T09:00:00Z', { dimension: 'age' }),
      snap('breakdown', '2026-10-19T09:00:00Z', { dimension: 'placement' }),
      snap('pixel', '2026-10-19T09:00:00Z', { dimension: 'placement' }),
    ]
    const out = latestPerDimension(rows)
    expect(out.map(r => r.payload['dimension'])).toEqual(['placement', 'age', 'gender'])
    expect(out.some(r => r.payload['old'])).toBe(false)
  })

  it('snapshotAge marks a stale reading per kind', () => {
    expect(snapshotAge(snap('pixel', '2026-10-20T10:00:00Z'), NOW)).toMatchObject({ age: '2 hours ago', stale: false })
    expect(snapshotAge(snap('pixel', '2026-10-18T10:00:00Z'), NOW).stale).toBe(true)
    expect(snapshotAge(snap('account', '2026-10-20T08:00:00Z'), NOW).stale).toBe(true)
    expect(snapshotAge(snap('breakdown', '2026-10-14T09:00:00Z'), NOW).stale).toBe(false)
  })
})

describe('payload readers', () => {
  it('reads pixel events under the recommended and the MCP spellings', () => {
    expect(readPixel({ events: [{ event: 'Lead', emq: 4.2, count24h: 1, count7d: 3 }] })).toEqual({
      datasetId: null, events: [{ event: 'Lead', emq: 4.2, count24h: 1, count7d: 3 }], leadEvents24h: 1, leadEvents7d: 3,
    })
    const mcp = readPixel({ dataset_id: '1619122322498289', event_stats: [{ event_name: 'PageView', event_match_quality: '3.1' }] })
    expect(mcp.datasetId).toBe('1619122322498289')
    expect(mcp.events).toEqual([{ event: 'PageView', emq: 3.1, count24h: null, count7d: null }])
    expect(mcp.leadEvents24h).toBeNull()
    expect(readPixel({ emq: { Lead: 4.4, Purchase: 7 }, lead_events_7d: 1 }).events.map(e => e.event)).toEqual(['Lead', 'Purchase'])
  })

  it('reads errors, opportunity and anomalies leniently', () => {
    expect(readErrors({ errors: [{ object_type: 'ad', object_id: '9', error_message: 'Rejected' }] })[0])
      .toMatchObject({ level: 'ad', id: '9', message: 'Rejected' })
    expect(readOpportunity({ opportunity_score: 62, recommendations: [{ type: 'Use Advantage+ placements', description: 'More reach' }] }))
      .toEqual({ score: 62, recommendations: [{ title: 'Use Advantage+ placements', detail: 'More reach', impact: null }] })
    expect(readAnomalies({ signals: [{ metric_name: 'cpm', trend: 'up', summary: 'CPM up 80%' }] })[0])
      .toMatchObject({ metric: 'cpm', direction: 'up', message: 'CPM up 80%' })
    expect(readErrors({})).toEqual([])
  })
})

describe('account status', () => {
  it('ACTIVE is no problem; an unknown status is not a page either', () => {
    expect(accountProblem(readAccount({ accountStatus: 1, disableReason: 0 }))).toBeNull()
    expect(accountProblem(readAccount({ account_status: 201 }))).toBeNull()
    expect(accountProblem(readAccount({}))).toBeNull()
  })

  it('a payment failure and a disable both read as problems with their names', () => {
    const unsettled = accountProblem(readAccount({ accountStatus: 3, disableReason: 0 }))
    expect(unsettled?.title).toBe('Meta ad account is UNSETTLED')
    expect(unsettled?.sentence).toMatch(/payment failed/)
    const disabled = accountProblem(readAccount({ account_status: '2', disable_reason: '3' }))
    expect(disabled?.title).toBe('Meta ad account is DISABLED (RISK_PAYMENT)')
    expect(disabled?.sentence).toMatch(/Disable reason: RISK_PAYMENT/)
    expect(accountProblem(readAccount({ accountStatus: 9 }))?.sentence).toMatch(/grace period/)
  })
})

describe('flagActivities', () => {
  const raw = readActivityRows([
    { event_time: '2026-10-20T10:00:00+0000', actor_id: '111', actor_name: 'xdipx system user', object_id: 'c1', event_type: 'update_campaign_run_status' },
    { event_time: '2026-10-20T10:05:00+0000', actor_id: '222', actor_name: 'Mike', object_id: 'a7', event_type: 'update_ad_run_status' },
    { event_time: '2026-10-20T10:10:00+0000', actor_id: '333', actor_name: 'Shopify', application_name: 'Shopify', object_id: 'c9', event_type: 'create_campaign_group' },
    { event_time: '2026-10-20T11:00:00+0000', actor_id: '222', actor_name: 'Mike', object_id: 'c2', event_type: 'update_campaign_budget' },
  ])

  it('our system user and a nearby ledger row are ours; everything else is out of band', () => {
    const out = flagActivities(raw, {
      systemUserIds: ['111'],
      ledger: [{ id: 41, externalId: 'a7', appliedAt: '2026-10-20T10:04:00Z' }, { id: 42, externalId: 'c2', appliedAt: '2026-10-20T09:00:00Z' }],
    })
    expect(out.map(o => o.outOfBand)).toEqual([false, false, true, true])
    expect(out[0]!.why).toBe('our system user')
    expect(out[1]!.why).toBe('ledger row 41')
    expect(out[2]!.why).toBe('made by Shopify via Shopify, not the control plane')
  })

  it('with no system user known, nothing is waved through on the actor', () => {
    expect(flagActivities(raw, { systemUserIds: [], ledger: [] }).every(o => o.outOfBand)).toBe(true)
  })
})

describe('breakdown floor', () => {
  const row = (slice: string, spendCents: number, leads: number, adsetId = 's1'): BreakdownRow =>
    ({ adsetId, adsetName: null, slice, spendCents, impressions: 0, linkClicks: 0, leads })

  it('sums slices across ad sets and sorts by spend', () => {
    const s = summarizeBreakdown([row('female', 1000, 1, 's1'), row('female', 500, 1, 's2'), row('male', 3000, 0)])
    expect(s.totalSpendCents).toBe(4500)
    expect(s.slices.map(x => [x.slice, x.spendCents, x.leads])).toEqual([['male', 3000, 0], ['female', 1500, 2]])
    expect(s.slices[0]!.cplCents).toBeNull()
    expect(s.slices[1]!.share).toBeCloseTo(1 / 3)
  })

  it('marks only a slice past all three floors', () => {
    // instagram: 50% of spend, 10 leads at $10; rest: 20 leads at $2.50. 4x the rest.
    const s = summarizeBreakdown([row('instagram / feed', 10_000, 10), row('facebook / feed', 5_000, 10), row('facebook / reels', 5_000, 10)])
    const ig = s.slices.find(x => x.slice === 'instagram / feed')!
    expect(ig.meetsFloor).toBe(true)
    expect(ig.restCplCents).toBe(500)
    expect(ig.floorNote).toMatch(/2\.0x the rest/)
    expect(s.slices.filter(x => x.meetsFloor)).toHaveLength(1)
  })

  it.each([
    [{ share: 0.2, leads: 50, restLeads: 50, cplCents: 2000, restCplCents: 100 }, /under 25% of spend/],
    [{ share: 0.5, leads: 9, restLeads: 50, cplCents: 2000, restCplCents: 100 }, /under 10 leads/],
    [{ share: 0.5, leads: 20, restLeads: 9, cplCents: 2000, restCplCents: 100 }, /the rest has under 10 leads/],
    [{ share: 0.5, leads: 20, restLeads: 20, cplCents: 199, restCplCents: 100 }, /CPL under 2x/],
  ])('below floor %#', (input, note) => {
    const f = sliceFloor(input)
    expect(f.meetsFloor).toBe(false)
    expect(f.floorNote).toMatch(note)
  })

  it('exactly 25% share and exactly 2x CPL clear the floor', () => {
    expect(sliceFloor({ share: 0.25, leads: 10, restLeads: 10, cplCents: 200, restCplCents: 100 }).meetsFloor).toBe(true)
  })
})

describe('assembleSignalHealth', () => {
  it('is empty with no pixel snapshot', () => {
    expect(assembleSignalHealth({ pixel: null, ourLeads24h: 3, ourLeads7d: 9, attributedLeads7d: 0, now: NOW }))
      .toMatchObject({ state: 'empty', leads: [], snapshot: null })
  })

  it('goes red on a lead gap over 20% and on EMQ under 6', () => {
    const pixel = snap('pixel', '2026-10-20T09:00:00Z', { events: [{ event: 'Lead', emq: 4.4, count24h: 1, count7d: 1 }, { event: 'PageView', emq: 7 }] })
    const h = assembleSignalHealth({ pixel, ourLeads24h: 1, ourLeads7d: 6, attributedLeads7d: 0, now: NOW })
    expect(h.state).toBe('red')
    expect(h.leads).toEqual([
      { window: '24h', meta: 1, ours: 1, gap: 0 },
      { window: '7d', meta: 1, ours: 6, gap: 5 / 6 },
    ])
    expect(h.reasons.join(' ')).toMatch(/Meta saw 1 Lead events in 7d; our database stored 6 leads/)
    expect(h.reasons.join(' ')).toMatch(new RegExp(`Lead match quality is 4.4, under ${EMQ_FLOOR}`))
    expect(h.reasons.join(' ')).not.toMatch(/PageView/)
  })

  it('is ok when counts agree and EMQ holds, amber when the reading is stale', () => {
    const fresh = snap('pixel', '2026-10-20T09:00:00Z', { events: [{ event: 'Lead', emq: 7.5, count24h: 10, count7d: 50 }] })
    expect(assembleSignalHealth({ pixel: fresh, ourLeads24h: 9, ourLeads7d: 48, attributedLeads7d: 5, now: NOW }).state).toBe('ok')
    const old = { ...fresh, observedAt: '2026-10-17T09:00:00Z' }
    const h = assembleSignalHealth({ pixel: old, ourLeads24h: 9, ourLeads7d: 48, attributedLeads7d: 5, now: NOW })
    expect(h.state).toBe('amber')
    expect(h.reasons[0]).toMatch(/old/)
  })

  it('leadGap is null without a Meta count or with nothing on either side', () => {
    expect(leadGap(null, 4)).toBeNull()
    expect(leadGap(0, 0)).toBeNull()
    expect(leadGap(8, 10)).toBeCloseTo(0.2)
  })
})
