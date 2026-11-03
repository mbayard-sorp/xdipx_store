import { afterEach, describe, expect, it, vi } from 'vitest'

// Same in-memory-db-stand-in idiom as email-metrics-pull.server.test.ts, but
// dispatched by table identity (the real drizzle table object each query
// names in `.from(...)`) rather than by projection shape, since two of this
// module's three queries are bare `.select()` with no projection to key off.
const mem = vi.hoisted(() => ({
  emailSendsRows: [] as Array<Record<string, unknown>>,
  metricsRows: [] as Array<Record<string, unknown>>,
  ledgerRows: [] as Array<Record<string, unknown>>,
  suggestionRows: [] as Array<Record<string, unknown>>,
  suggestionLinkRows: [] as Array<Record<string, unknown>>,
  pipelineSettingRows: [] as Array<Record<string, unknown>>,
  // Ticket #17445: records every `db.update(emailSends).set(values)` call so
  // approveEmailSend/requestEmailSendChanges tests can assert on it, and
  // applies the patch to the single matching emailSendsRows entry (every
  // test in this file keeps at most one row in play at a time) so a
  // following `getEmailAdminData`-shaped read sees the update too.
  updateCalls: [] as Array<{ values: Record<string, unknown> }>,
}))

vi.mock('./db.server', async () => {
  const schema = await import('../../db/schema')
  function chain(getRows: () => Array<Record<string, unknown>>) {
    const t: Record<string, unknown> = {
      innerJoin: () => t,
      where: () => t,
      orderBy: () => t,
      limit: () => t,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(getRows()).then(res, rej),
    }
    return t
  }
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          if (table === schema.emailSends) return chain(() => mem.emailSendsRows)
          if (table === schema.emailCampaignMetrics) return chain(() => mem.metricsRows)
          if (table === schema.homepageTeamEvents) return chain(() => mem.ledgerRows)
          if (table === schema.homepageTeamSuggestions) return chain(() => mem.suggestionRows)
          if (table === schema.suggestionLinks) return chain(() => mem.suggestionLinkRows)
          if (table === schema.pipelineSettings) return chain(() => mem.pipelineSettingRows)
          return chain(() => [])
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            mem.updateCalls.push({ values })
            if (table === schema.emailSends && mem.emailSendsRows.length === 1) {
              Object.assign(mem.emailSendsRows[0]!, values)
            }
            return Promise.resolve([])
          },
        }),
      }),
    },
  }
})

import { getEmailAdminData, approveEmailSend, requestEmailSendChanges } from './email-admin.server'

afterEach(() => {
  mem.emailSendsRows = []
  mem.metricsRows = []
  mem.ledgerRows = []
  mem.suggestionRows = []
  mem.suggestionLinkRows = []
  mem.pipelineSettingRows = []
  mem.updateCalls = []
})

