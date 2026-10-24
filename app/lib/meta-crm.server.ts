/**
 * Meta Conversions API for CRM: Instant Form leads and their funnel stages.
 * Server-only. Pure helpers live in app/lib/meta-crm-core.ts.
 *
 * Flow:
 *   1. Meta posts a leadgen notification to /api/webhooks/meta-leadgen.
 *      The hourly /cron/meta-crm-sync backfill catches any it missed.
 *   2. ingestLead fetches the lead from the Graph API, subscribes the email to
 *      the paid-leads Klaviyo list (so the same welcome series and CURIOUS15
 *      offer reach it as a curious.xdipx.com signup), stores the match hashes,
 *      and sends the raw "Lead" stage event with the lead_id.
 *   3. syncConversions checks Klaviyo for a Placed Order on each lead's
 *      profile and sends the "Converted" stage when one appears.
 *
 * Contact details are never stored here: meta_leads keeps Meta's SHA-256 match
 * hashes and the Klaviyo profile id, and the address itself lives in Klaviyo.
 *
 * Credentials:
 *   META_LEADS_ACCESS_TOKEN  Page or system-user token with leads_retrieval
 *                            (falls back to META_ADS_ACCESS_TOKEN)
 *   META_APP_SECRET          signs the webhook (falls back to FACEBOOK_APP_SECRET)
 *   META_WEBHOOK_VERIFY_TOKEN the string entered in the app's webhook setup
 *   META_LEAD_FORM_IDS       comma-separated form ids the backfill reads
 * Stage events reuse META_PIXEL_ID / META_CAPI_TOKEN (same dataset).
 *
 * Every entry point is safe to call repeatedly: lead rows are keyed by lead
 * id, stage rows by (lead id, stage), and a stage that was sent is never sent
 * again.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, asc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { db } from './db.server'
import { metaLeads, metaLeadStageEvents } from '../../db/schema'
import { buildHashedUserData, META_GRAPH_VERSION, postCapiData } from './meta-capi.server'
import { subscribeLead } from './klaviyo.server'
import { getMetricIdsByName } from './klaviyo-flows.server'
import { LEAD_OFFER } from './lead-interests'
import { normalizePhoneToE164 } from './sms-v2/web-sms-link.server'
import {
  buildCrmStageData,
  CRM_STAGES,
  crmEventId,
  isMetaLeadId,
  MAX_EVENT_AGE_SECONDS,
  parseLeadFieldData,
  type CrmStage,
  type LeadgenChange,
} from './meta-crm-core'

/** A stage send is retried this many times before it is left for a person. */
const MAX_STAGE_ATTEMPTS = 5
/** Klaviyo is checked for a first order this long after the lead came in. */
const CONVERSION_WINDOW_DAYS = 30
/** Leads checked for conversion per run, oldest first. */
const CONVERSION_BATCH = 100
/** How far back the form backfill reads. Webhook retries cover most gaps. */
const BACKFILL_HOURS = 48

function leadsToken(): string | null {
  return process.env['META_LEADS_ACCESS_TOKEN'] || process.env['META_ADS_ACCESS_TOKEN'] || null
}

function appSecret(): string | null {
  return process.env['META_APP_SECRET'] || process.env['FACEBOOK_APP_SECRET'] || null
}

// ─── Webhook auth ─────────────────────────────────────────────────────────────

/**
 * Meta's subscription handshake: echo hub.challenge only when hub.verify_token
 * matches ours. Returns the challenge to echo, or null to refuse.
 */
export function verifySubscription(params: URLSearchParams): string | null {
  const expected = process.env['META_WEBHOOK_VERIFY_TOKEN']
  if (!expected) return null
  if (params.get('hub.mode') !== 'subscribe') return null
  const token = params.get('hub.verify_token') ?? ''
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return params.get('hub.challenge')
}

