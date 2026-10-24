/**
 * Pure helpers for the Meta Conversions API for CRM (Instant Form leads).
 * I/O lives in app/lib/meta-crm.server.ts; everything here is deterministic
 * so it can be tested without Meta, Klaviyo or the database.
 *
 * The integration: a lead submitted on a Meta Instant Form gets a lead_id that
 * Meta generated. Every time that lead moves to a new stage of our funnel we
 * send an event carrying the same lead_id, so Meta can learn which leads go on
 * to buy and optimize the ad set for those ("conversion leads") instead of for
 * raw form fills. Meta requires an event for every stage, the raw lead
 * included.
 */
import { getLeadInterest, LEAD_INTERESTS, type LeadInterestSlug } from './lead-interests'

/** Shown to Meta as lead_event_source: the name of the CRM. */
export const CRM_SOURCE_NAME = 'xdipx'

/**
 * Funnel stages, in order. The event_name is the stage name, which is what
 * Events Manager shows when the owner picks the stage to optimize for.
 */
export const CRM_STAGES = {
  lead: 'Lead',
  converted: 'Converted',
} as const
export type CrmStage = (typeof CRM_STAGES)[keyof typeof CRM_STAGES]

/** Meta rejects events whose event_time is more than 7 days old. */
export const MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60

/** Meta lead ids are 15-17 digits today; allow some slack either side. */
const LEAD_ID = /^\d{6,20}$/

export function isMetaLeadId(v: unknown): v is string {
  return typeof v === 'string' && LEAD_ID.test(v)
}

/** One leadgen notification, as the webhook delivers it. */
export interface LeadgenChange {
  leadId: string
  formId: string | null
  pageId: string | null
  adId: string | null
  adsetId: string | null
  /** Unix seconds, when Meta says the lead was created. */
  createdTime: number | null
}

function idOrNull(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v)
  return typeof v === 'string' && /^\d{1,30}$/.test(v) ? v : null
}

/**
 * Pull the leadgen changes out of a Page webhook body. Anything that is not a
 * leadgen change with a usable lead id is ignored, not an error: the same
 * subscription can carry other Page fields.
 *
 * Meta sends leadgen_id as a string. If a number ever arrives it may already
 * have lost precision in JSON.parse, so a number is accepted only while it is
 * still a safe integer.
 */
export function extractLeadgenChanges(body: unknown): LeadgenChange[] {
  if (!body || typeof body !== 'object') return []
  const b = body as { object?: unknown; entry?: unknown }
  if (b.object !== 'page' || !Array.isArray(b.entry)) return []
  const out: LeadgenChange[] = []
  const seen = new Set<string>()
  for (const entry of b.entry) {
    const changes = (entry as { changes?: unknown })?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const c = change as { field?: unknown; value?: Record<string, unknown> }
      if (c?.field !== 'leadgen' || !c.value || typeof c.value !== 'object') continue
      const leadId = idOrNull(c.value['leadgen_id'])
      if (!leadId || !isMetaLeadId(leadId) || seen.has(leadId)) continue
      seen.add(leadId)
      const created = c.value['created_time']
      out.push({
        leadId,
        formId: idOrNull(c.value['form_id']),
        pageId: idOrNull(c.value['page_id']),
        adId: idOrNull(c.value['ad_id']),
        adsetId: idOrNull(c.value['adgroup_id']),
        createdTime: typeof created === 'number' && Number.isFinite(created) ? Math.floor(created) : null,
      })
    }
  }
  return out
}

/** What we keep from an Instant Form submission. */
export interface LeadFields {
  email: string | null
  phone: string | null
  firstName: string | null
  interest: LeadInterestSlug | null
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const INTEREST_BY_TEXT = new Map<string, LeadInterestSlug>(
  LEAD_INTERESTS.flatMap(i => [[norm(i.slug), i.slug], [norm(i.label), i.slug]] as Array<[string, LeadInterestSlug]>),
)

/**
 * Map a multiple-choice answer to one of the seven interest slugs. The form's
 * option keys should be the slugs; the labels are accepted too in case the
 * form was built without keys, since Meta then returns the option text.
 */
export function matchInterest(raw: string | null | undefined): LeadInterestSlug | null {
  if (!raw) return null
  const direct = getLeadInterest(raw.trim())
  if (direct) return direct.slug
  return INTEREST_BY_TEXT.get(norm(raw)) ?? null
}

/**
 * Read the standard and custom questions from a lead's field_data. Standard
 * questions arrive under fixed names (email, phone_number, first_name,
 * full_name). The interest question is custom, so any field whose name
 * mentions interest or curious counts.
 */
export function parseLeadFieldData(fieldData: unknown): LeadFields {
  const out: LeadFields = { email: null, phone: null, firstName: null, interest: null }
  if (!Array.isArray(fieldData)) return out
  for (const f of fieldData) {
    const name = typeof f?.name === 'string' ? f.name.toLowerCase() : ''
    const values = Array.isArray(f?.values) ? f.values : []
    const value = typeof values[0] === 'string' ? (values[0] as string).trim() : ''
    if (!name || !value) continue
    if (name === 'email') out.email = value
    else if (name === 'phone_number' || name === 'phone') out.phone = value
    else if (name === 'first_name') out.firstName = value
    else if (name === 'full_name' && !out.firstName) out.firstName = value.split(/\s+/)[0] ?? null
    else if (/interest|curious/.test(name) && !out.interest) out.interest = matchInterest(value)
  }
  return out
}

/** Hashed match keys for a stage event. Each is a SHA-256 hex string. */
export interface CrmUserHashes {
  em?: string | null
  ph?: string | null
  fn?: string | null
}

/**
 * The `data` array for one stage event, as JSON text.
 *
 * lead_id is an int64 that does not fit in a JS number, so it is spliced in
 * as a bare JSON number after serialization rather than passed through
 * JSON.stringify. The id is digits-only by construction (isMetaLeadId), which
 * is what makes the splice safe.
 */
export function buildCrmStageData(ev: {
  leadId: string
  stage: CrmStage
  eventId: string
  eventTime: number
  user: CrmUserHashes
}): string {
  if (!isMetaLeadId(ev.leadId)) throw new Error(`not a Meta lead id: ${ev.leadId}`)
  const placeholder = '__XDIPX_LEAD_ID__'
  const user_data: Record<string, unknown> = { lead_id: placeholder }
  if (ev.user.em) user_data['em'] = [ev.user.em]
  if (ev.user.ph) user_data['ph'] = [ev.user.ph]
  if (ev.user.fn) user_data['fn'] = [ev.user.fn]
  const row = {
    action_source: 'system_generated',
    custom_data: { event_source: 'crm', lead_event_source: CRM_SOURCE_NAME },
    event_name: ev.stage,
    event_id: ev.eventId,
    event_time: ev.eventTime,
    user_data,
  }
  return JSON.stringify([row]).replace(`"${placeholder}"`, ev.leadId)
}

/** Deterministic event id, so a retried send dedupes against the first. */
export function crmEventId(leadId: string, stage: CrmStage): string {
  return `crm_${stage.toLowerCase()}_${leadId}`
}
