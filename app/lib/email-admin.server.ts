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
import { EMAIL_CAMPAIGN_PUSH_VALVE, defaultDailyCampaignPushDeps, klaviyoCampaignEditUrl, pushDailyEmailCampaign } from './klaviyo-campaigns.server'
import { assembleDailyEmail, type EmailSection } from './email-daily.server'

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
  /** Owner review workflow state (ticket #17445): pending_review|changes_requested|approved. */
  reviewStatus: string
  reviewNotes: { at: string; note: string }[]
  /**
   * Re-rendered server-side from the row's stored `blocks` (ticket #17445).
   * Null for a row drafted before this shipped, or for one whose stored
   * blocks fail to re-render — never thrown, since a dashboard read must
   * not break on one bad historical row.
   */
  previewHtml: string | null
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

/**
 * Re-renders a stored `email_sends.blocks` payload via the same
 * `assembleDailyEmail` the draft/preview ops use, so /admin/email's review
 * iframe shows exactly what the owner would see in the inbox, and so the
 * Approve action can push a Klaviyo draft from a row that was not pushed at
 * draft time. `blocks` is null on any row drafted before ticket #17445, and
 * a malformed payload must not break the whole admin read, so both cases
 * return null rather than throwing.
 */
function renderAssembled(s: { sendDate: string | null; subject: string | null; hypothesis: string | null; blocks: unknown }): { html: string; text: string } | null {
  if (!Array.isArray(s.blocks) || s.blocks.length === 0) return null
  try {
    return assembleDailyEmail({
      date: s.sendDate ?? '1970-01-01',
      sections: s.blocks as EmailSection[],
      subject: s.subject ?? '',
      ...(s.hypothesis ? { hypothesis: s.hypothesis } : {}),
    })
  } catch (err) {
    console.error('[email-admin] renderAssembled failed; showing no preview for this row', err)
    return null
  }
}

function renderPreviewHtml(s: { sendDate: string | null; subject: string | null; hypothesis: string | null; blocks: unknown }): string | null {
  return renderAssembled(s)?.html ?? null
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
      reviewStatus: s.reviewStatus,
      reviewNotes: s.reviewNotes ?? [],
      previewHtml: renderPreviewHtml(s),
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

// ─── Owner review loop actions (ticket #17445) ─────────────────────────────

export type ApproveEmailSendResult =
  | { ok: true; klaviyoCampaignId: string; pushedNow: boolean; message: string }
  | { ok: true; klaviyoCampaignId: null; pushedNow: false; message: string }
  | { ok: false; error: string }

/**
 * Marks an `email_sends` row `review_status='approved'`. Never creates a
 * campaign-send-job and never sends anything; the owner still hits send in
 * Klaviyo. If the row has no Klaviyo draft yet (the draft-time push did not
 * happen, e.g. the valve was off), this also attempts
 * `pushDailyEmailCampaign` from the row's stored `blocks` so approving is
 * the retry point, not a second manual step.
 */
export async function approveEmailSend(
  id: number,
  approvedBy: string,
  deps: { pushCampaign: typeof pushDailyEmailCampaign; pushDeps: ReturnType<typeof defaultDailyCampaignPushDeps> } = {
    pushCampaign: pushDailyEmailCampaign,
    pushDeps: defaultDailyCampaignPushDeps(),
  },
): Promise<ApproveEmailSendResult> {
  const [row] = await db.select().from(emailSends).where(eq(emailSends.id, id)).limit(1)
  if (!row) return { ok: false, error: `email_sends row ${id} not found` }

  if (row.klaviyoCampaignId) {
    await db.update(emailSends).set({ reviewStatus: 'approved', approvedBy }).where(eq(emailSends.id, id))
    return { ok: true, klaviyoCampaignId: row.klaviyoCampaignId, pushedNow: false, message: 'Already drafted in Klaviyo.' }
  }

  const assembled = renderAssembled(row)
  if (!assembled) {
    await db.update(emailSends).set({ reviewStatus: 'approved', approvedBy }).where(eq(emailSends.id, id))
    return {
      ok: true, klaviyoCampaignId: null, pushedNow: false,
      message: 'Approved, but this row has no stored content to push (drafted before the review loop shipped) — build the Klaviyo draft manually.',
    }
  }

  const pushResult = await deps.pushCampaign(
    {
      dateKey: row.sendDate ?? row.campaignKey,
      subject: row.subject ?? '',
      previewText: row.previewText ?? null,
      listId: row.audience ?? '',
      html: assembled.html,
      text: assembled.text,
    },
    deps.pushDeps,
  )

  if (!pushResult.pushed || !pushResult.campaignId) {
    await db.update(emailSends).set({ reviewStatus: 'approved', approvedBy }).where(eq(emailSends.id, id))
    const message = pushResult.reason === 'valve-off'
      ? 'Approved, but email_campaign_push_enabled is off, so no Klaviyo draft was created. Flip the valve on /admin/homepage-team, then approve again.'
      : `Approved, but the Klaviyo push failed (${pushResult.reason}). Build the draft manually.`
    return { ok: true, klaviyoCampaignId: null, pushedNow: false, message }
  }

  await db.update(emailSends)
    .set({
      reviewStatus: 'approved',
      approvedBy,
      klaviyoCampaignId: pushResult.campaignId,
      klaviyoTemplateId: pushResult.templateId ?? null,
    })
    .where(eq(emailSends.id, id))

  return {
    ok: true,
    klaviyoCampaignId: pushResult.campaignId,
    pushedNow: true,
    message: `Approved. Klaviyo draft created: ${klaviyoCampaignEditUrl(pushResult.campaignId)}`,
  }
}

export type RequestEmailSendChangesResult =
  | { ok: true; reviewNotes: { at: string; note: string }[] }
  | { ok: false; error: string }

/**
 * Sends an `email_sends` row back to `review_status='changes_requested'`
 * with the owner's note appended to the append-only `review_notes` array.
 * `POST /api/team/email {op:'revisions'}` is how the daily routine sees
 * these without opening the admin UI.
 */
export async function requestEmailSendChanges(id: number, note: string): Promise<RequestEmailSendChangesResult> {
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: 'note is required' }

  const [row] = await db.select().from(emailSends).where(eq(emailSends.id, id)).limit(1)
  if (!row) return { ok: false, error: `email_sends row ${id} not found` }

  const reviewNotes = [...(row.reviewNotes ?? []), { at: new Date().toISOString(), note: trimmed }]
  await db.update(emailSends).set({ reviewStatus: 'changes_requested', reviewNotes }).where(eq(emailSends.id, id))
  return { ok: true, reviewNotes }
}
