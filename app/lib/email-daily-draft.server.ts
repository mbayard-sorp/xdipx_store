/**
 * `POST /api/team/email` orchestration (ticket #15002): draft, preview, and
 * ledger for the daily promo email program. Routine docs:
 * docs/store-team/routine-email-daily.md Step 6.
 *
 *   draft:   {date, runId?, sections, products?, seasonalTheme?, emmaNote?,
 *             hypothesis?, subject, previewText?, audienceListId}
 *     -> syncs every recipient's add-on properties (best effort), assembles
 *        the HTML/text, pushes a Klaviyo draft campaign + template (gated by
 *        `email_campaign_push_enabled`, see klaviyo-campaigns.server.ts),
 *        writes one `email_sends` row keyed by `campaign_key` (`daily-
 *        YYYYMMDD`), and emails the owner a review link. Idempotent: a
 *        second call for the same date returns the existing row untouched.
 *   preview: same input, pure render — no Klaviyo calls, no DB row.
 *   ledger:  {since?} -> `email_sends` left-joined to each row's latest
 *            `email_campaign_metrics` pull.
 *
 * `seasonalTheme` and `emmaNote` are accepted for forward-compatibility with
 * the routine's planning payload but are not yet columns on `email_sends` or
 * inputs `assembleDailyEmail` reads directly — the caller folds them into
 * `sections` (an `emmaNote` section, a `seasonal` section) before calling.
 */
import { desc, eq, gte, inArray } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { emailCampaignMetrics, emailSends } from '../../db/schema'
import {
  assembleDailyEmail,
  campaignKey,
  isSendDay,
  isWithinDraftWindow,
  type AssembleDailyEmailInput,
  type EmailSection,
} from './email-daily.server'
import {
  defaultDailyCampaignPushDeps,
  klaviyoCampaignEditUrl,
  pushDailyEmailCampaign,
  type DailyCampaignPushDeps,
  type DailyCampaignPushResult,
} from './klaviyo-campaigns.server'
import { listProfilesInList, type KlaviyoListProfile } from './klaviyo.server'
import { defaultAddonSyncDeps, syncAddonsForAudience, type AddonSyncDeps, type AudienceSyncResult } from './email-addons.server'
import { escapeHtml, sendOwnerEmail } from './owner-alerts.server'