describe('getEmailAdminData', () => {
  it('returns the fully joined shape: a drafted send with no metrics, a sent send with metrics and byBlock, and a ledger entry', async () => {
    mem.emailSendsRows = [
      {
        id: 1, campaignKey: 'daily-20261015', sendDate: '2026-10-15', subject: 'Tomorrow',
        audience: 'all', hypothesis: 'subject angle', status: 'drafted',
        klaviyoCampaignId: null, sentAt: null, createdAt: new Date('2026-10-14'),
      },
      {
        id: 2, campaignKey: 'daily-20261013', sendDate: '2026-10-13', subject: "Today's picks",
        audience: 'all', hypothesis: 'hero format', status: 'sent',
        klaviyoCampaignId: 'kv-123', sentAt: new Date('2026-10-13T13:30:00Z'), createdAt: new Date('2026-10-13'),
      },
    ]
    mem.metricsRows = [
      {
        campaignKey: 'daily-20261013', klaviyoCampaignId: 'kv-123', pulledAt: new Date('2026-10-14'),
        recipients: 1000, delivered: 980, opensUnique: 400, clicksUnique: 98, conversions: 10,
        conversionValue: '500.00', unsubscribes: 2, spamComplaints: 0, bounced: 20,
        attributedOrders: 8, attributedRevenue: '420.00',
        byBlock: { hero: { orders: 5, revenue: '300.00' }, deals: { orders: 3, revenue: '120.00' } },
      },
    ]
    mem.ledgerRows = [
      { id: 7, ts: new Date('2026-10-12'), summary: "Hero format 'single product' supported: 8 sends, 7200 recipients, +12% clicks." },
    ]

    const data = await getEmailAdminData()

    expect(data.upcoming).toHaveLength(1)
    expect(data.upcoming[0]).toMatchObject({ campaignKey: 'daily-20261015', status: 'drafted', metrics: null })

    expect(data.sent).toHaveLength(1)
    const sentRow = data.sent[0]!
    expect(sentRow.campaignKey).toBe('daily-20261013')
    expect(sentRow.metrics).not.toBeNull()
    expect(sentRow.metrics!.recipients).toBe(1000)
    expect(sentRow.metrics!.clicksUnique).toBe(98)
    expect(sentRow.metrics!.clickRate).toBeCloseTo(98 / 980)
    expect(sentRow.metrics!.attributedOrders).toBe(8)
    expect(sentRow.metrics!.attributedRevenue).toBe('420.00')
    expect(sentRow.metrics!.byBlock).toEqual({
      hero: { orders: 5, revenue: '300.00' },
      deals: { orders: 3, revenue: '120.00' },
    })

    expect(data.ledger).toHaveLength(1)
    expect(data.ledger[0]).toMatchObject({ id: 7, summary: expect.stringContaining('Hero format') })
  })

  it('keeps only the latest metrics pull per campaign_key (append-only history)', async () => {
    mem.emailSendsRows = [{
      id: 3, campaignKey: 'daily-20261010', sendDate: '2026-10-10', subject: 'x',
      audience: 'all', hypothesis: null, status: 'sent', klaviyoCampaignId: 'kv-1',
      sentAt: new Date('2026-10-10'), createdAt: new Date('2026-10-10'),
    }]
    // Ordered newest-first, the same as the real `orderBy(desc(pulledAt))` query.
    mem.metricsRows = [
      {
        campaignKey: 'daily-20261010', klaviyoCampaignId: 'kv-1', pulledAt: new Date('2026-10-12'),
        recipients: 1000, delivered: 1000, opensUnique: 400, clicksUnique: 120, conversions: 12,
        conversionValue: '600.00', unsubscribes: 1, spamComplaints: 0, bounced: 0,
        attributedOrders: 10, attributedRevenue: '500.00', byBlock: null,
      },
      {
        campaignKey: 'daily-20261010', klaviyoCampaignId: 'kv-1', pulledAt: new Date('2026-10-11'),
        recipients: 1000, delivered: 1000, opensUnique: 300, clicksUnique: 80, conversions: 6,
        conversionValue: '300.00', unsubscribes: 0, spamComplaints: 0, bounced: 0,
        attributedOrders: 5, attributedRevenue: '250.00', byBlock: null,
      },
    ]

    const data = await getEmailAdminData()
    expect(data.sent[0]!.metrics!.clicksUnique).toBe(120)
    expect(data.sent[0]!.metrics!.attributedOrders).toBe(10)
  })

  it('marks an approved campaign brief already drafted when its note links a Klaviyo campaign edit URL, and reports the push valve', async () => {
    mem.suggestionRows = [
      { id: 42, suggestion: 'Subject: Wand week\nSegment: waitlist', createdAt: new Date('2026-10-20') },
      { id: 43, suggestion: 'Subject: Air pulsation\nSegment: waitlist', createdAt: new Date('2026-10-21') },
    ]
    mem.suggestionLinkRows = [
      { suggestionId: 42, ref: 'Klaviyo draft campaign created: https://www.klaviyo.com/campaign/abc/edit' },
    ]
    mem.pipelineSettingRows = [{ value: 'true' }]

    const data = await getEmailAdminData()

    expect(data.campaignPushValveOn).toBe(true)
    expect(data.pendingCampaigns).toHaveLength(2)
    expect(data.pendingCampaigns.find(r => r.id === 42)).toMatchObject({ alreadyDrafted: true })
    expect(data.pendingCampaigns.find(r => r.id === 43)).toMatchObject({ alreadyDrafted: false })
  })

  it('renders with an empty ledger and no sends at all', async () => {
    const data = await getEmailAdminData()
    expect(data).toEqual({
      upcoming: [], sent: [], ledger: [],
      pendingCampaigns: [], campaignPushValveOn: false,
    })
  })

  it('re-renders a drafted row\'s stored blocks into an HTML preview (ticket #17445), and carries its review state through', async () => {
    mem.emailSendsRows = [{
      id: 9, campaignKey: 'daily-20261105', sendDate: '2026-11-05', subject: 'Night in',
      audience: 'all', hypothesis: null, status: 'drafted', klaviyoCampaignId: null, sentAt: null,
      createdAt: new Date('2026-11-04'),
      reviewStatus: 'changes_requested',
      reviewNotes: [{ at: '2026-11-04T10:00:00.000Z', note: 'swap the hero product' }],
      blocks: [{ kind: 'emmaNote', note: 'Start slow.' }],
    }]

    const data = await getEmailAdminData()
    const row = data.upcoming[0]!
    expect(row.reviewStatus).toBe('changes_requested')
    expect(row.reviewNotes).toEqual([{ at: '2026-11-04T10:00:00.000Z', note: 'swap the hero product' }])
    expect(row.previewHtml).toContain('Start slow.')
  })

  it('shows no preview for a row with no stored blocks, rather than throwing', async () => {
    mem.emailSendsRows = [{
      id: 10, campaignKey: 'daily-20261001', sendDate: '2026-10-01', subject: 'Old draft',
      audience: 'all', hypothesis: null, status: 'drafted', klaviyoCampaignId: null, sentAt: null,
      createdAt: new Date('2026-10-01'), reviewStatus: 'pending_review', reviewNotes: [], blocks: null,
    }]
    const data = await getEmailAdminData()
    expect(data.upcoming[0]!.previewHtml).toBeNull()
  })
})