/**
 * X-Hub-Signature-256 is "sha256=" plus the HMAC-SHA256 of the raw body under
 * the app secret. False when the secret is unset, so an unconfigured
 * deployment refuses every post rather than accepting unsigned ones.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = appSecret()
  if (!secret || !header?.startsWith('sha256=')) return false
  const given = Buffer.from(header.slice(7), 'hex')
  const want = createHmac('sha256', secret).update(rawBody, 'utf8').digest()
  return given.length === want.length && timingSafeEqual(given, want)
}

// ─── Graph reads ──────────────────────────────────────────────────────────────

interface GraphLead {
  id: string
  created_time?: string
  field_data?: unknown
  ad_id?: string
  adset_id?: string
  campaign_id?: string
  form_id?: string
  platform?: string
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = leadsToken()
  if (!token) throw new Error('no META_LEADS_ACCESS_TOKEN')
  const qs = new URLSearchParams({ ...params, access_token: token })
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`Graph GET ${path} ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

function fetchLead(leadId: string): Promise<GraphLead> {
  return graphGet<GraphLead>(leadId, {
    fields: 'id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,platform',
  })
}

// ─── Stage events ─────────────────────────────────────────────────────────────

export interface StageResult {
  stage: CrmStage
  outcome: 'sent' | 'already_sent' | 'failed' | 'skipped'
  detail?: string
}

/**
 * Record a stage for a lead and send it, once. The ledger row is written
 * before the send so a crash mid-flight still leaves a row the retry pass
 * picks up.
 */
export async function recordStage(leadId: string, stage: CrmStage, eventTime: number): Promise<StageResult> {
  const eventId = crmEventId(leadId, stage)
  await db.insert(metaLeadStageEvents)
    .values({ leadId, stage, eventId, eventTime })
    .onConflictDoNothing()
  return sendStageRow(leadId, stage)
}

async function sendStageRow(leadId: string, stage: CrmStage): Promise<StageResult> {
  const [row] = await db.select().from(metaLeadStageEvents)
    .where(and(eq(metaLeadStageEvents.leadId, leadId), eq(metaLeadStageEvents.stage, stage)))
    .limit(1)
  if (!row) return { stage, outcome: 'failed', detail: 'no ledger row' }
  if (row.sentAt) return { stage, outcome: 'already_sent' }

  const ageSeconds = Math.floor(Date.now() / 1000) - row.eventTime
  if (ageSeconds > MAX_EVENT_AGE_SECONDS) {
    await db.update(metaLeadStageEvents)
      .set({ lastError: 'older than Meta accepts (7 days)', attempts: MAX_STAGE_ATTEMPTS })
      .where(eq(metaLeadStageEvents.id, row.id))
    return { stage, outcome: 'skipped', detail: 'too old' }
  }

  const [lead] = await db.select({
    emailHash: metaLeads.emailHash,
    phoneHash: metaLeads.phoneHash,
    firstNameHash: metaLeads.firstNameHash,
  }).from(metaLeads).where(eq(metaLeads.leadId, leadId)).limit(1)

  const result = await postCapiData(buildCrmStageData({
    leadId,
    stage,
    eventId: row.eventId,
    eventTime: row.eventTime,
    user: { em: lead?.emailHash ?? null, ph: lead?.phoneHash ?? null, fn: lead?.firstNameHash ?? null },
  }))

  if (result.ok) {
    await db.update(metaLeadStageEvents)
      .set({ sentAt: new Date(), attempts: row.attempts + 1, lastError: null, fbtraceId: result.fbtraceId ?? null })
      .where(eq(metaLeadStageEvents.id, row.id))
    console.info('[meta-crm] stage sent', stage, leadId, `fbtrace=${result.fbtraceId ?? 'none'}`)
    return { stage, outcome: 'sent' }
  }
  // Missing credentials are not an attempt: nothing went out.
  const error = result.error ?? result.skipped ?? 'unknown'
  await db.update(metaLeadStageEvents)
    .set({ attempts: result.skipped ? row.attempts : row.attempts + 1, lastError: error.slice(0, 500), fbtraceId: result.fbtraceId ?? null })
    .where(eq(metaLeadStageEvents.id, row.id))
  console.error('[meta-crm] stage not sent', stage, leadId, error)
  return { stage, outcome: result.skipped ? 'skipped' : 'failed', detail: error }
}