export class DailyDraftError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export interface DailyDraftInput {
  date: string
  runId?: number | null
  sections: EmailSection[]
  products?: string[]
  seasonalTheme?: string | null
  emmaNote?: string | null
  hypothesis?: string
  subject: string
  previewText?: string | null
  audienceListId: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(input: Record<string, unknown>): DailyDraftInput {
  if (typeof input['date'] !== 'string' || !DATE_RE.test(input['date'])) {
    throw new DailyDraftError('date (YYYY-MM-DD) is required')
  }
  if (!Array.isArray(input['sections']) || input['sections'].length === 0) {
    throw new DailyDraftError('sections array is required')
  }
  if (typeof input['subject'] !== 'string' || !input['subject'].trim()) {
    throw new DailyDraftError('subject is required')
  }
  if (typeof input['audienceListId'] !== 'string' || !input['audienceListId'].trim()) {
    throw new DailyDraftError('audienceListId is required')
  }
  return {
    date: input['date'],
    sections: input['sections'] as EmailSection[],
    subject: input['subject'],
    audienceListId: input['audienceListId'],
    ...(typeof input['runId'] === 'number' ? { runId: input['runId'] } : {}),
    ...(Array.isArray(input['products']) ? { products: input['products'] as string[] } : {}),
    ...(typeof input['seasonalTheme'] === 'string' ? { seasonalTheme: input['seasonalTheme'] } : {}),
    ...(typeof input['emmaNote'] === 'string' ? { emmaNote: input['emmaNote'] } : {}),
    ...(typeof input['hypothesis'] === 'string' ? { hypothesis: input['hypothesis'] } : {}),
    ...(typeof input['previewText'] === 'string' ? { previewText: input['previewText'] } : {}),
  }
}

function buildAssembleInput(input: DailyDraftInput): AssembleDailyEmailInput {
  return {
    date: input.date,
    sections: input.sections,
    subject: input.subject,
    ...(input.hypothesis ? { hypothesis: input.hypothesis } : {}),
  }
}

/** America/Phoenix has no DST, so a fixed UTC-7 offset is always correct. */
function todayPhoenix(): string {
  return new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export interface PreviewResult {
  campaignKey: string
  html: string
  text: string
}

/** 'preview': pure render. No Klaviyo calls, no DB row, no send-day gate —
 *  a preview is for proofing copy before a date is even decided. */
export function previewDailyEmail(raw: Record<string, unknown>): PreviewResult {
  const input = validate(raw)
  const assembled = assembleDailyEmail(buildAssembleInput(input))
  return { campaignKey: campaignKey(input.date), html: assembled.html, text: assembled.text }
}

type EmailSendRow = typeof emailSends.$inferSelect

export interface DraftDeps {
  isSendDay: (date: string) => Promise<boolean>
  getExistingSend: (campaignKey: string) => Promise<EmailSendRow | null>
  listProfiles: (listId: string) => Promise<KlaviyoListProfile[]>
  syncAudience: (profiles: readonly KlaviyoListProfile[], deps?: AddonSyncDeps) => Promise<AudienceSyncResult>
  pushCampaign: (input: Parameters<typeof pushDailyEmailCampaign>[0], deps: DailyCampaignPushDeps) => Promise<DailyCampaignPushResult>
  pushDeps: DailyCampaignPushDeps
  insertSend: (values: typeof emailSends.$inferInsert) => Promise<EmailSendRow>
  sendOwnerEmail: typeof sendOwnerEmail
  today: () => string
}

async function getExistingSendFromDb(key: string): Promise<EmailSendRow | null> {
  const rows = await db.select().from(emailSends).where(eq(emailSends.campaignKey, key)).limit(1)
  return rows[0] ?? null
}

async function insertSendIntoDb(values: typeof emailSends.$inferInsert): Promise<EmailSendRow> {
  const [row] = await db.insert(emailSends).values(values).onConflictDoNothing().returning()
  if (row) return row
  // Lost the race to a concurrent draft for the same campaign_key: the
  // winner's row is the honest answer, not an error.
  const existing = await getExistingSendFromDb(values.campaignKey)
  if (existing) return existing
  throw new DailyDraftError('email_sends insert conflicted but no row could be read back', 500)
}

export function defaultDraftDeps(): DraftDeps {
  return {
    isSendDay: (date) => isSendDay(date),
    getExistingSend: getExistingSendFromDb,
    listProfiles: listProfilesInList,
    syncAudience: (profiles, deps) => syncAddonsForAudience(profiles, deps ?? defaultAddonSyncDeps()),
    pushCampaign: pushDailyEmailCampaign,
    pushDeps: defaultDailyCampaignPushDeps(),
    insertSend: insertSendIntoDb,
    sendOwnerEmail,
    today: todayPhoenix,
  }
}

/** `APP_URL`, falling back to the production domain the way other owner-facing links in this file do. */
function appUrl(): string {
  return process.env['APP_URL'] ?? 'https://xdipx.com'
}

function buildDailyOwnerEmail(i: { date: string; subject: string; editUrl: string | null; campaignKey: string }): { subject: string; html: string } {
  const link = i.editUrl
    ? `<p><a href="${escapeHtml(i.editUrl)}">Review and send in Klaviyo</a></p>`
    : `<p><em>No Klaviyo draft was created. Build it manually for ${escapeHtml(i.date)}.</em></p>`
  // Ticket #17445: the owner review loop at /admin/email lives alongside the
  // Klaviyo draft link, not instead of it — Klaviyo is still where the owner
  // actually hits send.
  const adminLink = `<p><a href="${escapeHtml(appUrl())}/admin/email#${escapeHtml(i.campaignKey)}">Review in xdipx admin</a></p>`
  const html = [
    `<h2>Daily email draft ready to review</h2>`,
    `<p>The ${escapeHtml(i.date)} send became a Klaviyo <strong>draft</strong>. Nothing was sent or scheduled.</p>`,
    `<ul><li><strong>Subject:</strong> ${escapeHtml(i.subject)}</li></ul>`,
    adminLink,
    link,
  ].join('\n')
  return { subject: `Daily email draft ready: ${i.date}`, html }
}

export interface DraftResult {
  campaignKey: string
  pushed: boolean
  reason: string
  row?: EmailSendRow
  html?: string
  text?: string
  addonSync?: AudienceSyncResult
}

/** 'draft': the full send-day path. Idempotent on `campaign_key`. */
export async function draftDailyEmail(raw: Record<string, unknown>, deps: DraftDeps = defaultDraftDeps()): Promise<DraftResult> {
  const input = validate(raw)
  const key = campaignKey(input.date)

  if (!(await deps.isSendDay(input.date))) {
    throw new DailyDraftError(`${input.date} is not a send day`, 409)
  }
  if (!isWithinDraftWindow(input.date, deps.today(), 1)) {
    throw new DailyDraftError(`${input.date} is more than 1 day from today; draft it closer to the send`, 409)
  }

  const existing = await deps.getExistingSend(key)
  if (existing) {
    return { campaignKey: key, pushed: existing.status !== 'skipped', reason: 'already-exists', row: existing }
  }

  const assembled = assembleDailyEmail(buildAssembleInput(input))

  // Add-on sync is best effort: a failure here (a transient Klaviyo error, a
  // partially-synced list) never blocks the draft itself.
  let addonSync: AudienceSyncResult | undefined
  try {
    const profiles = await deps.listProfiles(input.audienceListId)
    addonSync = await deps.syncAudience(profiles)
  } catch (err) {
    console.error('[email-daily-draft] add-on sync failed for list', input.audienceListId, err)
  }

  const pushResult = await deps.pushCampaign(
    {
      dateKey: input.date,
      subject: input.subject,
      previewText: input.previewText ?? null,
      listId: input.audienceListId,
      html: assembled.html,
      text: assembled.text,
    },
    deps.pushDeps,
  )

  if (!pushResult.pushed) {
    return {
      campaignKey: key,
      pushed: false,
      reason: pushResult.reason,
      html: assembled.html,
      text: assembled.text,
      ...(addonSync ? { addonSync } : {}),
    }
  }

  const row = await deps.insertSend({
    campaignKey: key,
    sendDate: input.date,
    klaviyoCampaignId: pushResult.campaignId ?? null,
    klaviyoTemplateId: pushResult.templateId ?? null,
    audience: input.audienceListId,
    subject: input.subject,
    previewText: input.previewText ?? null,
    featuredHandles: input.products ?? [],
    // Ticket #17445: stored so /admin/email can re-render the HTML preview
    // (via assembleDailyEmail) without re-sending the draft request, and so
    // the review loop's Approve action can push a Klaviyo draft later if it
    // was not pushed at draft time.
    blocks: input.sections,
    hypothesis: input.hypothesis ?? null,
    runId: input.runId ?? null,
    status: 'drafted',
  })

  const editUrl = pushResult.campaignId ? klaviyoCampaignEditUrl(pushResult.campaignId) : null
  const ownerMail = buildDailyOwnerEmail({ date: input.date, subject: input.subject, editUrl, campaignKey: key })
  await deps.sendOwnerEmail(ownerMail.subject, ownerMail.html, { escalation: 'owner-decision', fromName: 'xdipx email' })

  return { campaignKey: key, pushed: true, reason: 'ok', row, ...(addonSync ? { addonSync } : {}) }
}

// ─── Ledger ──────────────────────────────────────────────────────────────────

export interface LedgerRow {
  campaignKey: string
  sendDate: string | null
  subject: string | null
  audience: string | null
  klaviyoCampaignId: string | null
  status: string
  hypothesis: string | null
  featuredHandles: string[] | null
  metrics: typeof emailCampaignMetrics.$inferSelect | null
}

/** `email_sends` since an optional date, each joined to its latest metrics
 *  pull (`email_campaign_metrics` is append-only — one row per pull). */
export async function getEmailLedger(since?: string): Promise<LedgerRow[]> {
  const sends = since
    ? await db.select().from(emailSends).where(gte(emailSends.sendDate, since)).orderBy(desc(emailSends.sendDate))
    : await db.select().from(emailSends).orderBy(desc(emailSends.sendDate)).limit(60)

  if (sends.length === 0) return []

  const keys = sends.map((s) => s.campaignKey)
  const metricsRows = await db
    .select()
    .from(emailCampaignMetrics)
    .where(inArray(emailCampaignMetrics.campaignKey, keys))
    .orderBy(desc(emailCampaignMetrics.pulledAt))

  const latestByKey = new Map<string, typeof emailCampaignMetrics.$inferSelect>()
  for (const m of metricsRows) {
    if (!latestByKey.has(m.campaignKey)) latestByKey.set(m.campaignKey, m)
  }

  return sends.map((s) => ({
    campaignKey: s.campaignKey,
    sendDate: s.sendDate,
    subject: s.subject,
    audience: s.audience,
    klaviyoCampaignId: s.klaviyoCampaignId,
    status: s.status,
    hypothesis: s.hypothesis,
    featuredHandles: s.featuredHandles,
    metrics: latestByKey.get(s.campaignKey) ?? null,
  }))
}

// ─── Revisions (ticket #17445) ─────────────────────────────────────────────

export interface RevisionRow {
  campaignKey: string
  sendDate: string | null
  subject: string | null
  reviewNotes: { at: string; note: string }[]
}

/**
 * `email_sends` rows the owner sent back for changes via /admin/email's
 * "Request changes" action, so `routine-email-daily.md` Step 0.5 can revise
 * them before anything else. Ordered oldest-first: the longest-waiting
 * revision gets picked up first.
 */
export async function getEmailRevisions(): Promise<RevisionRow[]> {
  const rows = await db
    .select({
      campaignKey:  emailSends.campaignKey,
      sendDate:     emailSends.sendDate,
      subject:      emailSends.subject,
      reviewNotes:  emailSends.reviewNotes,
    })
    .from(emailSends)
    .where(eq(emailSends.reviewStatus, 'changes_requested'))
    .orderBy(emailSends.createdAt)
  return rows.map((r) => ({ ...r, reviewNotes: r.reviewNotes ?? [] }))
}
