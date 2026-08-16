/**
 * The data layer behind /admin/outreach.
 *
 * Reads for the prospect list and the thread view, and the two owner writes
 * the page needs that the send path does not cover (queue a prospect, hand-set
 * a status). Sending itself is not re-implemented here: the route calls
 * sendOutreachEmail() in outreach.server.ts so the page passes through exactly
 * the same guards as the team API, valve and cap and dedupe included.
 *
 * The queue guard is duplicated from api.team.outreach.tsx on purpose. It is
 * the one rule that keeps a replied or rejected prospect from being re-entered
 * into the send path, and both callers enforce it against the shared
 * QUEUEABLE_STATUSES list rather than one trusting the other.
 */

import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  homepageTeamSuggestions,
  outreachMessages,
  outreachProspects,
} from '../../db/schema'
import { canQueue, canOwnerSet, extractPitchTarget, type PitchTarget } from '~/lib/outreach-admin'
import {
  checkSendGuards,
  CONTACT_CHANNELS,
  DEDUPE_WINDOW_DAYS,
  type ContactChannel,
  type ProspectStatus,
  type SendGuardResult,
} from '~/lib/outreach-core'
import {
  countOutboundToday,
  getOutreachDailyCap,
  isOutreachSendEnabled,
  OUTREACH_CAP_KEY,
  OUTREACH_VALVE_KEY,
} from '~/lib/outreach.server'
import { setPipelineSettingAudited } from '~/lib/settings.server'

export interface OutreachOverview {
  valveOn: boolean
  dailyCap: number
  sentToday: number
}

export async function getOutreachOverview(): Promise<OutreachOverview> {
  const [valveOn, dailyCap, sentToday] = await Promise.all([
    isOutreachSendEnabled(),
    getOutreachDailyCap(),
    countOutboundToday(),
  ])
  return { valveOn, dailyCap, sentToday }
}

export interface ProspectRow {
  id: number
  domain: string
  name: string | null
  contactEmail: string | null
  contactChannel: string
  source: string | null
  status: string
  policyNote: string | null
  notes: string | null
  suggestionId: number | null
  updatedAt: Date
  /** Last outbound send, so the 7-day quiet period is visible in the list. */
  lastOutboundAt: Date | null
  /** Inbound replies on file, the signal that a thread needs the owner. */
  inboundCount: number
}

/**
 * Every prospect, newest activity first, with the two thread facts the list
 * needs: when the last pitch went out (the 7-day quiet period) and whether
 * anything came back. Two queries joined in memory rather than a correlated
 * subquery, because the prospect table is a vetted hand-built list in the low
 * hundreds and readable SQL is worth more here than one round trip.
 */
export async function listProspects(): Promise<ProspectRow[]> {
  const prospects = await db
    .select()
    .from(outreachProspects)
    .orderBy(desc(outreachProspects.updatedAt))
    .limit(300)

  const activity = await db
    .select({
      prospectId: outreachMessages.prospectId,
      direction: outreachMessages.direction,
      lastSentAt: sql<Date | null>`max(coalesce(${outreachMessages.sentAt}, ${outreachMessages.createdAt}))`,
      n: sql<number>`count(*)::int`,
    })
    .from(outreachMessages)
    .groupBy(outreachMessages.prospectId, outreachMessages.direction)

  const lastOutbound = new Map<number, Date>()
  const inbound = new Map<number, number>()
  for (const a of activity) {
    if (a.direction === 'out') {
      if (a.lastSentAt) lastOutbound.set(a.prospectId, new Date(a.lastSentAt))
    } else {
      inbound.set(a.prospectId, a.n)
    }
  }

  return prospects.map(p => ({
    id: p.id,
    domain: p.domain,
    name: p.name,
    contactEmail: p.contactEmail,
    contactChannel: p.contactChannel,
    source: p.source,
    status: p.status,
    policyNote: p.policyNote,
    notes: p.notes,
    suggestionId: p.suggestionId,
    updatedAt: p.updatedAt,
    lastOutboundAt: lastOutbound.get(p.id) ?? null,
    inboundCount: inbound.get(p.id) ?? 0,
  }))
}

export interface ThreadMessage {
  id: number
  direction: string
  subject: string | null
  bodyText: string | null
  classification: string | null
  sentAt: Date | null
  createdAt: Date
}

export interface PitchSource {
  id: number
  suggestion: string
  status: string
  createdAt: Date
  /** True when the prospect row points at it, false when it was matched by domain. */
  linked: boolean
}

export interface ProspectDetail {
  prospect: ProspectRow
  messages: ThreadMessage[]
  /**
   * The pitch copy to seed the composer from: the linked suggestion when the
   * scout set suggestion_id, plus any still-open suggestion whose text names
   * this domain. The domain match matters for the rows filed before migration
   * 077 existed, which carry no link at all.
   */
  pitches: PitchSource[]
  /** Whether a send would pass right now, and why not when it would not. */
  sendGuard: SendGuardResult
}