describe('approveEmailSend (ticket #17445)', () => {
  it('marks a row already drafted in Klaviyo approved without pushing again', async () => {
    mem.emailSendsRows = [{
      id: 1, campaignKey: 'daily-20261105', sendDate: '2026-11-05', subject: 'x', audience: 'all',
      klaviyoCampaignId: 'kv-already', reviewStatus: 'pending_review', reviewNotes: [], blocks: null,
    }]
    const result = await approveEmailSend(1, 'mike@xdipx.com')
    expect(result).toMatchObject({ ok: true, klaviyoCampaignId: 'kv-already', pushedNow: false })
    expect(mem.updateCalls[0]!.values).toMatchObject({ reviewStatus: 'approved', approvedBy: 'mike@xdipx.com' })
  })

  it('pushes a Klaviyo draft from stored blocks and records the campaign id when the valve is on', async () => {
    mem.emailSendsRows = [{
      id: 2, campaignKey: 'daily-20261106', sendDate: '2026-11-06', subject: 'Featured brand', audience: 'list-1',
      previewText: null, klaviyoCampaignId: null, reviewStatus: 'pending_review', reviewNotes: [],
      blocks: [{ kind: 'emmaNote', note: 'Start slow.' }],
    }]
    const pushCampaign = vi.fn().mockResolvedValue({ pushed: true, reason: 'ok', campaignId: 'kv-new', templateId: 'tpl-1' })
    const result = await approveEmailSend(2, 'mike@xdipx.com', { pushCampaign, pushDeps: {} as never })
    expect(result).toMatchObject({ ok: true, klaviyoCampaignId: 'kv-new', pushedNow: true })
    expect(pushCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ dateKey: '2026-11-06', subject: 'Featured brand', listId: 'list-1' }),
      {},
    )
    expect(mem.updateCalls[0]!.values).toMatchObject({
      reviewStatus: 'approved', approvedBy: 'mike@xdipx.com', klaviyoCampaignId: 'kv-new', klaviyoTemplateId: 'tpl-1',
    })
  })

  it('approves with a clear valve-off message and no campaign id when the push valve is off', async () => {
    mem.emailSendsRows = [{
      id: 3, campaignKey: 'daily-20261107', sendDate: '2026-11-07', subject: 'x', audience: 'list-1',
      previewText: null, klaviyoCampaignId: null, reviewStatus: 'pending_review', reviewNotes: [],
      blocks: [{ kind: 'emmaNote', note: 'Start slow.' }],
    }]
    const pushCampaign = vi.fn().mockResolvedValue({ pushed: false, reason: 'valve-off' })
    const result = await approveEmailSend(3, 'mike@xdipx.com', { pushCampaign, pushDeps: {} as never })
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ klaviyoCampaignId: null, pushedNow: false })
    if (result.ok) expect(result.message).toMatch(/email_campaign_push_enabled is off/)
    expect(mem.updateCalls[0]!.values).toMatchObject({ reviewStatus: 'approved' })
  })

  it('approves a row with no stored blocks with a clear message instead of attempting to push', async () => {
    mem.emailSendsRows = [{
      id: 4, campaignKey: 'daily-20260901', sendDate: '2026-09-01', subject: 'x', audience: 'list-1',
      klaviyoCampaignId: null, reviewStatus: 'pending_review', reviewNotes: [], blocks: null,
    }]
    const result = await approveEmailSend(4, 'mike@xdipx.com')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message).toMatch(/no stored content to push/)
  })

  it('returns ok:false for a row that does not exist', async () => {
    const result = await approveEmailSend(999, 'mike@xdipx.com')
    expect(result).toEqual({ ok: false, error: 'email_sends row 999 not found' })
  })
})

describe('requestEmailSendChanges (ticket #17445)', () => {
  it('moves the row to changes_requested and appends the note to the existing array', async () => {
    mem.emailSendsRows = [{
      id: 5, campaignKey: 'daily-20261108', reviewStatus: 'pending_review',
      reviewNotes: [{ at: '2026-11-01T00:00:00.000Z', note: 'earlier note' }],
    }]
    const result = await requestEmailSendChanges(5, 'swap the hero product')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.reviewNotes).toHaveLength(2)
      expect(result.reviewNotes[1]!.note).toBe('swap the hero product')
    }
    expect(mem.updateCalls[0]!.values).toMatchObject({ reviewStatus: 'changes_requested' })
  })

  it('refuses an empty note', async () => {
    mem.emailSendsRows = [{ id: 6, campaignKey: 'daily-20261109', reviewStatus: 'pending_review', reviewNotes: [] }]
    const result = await requestEmailSendChanges(6, '   ')
    expect(result).toEqual({ ok: false, error: 'note is required' })
    expect(mem.updateCalls).toHaveLength(0)
  })

  it('returns ok:false for a row that does not exist', async () => {
    const result = await requestEmailSendChanges(999, 'a note')
    expect(result).toEqual({ ok: false, error: 'email_sends row 999 not found' })
  })
})