/** Resend every unsent stage that is still young enough and under the attempt cap. */
export async function retryUnsentStages(): Promise<StageResult[]> {
  const cutoff = Math.floor(Date.now() / 1000) - MAX_EVENT_AGE_SECONDS
  const rows = await db.select({ leadId: metaLeadStageEvents.leadId, stage: metaLeadStageEvents.stage })
    .from(metaLeadStageEvents)
    .where(and(
      isNull(metaLeadStageEvents.sentAt),
      lt(metaLeadStageEvents.attempts, MAX_STAGE_ATTEMPTS),
      gte(metaLeadStageEvents.eventTime, cutoff),
    ))
    .orderBy(asc(metaLeadStageEvents.createdAt))
    .limit(200)
  const out: StageResult[] = []
  for (const r of rows) out.push(await sendStageRow(r.leadId, r.stage as CrmStage))
  return out
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

export interface IngestResult {
  leadId: string
  outcome: 'ingested' | 'already_ingested' | 'failed'
  detail?: string
  stage?: StageResult
}

/**
 * Bring one Meta lead into the CRM: fetch it, subscribe it to Klaviyo, store
 * its match hashes, and send the raw Lead stage. Idempotent on lead id. A
 * failure is recorded on the row and retried by the next backfill pass.
 */
export async function ingestLead(change: LeadgenChange): Promise<IngestResult> {
  const { leadId } = change
  if (!isMetaLeadId(leadId)) return { leadId, outcome: 'failed', detail: 'bad lead id' }

  const createdAt = change.createdTime ? new Date(change.createdTime * 1000) : new Date()
  await db.insert(metaLeads).values({
    leadId,
    formId: change.formId,
    pageId: change.pageId,
    adId: change.adId,
    adsetId: change.adsetId,
    leadCreatedAt: createdAt,
  }).onConflictDoNothing()

  const [existing] = await db.select().from(metaLeads).where(eq(metaLeads.leadId, leadId)).limit(1)
  if (existing?.subscribedAt) {
    // Already in Klaviyo. Still make sure the raw stage went out.
    const stage = await recordStage(leadId, CRM_STAGES.lead, Math.floor(existing.leadCreatedAt.getTime() / 1000))
    return { leadId, outcome: 'already_ingested', stage }
  }

  try {
    const lead = await fetchLead(leadId)
    const fields = parseLeadFieldData(lead.field_data)
    const leadCreated = lead.created_time ? new Date(lead.created_time) : createdAt
    const phone = fields.phone ? normalizePhoneToE164(fields.phone) : null
    const hashes = buildHashedUserData({ email: fields.email, phone, firstName: fields.firstName })

    let profileId: string | null = null
    if (fields.email) {
      profileId = await subscribeLead({
        email: fields.email,
        ...(fields.firstName ? { firstName: fields.firstName } : {}),
        phone,
        properties: {
          lead_source: 'meta-instant-form',
          lead_offer_code: LEAD_OFFER.code,
          lead_captured_at: leadCreated.toISOString(),
          meta_lead_id: leadId,
          ...(lead.form_id ? { meta_form_id: lead.form_id } : {}),
          ...(lead.ad_id ? { meta_ad_id: lead.ad_id } : {}),
          ...(fields.interest ? { interest: fields.interest } : {}),
          utm_source: 'meta',
          utm_medium: 'instant_form',
        },
      })
    }

    await db.update(metaLeads).set({
      formId: lead.form_id ?? change.formId,
      adId: lead.ad_id ?? change.adId,
      adsetId: lead.adset_id ?? change.adsetId,
      campaignId: lead.campaign_id ?? null,
      platform: lead.platform ?? null,
      leadCreatedAt: Number.isFinite(leadCreated.getTime()) ? leadCreated : createdAt,
      emailHash: hashes.em ?? null,
      phoneHash: hashes.ph ?? null,
      firstNameHash: hashes.fn ?? null,
      interest: fields.interest,
      klaviyoProfileId: profileId,
      subscribedAt: fields.email ? new Date() : null,
      ingestAttempts: (existing?.ingestAttempts ?? 0) + 1,
      ingestError: fields.email ? null : 'no email on the form',
      updatedAt: new Date(),
    }).where(eq(metaLeads.leadId, leadId))

    const stage = await recordStage(leadId, CRM_STAGES.lead, Math.floor(leadCreated.getTime() / 1000))
    return { leadId, outcome: 'ingested', stage }
  } catch (err) {
    const detail = (err as Error).message.slice(0, 500)
    await db.update(metaLeads).set({
      ingestAttempts: (existing?.ingestAttempts ?? 0) + 1,
      ingestError: detail,
      updatedAt: new Date(),
    }).where(eq(metaLeads.leadId, leadId))
    console.error('[meta-crm] ingest failed', leadId, detail)
    return { leadId, outcome: 'failed', detail }
  }
}

/**
 * Read recent leads straight from each configured form and ingest any the
 * webhook did not deliver (or delivered while ingest was failing).
 */
export async function backfillFormLeads(): Promise<{ forms: number; seen: number; results: IngestResult[] }> {
  const formIds = (process.env['META_LEAD_FORM_IDS'] ?? '')
    .split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s))
  const since = Math.floor(Date.now() / 1000) - BACKFILL_HOURS * 3600
  const results: IngestResult[] = []
  let seen = 0
  for (const formId of formIds) {
    const page = await graphGet<{ data?: Array<{ id?: string; created_time?: string }> }>(`${formId}/leads`, {
      fields: 'id,created_time',
      limit: '100',
      filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]),
    })
    for (const l of page.data ?? []) {
      if (!l.id || !isMetaLeadId(l.id)) continue
      seen += 1
      const [row] = await db.select({ subscribedAt: metaLeads.subscribedAt, ingestError: metaLeads.ingestError })
        .from(metaLeads).where(eq(metaLeads.leadId, l.id)).limit(1)
      if (row?.subscribedAt || row?.ingestError === 'no email on the form') continue
      const created = l.created_time ? Math.floor(Date.parse(l.created_time) / 1000) : null
      results.push(await ingestLead({
        leadId: l.id, formId, pageId: null, adId: null, adsetId: null,
        createdTime: created && Number.isFinite(created) ? created : null,
      }))
    }
  }
  return { forms: formIds.length, seen, results }
}

