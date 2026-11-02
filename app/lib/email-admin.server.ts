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
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from './db.server'
import { emailCampaignMetrics, emailSends, homepageTeamEvents, homepageTeamRuns, suggestionLinks } from '../../db/schema'
import { listSuggestions } from './team.server'
import { getPipelineSetting } from './feed-processor.server'
import { EMAIL_CAMPAIGN_PUSH_VALVE } from './klaviyo-campaigns.server'

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

/** An approved `kind:'campaign'` brief from the improvement bus, not yet drafted in Klaviyo. */
export interface PendingCampaignRow {
  id: number
  suggestion: string
  createdAt: string
  /** True when a Klaviyo draft note already links this row (ticket #15226's push script marker). */
  alreadyDrafted: boolean
}

export interface EmailAdminData {
  upcoming: EmailSendRow[]
  sent: EmailSendRow[]
  ledger: EmailLedgerEntry[]
  pendingCampaigns: PendingCampaignRow[]
  /** `email_campaign_push_enabled`. The push action is valve-gated regardless; this is just for the UI banner. */
  campaignPushValveOn: boolean
}

function isPlainByBlock(value: unknown): value is Record<string, { orders: number; revenue: string }> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Same marker `scripts/push-approved-campaigns.ts` checks: a 'note' link whose ref names a Klaviyo campaign edit URL. */
const DRAFT_NOTE_MARKER = 'klaviyo.com/campaign'

async function alreadyDraftedCampaignIds(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const links = await db
    .select({ suggestionId: suggestionLinks.suggestionId, ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(inArray(suggestionLinks.suggestionId, ids), eq(suggestionLinks.kind, 'note')))
  const drafted = new Set<number>()
  for (const l of links) {
    if ((l.ref ?? '').includes(DRAFT_NOTE_MARKER)) drafted.add(l.suggestionId)
  }
  return drafted
}

export async function getEmailAdminData(): Promise<EmailAdminData> {
  const [sends, metricsRows, ledgerRows, approvedCampaigns, campaignPushSetting] = await Promise.all([
    db.select().from(emailSends).orderBy(desc(emailSends.createdAt)).limit(60),
    db.select().from(emailCampaignMetrics).orderBy(desc(emailCampaignMetrics.pulledAt)),
    db
      .select({ id: homepageTeamEvents.id, ts: homepageTeamEvents.ts, summary: homepageTeamEvents.summary })
      .from(homepageTeamEvents)
      .innerJoin(homepageTeamRuns, eq(homepageTeamEvents.runId, homepageTeamRuns.id))
      .where(and(eq(homepageTeamRuns.team, 'email'), eq(homepageTeamEvents.eventType, 'decision')))
      .orderBy(desc(homepageTeamEvents.ts))
      .limit(30),
    listSuggestions({ team: 'email', kinds: ['campaign'], statuses: ['approved'], orderBy: 'age' }),
    getPipelineSetting(EMAIL_CAMPAIGN_PUSH_VALVE),
  ])

  const draftedIds = await alreadyDraftedCampaignIds(approvedCampaigns.map(r => r.id))
  const pendingCampaigns: PendingCampaignRow[] = approvedCampaigns.map(r => ({
    id: r.id,
    suggestion: r.suggestion,
    createdAt: r.createdAt.toISOString(),
    alreadyDrafted: draftedIds.has(r.id),
  }))

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
    pendingCampaigns,
    campaignPushValveOn: campaignPushSetting === 'true',
  }
}
