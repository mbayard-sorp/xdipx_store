/**
 * Ticket #15005. Read path for `/admin/email`: joins `email_sends` with each
 * campaign's latest `email_campaign_metrics` pull (append-only, migration
 * 121 — `orderAttributionForCampaign` in `email-metrics-pull.server.ts` is
 * what writes `byBlock`, keyed by `utm_content`, orders+revenue only; there
 * is no per-click or per-product breakdown in the real data yet, so this
 * reads exactly that shape rather than inventing one) and the email team's
 * `decision` events (the learning ledger `.claude/agents/email-analyst.md`
 * writes once a hypothesis clears its confidence bar).
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from './db.server'
import { emailCampaignMetrics, emailSends, homepageTeamEvents, homepageTeamRuns } from '../../db/schema'

export interface EmailSendMetrics {
  recipients: number | null
  delivered: number | null
  opensUnique: number | null
  clicksUnique: number | null
  /** `clicksUnique / delivered`, or null when either side is unknown. */
  clickRate: number | null
  conversions: number | null
  conversionValue: string | null
  unsubscribes: number | null
  spamComplaints: number | null
  bounced: number | null
  attributedOrders: number | null
  attributedRevenue: string | null
  byBlock: Record<string, { orders: number; revenue: string }> | null
  pulledAt: string
}

export interface EmailSendRow {
  id: number
  campaignKey: string
  sendDate: string | null
  subject: string | null
  audience: string | null
  hypothesis: string | null
  status: string
  klaviyoCampaignId: string | null
  sentAt: string | null
  metrics: EmailSendMetrics | null
}

export interface EmailLedgerEntry {
  id: number
  ts: string
  summary: string
}

export interface EmailAdminData {
  upcoming: EmailSendRow[]
  sent: EmailSendRow[]
  ledger: EmailLedgerEntry[]
}

function isPlainByBlock(value: unknown): value is Record<string, { orders: number; revenue: string }> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function getEmailAdminData(): Promise<EmailAdminData> {
  const [sends, metricsRows, ledgerRows] = await Promise.all([
    db.select().from(emailSends).orderBy(desc(emailSends.createdAt)).limit(60),
    db.select().from(emailCampaignMetrics).orderBy(desc(emailCampaignMetrics.pulledAt)),
    db
      .select({ id: homepageTeamEvents.id, ts: homepageTeamEvents.ts, summary: homepageTeamEvents.summary })
      .from(homepageTeamEvents)
      .innerJoin(homepageTeamRuns, eq(homepageTeamEvents.runId, homepageTeamRuns.id))
      .where(and(eq(homepageTeamRuns.team, 'email'), eq(homepageTeamEvents.eventType, 'decision')))
      .orderBy(desc(homepageTeamEvents.ts))
      .limit(30),
  ])

  // Append-only metrics, newest pull first: keep the first (latest) row seen
  // per campaign_key.
  const latestMetricsByKey = new Map<string, (typeof metricsRows)[number]>()
  for (const m of metricsRows) {
    if (!latestMetricsByKey.has(m.campaignKey)) latestMetricsByKey.set(m.campaignKey, m)
  }

  const rows: EmailSendRow[] = sends.map(s => {
    const m = latestMetricsByKey.get(s.campaignKey) ?? null
    return {
      id: s.id,
      campaignKey: s.campaignKey,
      sendDate: s.sendDate,
      subject: s.subject,
      audience: s.audience,
      hypothesis: s.hypothesis,
      status: s.status,
      klaviyoCampaignId: s.klaviyoCampaignId,
      sentAt: s.sentAt ? s.sentAt.toISOString() : null,
      metrics: m ? {
        recipients:        m.recipients,
        delivered:         m.delivered,
        opensUnique:       m.opensUnique,
        clicksUnique:      m.clicksUnique,
        clickRate:         m.delivered && m.delivered > 0 && m.clicksUnique != null ? m.clicksUnique / m.delivered : null,
        conversions:       m.conversions,
        conversionValue:   m.conversionValue,
        unsubscribes:      m.unsubscribes,
        spamComplaints:    m.spamComplaints,
        bounced:           m.bounced,
        attributedOrders:  m.attributedOrders,
        attributedRevenue: m.attributedRevenue,
        byBlock:           isPlainByBlock(m.byBlock) ? m.byBlock : null,
        pulledAt:          m.pulledAt.toISOString(),
      } : null,
    }
  })

  return {
    upcoming: rows.filter(r => r.status === 'drafted'),
    sent:     rows.filter(r => r.status === 'sent'),
    ledger:   ledgerRows.map(r => ({ id: r.id, ts: r.ts.toISOString(), summary: r.summary })),
  }
}