// ─── Conversions ──────────────────────────────────────────────────────────────

async function klaviyoGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://a.klaviyo.com/api${path}`, {
    headers: {
      accept: 'application/json',
      revision: '2024-10-15',
      Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Klaviyo GET ${path} ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

function klaviyoDate(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, '')
}

/**
 * Find each recent, unconverted lead's first Placed Order in Klaviyo and send
 * the Converted stage for it. Klaviyo is the join because it holds the
 * address; on this store's Shopify plan the order itself carries no email.
 */
export async function syncConversions(): Promise<{ checked: number; converted: number; stages: StageResult[] }> {
  const since = new Date(Date.now() - CONVERSION_WINDOW_DAYS * 86_400_000)
  const leads = await db.select({
    leadId: metaLeads.leadId,
    profileId: metaLeads.klaviyoProfileId,
    leadCreatedAt: metaLeads.leadCreatedAt,
  }).from(metaLeads)
    .where(and(isNotNull(metaLeads.klaviyoProfileId), isNull(metaLeads.convertedAt), gte(metaLeads.leadCreatedAt, since)))
    .orderBy(asc(metaLeads.leadCreatedAt))
    .limit(CONVERSION_BATCH)
  if (leads.length === 0) return { checked: 0, converted: 0, stages: [] }

  const metricId = (await getMetricIdsByName()).get('Placed Order')
  if (!metricId) throw new Error('Klaviyo metric "Placed Order" not found')

  const stages: StageResult[] = []
  let converted = 0
  for (const lead of leads) {
    const filter = `and(equals(metric_id,"${metricId}"),equals(profile_id,"${lead.profileId}"),greater-than(datetime,${klaviyoDate(lead.leadCreatedAt)}))`
    const res = await klaviyoGet<{ data?: Array<{ attributes?: { datetime?: string; event_properties?: Record<string, unknown> } }> }>(
      `/events/?filter=${encodeURIComponent(filter)}&fields[event]=datetime,event_properties&sort=datetime&page[size]=1`,
    )
    const first = res.data?.[0]?.attributes
    const at = first?.datetime ? new Date(first.datetime) : null
    if (!at || !Number.isFinite(at.getTime())) continue
    const rawValue = first?.event_properties?.['$value']
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? NaN)
    await db.update(metaLeads).set({
      convertedAt: at,
      convertedValue: Number.isFinite(value) ? value.toFixed(2) : null,
      updatedAt: new Date(),
    }).where(eq(metaLeads.leadId, lead.leadId))
    converted += 1
    stages.push(await recordStage(lead.leadId, CRM_STAGES.converted, Math.floor(at.getTime() / 1000)))
  }
  return { checked: leads.length, converted, stages }
}

