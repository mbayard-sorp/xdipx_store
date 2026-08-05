/**
 * POST /api/team/outreach, the executor surface for the outreach pipeline
 * (docs/store-team/outreach-pipeline.md). Called by the offsite-scout routine
 * (team-token auth, same as every /api/team/* route).
 *
 *   { op: 'upsert-prospect', domain, name?, contactEmail?, contactChannel?,
 *     source?, status?, policyNote?, notes?, suggestionId? } -> { id, created }
 *     (status applies on CREATE only; an update ignores it entirely, so the
 *     lifecycle can only move through the 'queue' op and its guard below)
 *   { op: 'list', status? } -> { prospects: [...] }
 *   { op: 'queue', id | domain } -> { ok, id }
 *   { op: 'send', prospectId, subject, text } -> { sent, error?, messageId? }
 *
 * `send` enforces every hard guard in outreach.server.ts (valve, daily cap,
 * queued status, contact email, 7-day dedupe); a guard failure comes back as
 * { sent: false, error } with status 200, since a closed valve is a normal
 * outcome for the caller, not a transport error.
 */

import type { ActionFunctionArgs } from 'react-router'
import { desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { outreachProspects } from '../../db/schema'
import { assertTeamAuth } from '~/lib/team.server'
import { isProspectStatus, CONTACT_CHANNELS, type ContactChannel } from '~/lib/outreach-core'
import { sendOutreachEmail } from '~/lib/outreach.server'

function str(v: unknown, max = 1000): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'upsert-prospect') {
    const domain = str(b['domain'], 255)?.toLowerCase()
    if (!domain || !domain.includes('.')) {
      return new Response('Bad Request: domain required', { status: 400 })
    }
    const channel = (CONTACT_CHANNELS as readonly string[]).includes(b['contactChannel'] as string)
      ? (b['contactChannel'] as ContactChannel)
      : undefined
    const status = isProspectStatus(b['status']) ? b['status'] : undefined
    // Status is deliberately NOT in this patch. On an existing row it is a
    // lifecycle decision (a rejected/replied/landed prospect must never be
    // flipped back to queued by an upsert); the only way to move status is
    // the 'queue' op with its eligibility guard, or the send/inbox pipeline.
    const patch = {
      name:         str(b['name'], 255),
      contactEmail: str(b['contactEmail'], 255),
      contactChannel: channel,
      source:       str(b['source'], 64),
      policyNote:   str(b['policyNote'], 4000),
      notes:        str(b['notes'], 4000),
      suggestionId: typeof b['suggestionId'] === 'number' ? b['suggestionId'] : undefined,
    }
    const [existing] = await db
      .select({ id: outreachProspects.id })
      .from(outreachProspects)
      .where(eq(outreachProspects.domain, domain))
      .limit(1)
    if (existing) {
      const set: Record<string, unknown> = { updatedAt: new Date() }
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v
      await db.update(outreachProspects).set(set).where(eq(outreachProspects.id, existing.id))
      return Response.json({ id: existing.id, created: false })
    }
    const [row] = await db
      .insert(outreachProspects)
      .values({
        domain,
        name:           patch.name ?? null,
        contactEmail:   patch.contactEmail ?? null,
        contactChannel: patch.contactChannel ?? 'email',
        source:         patch.source ?? 'api',
        status:         status ?? 'new',
        policyNote:     patch.policyNote ?? null,
        notes:          patch.notes ?? null,
        suggestionId:   patch.suggestionId ?? null,
      })
      .returning({ id: outreachProspects.id })
    return Response.json({ id: row?.id, created: true })
  }

  if (b['op'] === 'list') {
    const status = isProspectStatus(b['status']) ? b['status'] : undefined
    const base = db.select().from(outreachProspects)
    const prospects = await (status ? base.where(eq(outreachProspects.status, status)) : base)
      .orderBy(desc(outreachProspects.updatedAt))
      .limit(200)
    return Response.json({ prospects })
  }

  if (b['op'] === 'queue') {
    const id = typeof b['id'] === 'number' ? b['id'] : undefined
    const domain = str(b['domain'], 255)?.toLowerCase()
    if (!id && !domain) {
      return new Response('Bad Request: id or domain required', { status: 400 })
    }
    const where = id
      ? eq(outreachProspects.id, id)
      : eq(outreachProspects.domain, domain!)
    const [row] = await db
      .select({ id: outreachProspects.id, status: outreachProspects.status })
      .from(outreachProspects)
      .where(where)
      .limit(1)
    if (!row) return new Response('Not Found: prospect', { status: 404 })
    // Only pre-send states may be queued; a replied/landed/rejected row is a
    // human decision the API must not override.
    if (!['new', 'researching', 'on_hold', 'queued'].includes(row.status)) {
      return new Response(`Conflict: cannot queue a prospect in status '${row.status}'`, { status: 409 })
    }
    await db
      .update(outreachProspects)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(eq(outreachProspects.id, row.id))
    return Response.json({ ok: true, id: row.id })
  }

  if (b['op'] === 'send') {
    const prospectId = typeof b['prospectId'] === 'number' ? b['prospectId'] : undefined
    const subject = str(b['subject'], 300)
    const text = typeof b['text'] === 'string' && b['text'].trim() ? b['text'] : undefined
    if (!prospectId || !subject || !text) {
      return new Response('Bad Request: prospectId, subject, text required', { status: 400 })
    }
    const result = await sendOutreachEmail({ prospectId, subject, text })
    return Response.json(result)
  }

  return new Response('Bad Request', { status: 400 })
}
