/**
 * /api/team/calendar — shared marketing calendar (reads + proposals + IG status).
 *
 *   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> { events: [...] }
 *   POST { op: 'propose', eventDate, name, type?, theme? } -> { id }  (status 'planned')
 *   POST { op: 'setStatus', id, status } -> { ok, id, status }        (IG-guarded)
 *
 * Every team routine reads this for today's theme/promo window. Proposals land
 * as 'planned' — merch-calendar / the owner activate them.
 *
 * The 'setStatus' op is the team-token path the social routine's Step 2a
 * campaign reconciliation needs to activate/close/skip its 'IG: ' rows. It is
 * hard-guarded to rows whose name starts with 'IG: ', both by a pre-check and
 * by the LIKE in the UPDATE's WHERE clause, so it can never mutate a homepage
 * (or any non-IG) calendar row. Broader status changes stay on the
 * admin-session route admin.marketing-calendar.tsx.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { and, eq, like } from 'drizzle-orm'
import { assertTeamAuth, listCalendar, proposeCalendarEvent } from '~/lib/team.server'
import { db } from '~/lib/db.server'
import { marketingCalendar } from '../../db/schema'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CALENDAR_STATUSES = ['planned', 'active', 'done', 'skipped'] as const
type CalendarStatus = (typeof CALENDAR_STATUSES)[number]
// Social Step 2a may only touch its own campaign rows. Every 'IG: ' row is
// named "IG: <campaign>"; nothing else on the calendar carries this prefix.
const IG_PREFIX = 'IG: '

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const params = new URL(request.url).searchParams
  const from = params.get('from') ?? undefined
  const to = params.get('to') ?? undefined
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return new Response('Bad Request: dates must be YYYY-MM-DD', { status: 400 })
  }
  const events = await listCalendar(from, to)
  return Response.json({ events }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'propose') {
    if (typeof b['eventDate'] !== 'string' || !DATE_RE.test(b['eventDate'])) {
      return new Response('Bad Request: eventDate must be YYYY-MM-DD', { status: 400 })
    }
    if (typeof b['name'] !== 'string' || !b['name']) {
      return new Response('Bad Request: name required', { status: 400 })
    }
    const type = b['type'] === 'holiday' || b['type'] === 'campaign' ? b['type'] : 'promo'
    const id = await proposeCalendarEvent({
      eventDate: b['eventDate'],
      name:      b['name'],
      type,
      theme:     typeof b['theme'] === 'string' ? b['theme'] : undefined,
    })
    return Response.json({ id })
  }

  if (b['op'] === 'setStatus') {
    const id = Number(b['id'])
    if (!Number.isInteger(id) || id <= 0) {
      return new Response('Bad Request: id must be a positive integer', { status: 400 })
    }
    const status = b['status']
    if (typeof status !== 'string' || !CALENDAR_STATUSES.includes(status as CalendarStatus)) {
      return new Response(
        `Bad Request: status must be one of ${CALENDAR_STATUSES.join('|')}`,
        { status: 400 },
      )
    }

    const [row] = await db
      .select({ id: marketingCalendar.id, name: marketingCalendar.name })
      .from(marketingCalendar)
      .where(eq(marketingCalendar.id, id))
      .limit(1)
    if (!row) {
      return new Response('Not Found: no calendar row with that id', { status: 404 })
    }
    if (!row.name.startsWith(IG_PREFIX)) {
      // The guard: this team-token op may only touch its own 'IG: ' rows.
      return new Response(
        `Forbidden: setStatus may only change 'IG: '-prefixed rows`,
        { status: 403 },
      )
    }

    // Guard again in the mutating query itself, so a non-IG row can never be
    // updated even if the row were renamed between the check and the write.
    await db
      .update(marketingCalendar)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(marketingCalendar.id, id), like(marketingCalendar.name, `${IG_PREFIX}%`)))
    return Response.json({ ok: true, id, status })
  }

  return new Response('Bad Request', { status: 400 })
}