export async function getProspectDetail(id: number): Promise<ProspectDetail | null> {
  const all = await listProspects()
  const prospect = all.find(p => p.id === id)
  if (!prospect) return null

  const [messages, overview] = await Promise.all([
    db
      .select({
        id: outreachMessages.id,
        direction: outreachMessages.direction,
        subject: outreachMessages.subject,
        bodyText: outreachMessages.bodyText,
        classification: outreachMessages.classification,
        sentAt: outreachMessages.sentAt,
        createdAt: outreachMessages.createdAt,
      })
      .from(outreachMessages)
      .where(eq(outreachMessages.prospectId, id))
      .orderBy(desc(sql`coalesce(${outreachMessages.sentAt}, ${outreachMessages.createdAt})`))
      .limit(50),
    getOutreachOverview(),
  ])

  const pitches = await findPitchSources(prospect)

  const sendGuard = checkSendGuards({
    valveOn: overview.valveOn,
    sentToday: overview.sentToday,
    dailyCap: overview.dailyCap,
    prospect: { status: prospect.status, contactEmail: prospect.contactEmail },
    lastOutboundAt: prospect.lastOutboundAt,
    now: new Date(),
  })

  return { prospect, messages, pitches, sendGuard }
}

/**
 * Pitch copy for one prospect. The linked suggestion first, then open rows
 * that mention the domain. Dismissed and applied rows are excluded: a pitch
 * the owner already dealt with should not reappear as a draft to send.
 */
async function findPitchSources(prospect: ProspectRow): Promise<PitchSource[]> {
  const conditions = [
    ilike(homepageTeamSuggestions.suggestion, `%${prospect.domain}%`),
  ]
  if (prospect.suggestionId) {
    conditions.push(eq(homepageTeamSuggestions.id, prospect.suggestionId))
  }

  const rows = await db
    .select({
      id: homepageTeamSuggestions.id,
      suggestion: homepageTeamSuggestions.suggestion,
      status: homepageTeamSuggestions.status,
      createdAt: homepageTeamSuggestions.createdAt,
    })
    .from(homepageTeamSuggestions)
    .where(and(
      or(...conditions),
      inArray(homepageTeamSuggestions.status, ['proposed', 'approved']),
    ))
    .orderBy(desc(homepageTeamSuggestions.createdAt))
    .limit(5)

  return rows
    .map(r => ({ ...r, linked: r.id === prospect.suggestionId }))
    .sort((a, b) => Number(b.linked) - Number(a.linked))
}

export interface UnadoptedPitch {
  suggestionId: number
  status: string
  createdAt: Date
  suggestion: string
  /** Best guess at who this pitch is aimed at, all fields editable by the owner. */
  target: PitchTarget
}

/**
 * Drafted pitches that no prospect row points at yet.
 *
 * This is where the backlog actually lives. The prospects table was seeded
 * from the owner's vetted doc, while the scout has been filing pitch drafts as
 * suggestion rows for weeks; on 2026-08-16 the two sets did not overlap by a
 * single domain, so a page listing only prospects showed six rows with no
 * copy and hid every pitch that had been written. Adopting a pitch creates the
 * prospect the pipeline needs and links the two together.
 */
export async function listUnadoptedPitches(): Promise<UnadoptedPitch[]> {
  const [rows, prospects] = await Promise.all([
    db
      .select({
        id: homepageTeamSuggestions.id,
        status: homepageTeamSuggestions.status,
        createdAt: homepageTeamSuggestions.createdAt,
        suggestion: homepageTeamSuggestions.suggestion,
      })
      .from(homepageTeamSuggestions)
      .where(and(
        ilike(homepageTeamSuggestions.suggestion, '%OFFSITE PITCH%'),
        inArray(homepageTeamSuggestions.status, ['proposed', 'approved']),
      ))
      .orderBy(desc(homepageTeamSuggestions.createdAt))
      .limit(60),
    db
      .select({ domain: outreachProspects.domain, suggestionId: outreachProspects.suggestionId })
      .from(outreachProspects),
  ])

  const takenDomains = new Set(prospects.map(p => p.domain.toLowerCase()))
  const takenSuggestions = new Set(prospects.map(p => p.suggestionId).filter((n): n is number => n != null))

  return rows
    .filter(r => !takenSuggestions.has(r.id))
    .map(r => ({
      suggestionId: r.id,
      status: r.status,
      createdAt: r.createdAt,
      suggestion: r.suggestion,
      target: extractPitchTarget(r.suggestion),
    }))
    .filter(p => !p.target.domain || !takenDomains.has(p.target.domain))
}

/**
 * Create the prospect a drafted pitch is aimed at, linked back to the
 * suggestion it came from. Status starts at 'new' like every other prospect:
 * adopting a pitch is filing it, not approving it, and the queue step stays a
 * separate deliberate click.
 */
