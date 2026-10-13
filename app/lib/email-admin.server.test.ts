import { afterEach, describe, expect, it, vi } from 'vitest'

// Same in-memory-db-stand-in idiom as email-metrics-pull.server.test.ts, but
// dispatched by table identity (the real drizzle table object each query
// names in `.from(...)`) rather than by projection shape, since two of this
// module's three queries are bare `.select()` with no projection to key off.
const mem = vi.hoisted(() => ({
  emailSendsRows: [] as Array<Record<string, unknown>>,
  metricsRows: [] as Array<Record<string, unknown>>,
  ledgerRows: [] as Array<Record<string, unknown>>,
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
          return chain(() => [])
        },
      }),
    },
  }
})

import { getEmailAdminData } from './email-admin.server'

afterEach(() => {
  mem.emailSendsRows = []
  mem.metricsRows = []
  mem.ledgerRows = []
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

  it('renders with an empty ledger and no sends at all', async () => {
    const data = await getEmailAdminData()
    expect(data).toEqual({ upcoming: [], sent: [], ledger: [] })
  })
})