// ─── Cron entry ───────────────────────────────────────────────────────────────

export interface CrmSyncResult {
  skipped?: string
  backfill?: { forms: number; seen: number; ingested: number; failed: number }
  conversions?: { checked: number; converted: number }
  retried?: { sent: number; failed: number }
  errors: string[]
}

/**
 * The hourly pass: backfill missed leads, look for conversions, resend unsent
 * stages. Each step runs even when an earlier one failed, and each failure is
 * named in `errors`.
 */
export async function runMetaCrmSync(): Promise<CrmSyncResult> {
  if (!leadsToken()) return { skipped: 'no META_LEADS_ACCESS_TOKEN', errors: [] }
  const errors: string[] = []
  const out: CrmSyncResult = { errors }

  try {
    const b = await backfillFormLeads()
    out.backfill = {
      forms: b.forms,
      seen: b.seen,
      ingested: b.results.filter(r => r.outcome === 'ingested').length,
      failed: b.results.filter(r => r.outcome === 'failed').length,
    }
  } catch (err) {
    errors.push(`backfill: ${(err as Error).message}`)
  }

  try {
    const c = await syncConversions()
    out.conversions = { checked: c.checked, converted: c.converted }
  } catch (err) {
    errors.push(`conversions: ${(err as Error).message}`)
  }

  try {
    const r = await retryUnsentStages()
    out.retried = { sent: r.filter(s => s.outcome === 'sent').length, failed: r.filter(s => s.outcome === 'failed').length }
  } catch (err) {
    errors.push(`retry: ${(err as Error).message}`)
  }

  return out
}

/** Counts for the admin and the owner digest. */
export async function metaCrmCounts(): Promise<{ leads: number; converted: number; unsentStages: number }> {
  const [l] = await db.select({
    leads: sql<number>`count(*)::int`,
    converted: sql<number>`count(${metaLeads.convertedAt})::int`,
  }).from(metaLeads)
  const [s] = await db.select({ n: sql<number>`count(*)::int` }).from(metaLeadStageEvents)
    .where(isNull(metaLeadStageEvents.sentAt))
  return { leads: l?.leads ?? 0, converted: l?.converted ?? 0, unsentStages: s?.n ?? 0 }
}