export async function adoptPitch(input: {
  suggestionId: number
  domain: string
  email: string | null
  channel: string
  name: string | null
}): Promise<OwnerWriteResult & { prospectId?: number }> {
  const domain = input.domain.trim().toLowerCase().replace(/^www\./, '')
  if (!domain.includes('.') || /\s/.test(domain)) {
    return { ok: false, message: `'${input.domain}' does not look like a domain.` }
  }
  const email = input.email?.trim() || null
  if (email && (!email.includes('@') || /\s/.test(email))) {
    return { ok: false, message: 'That does not look like an email address.' }
  }
  const channel = (CONTACT_CHANNELS as readonly string[]).includes(input.channel)
    ? (input.channel as ContactChannel)
    : 'email'

  const [existing] = await db
    .select({ id: outreachProspects.id })
    .from(outreachProspects)
    .where(eq(outreachProspects.domain, domain))
    .limit(1)

  if (existing) {
    await db
      .update(outreachProspects)
      .set({ suggestionId: input.suggestionId, updatedAt: new Date() })
      .where(eq(outreachProspects.id, existing.id))
    return { ok: true, message: `${domain} already existed; linked the draft to it.`, prospectId: existing.id }
  }

  const [row] = await db
    .insert(outreachProspects)
    .values({
      domain,
      name: input.name?.trim().slice(0, 255) || null,
      contactEmail: email?.slice(0, 255) ?? null,
      contactChannel: channel,
      source: 'pitch-adopt',
      status: 'new',
      suggestionId: input.suggestionId,
    })
    .returning({ id: outreachProspects.id })

  const message = `${domain} added from draft #${input.suggestionId}.`
  return row ? { ok: true, message, prospectId: row.id } : { ok: true, message }
}

export type OwnerWriteResult = { ok: true; message: string } | { ok: false; message: string }

/** Move a prospect to 'queued', the only status a send is allowed from. */
export async function queueProspect(id: number): Promise<OwnerWriteResult> {
  const [row] = await db
    .select({ id: outreachProspects.id, domain: outreachProspects.domain, status: outreachProspects.status })
    .from(outreachProspects)
    .where(eq(outreachProspects.id, id))
    .limit(1)
  if (!row) return { ok: false, message: `No prospect #${id}.` }
  if (!canQueue(row.status)) {
    return { ok: false, message: `Cannot queue ${row.domain}: status is '${row.status}'.` }
  }
  await db
    .update(outreachProspects)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(eq(outreachProspects.id, id))
  return { ok: true, message: `${row.domain} is queued and ready to send.` }
}

/**
 * Hand-set one of the owner's own statuses. Refuses the pipeline's statuses
 * outright: the page must never be able to claim a pitch was sent, or that a
 * prospect replied, when no message exists to back it up.
 */
export async function setProspectStatusByOwner(
  id: number,
  status: string,
): Promise<OwnerWriteResult> {
  if (!canOwnerSet(status)) {
    return { ok: false, message: `'${status}' is set by the pipeline, not by hand.` }
  }
  const [row] = await db
    .select({ domain: outreachProspects.domain })
    .from(outreachProspects)
    .where(eq(outreachProspects.id, id))
    .limit(1)
  if (!row) return { ok: false, message: `No prospect #${id}.` }

  await db
    .update(outreachProspects)
    .set({ status: status as ProspectStatus, updatedAt: new Date() })
    .where(eq(outreachProspects.id, id))
  return { ok: true, message: `${row.domain} moved to '${status}'.` }
}

/** Add or correct the contact email on a prospect the scout left incomplete. */
export async function setProspectContactEmail(
  id: number,
  email: string,
): Promise<OwnerWriteResult> {
  const clean = email.trim().slice(0, 255)
  if (!clean.includes('@') || /\s/.test(clean)) {
    return { ok: false, message: 'That does not look like an email address.' }
  }
  const result = await db
    .update(outreachProspects)
    .set({ contactEmail: clean, updatedAt: new Date() })
    .where(eq(outreachProspects.id, id))
    .returning({ domain: outreachProspects.domain })
  if (result.length === 0) return { ok: false, message: `No prospect #${id}.` }
  return { ok: true, message: `Contact for ${result[0]!.domain} set to ${clean}.` }
}

/** Flip the master send valve. Audited, like every other valve write. */
export async function setOutreachValve(on: boolean): Promise<OwnerWriteResult> {
  const write = await setPipelineSettingAudited(
    OUTREACH_VALVE_KEY,
    on ? 'true' : 'false',
    'owner',
    'admin.outreach',
  )
  if (write.unchanged) return { ok: true, message: `Sending was already ${on ? 'on' : 'off'}.` }
  return {
    ok: true,
    message: on
      ? 'Sending is ON. Pitches sent from this page go out over SMTP immediately.'
      : 'Sending is OFF. No pitch can leave until it is back on.',
  }
}

export async function setOutreachDailyCap(cap: number): Promise<OwnerWriteResult> {
  if (!Number.isInteger(cap) || cap < 0 || cap > 100) {
    return { ok: false, message: 'Cap must be a whole number between 0 and 100.' }
  }
  await setPipelineSettingAudited(OUTREACH_CAP_KEY, String(cap), 'owner', 'admin.outreach')
  return { ok: true, message: `Daily cap set to ${cap}.` }
}

export { DEDUPE_WINDOW_DAYS }
