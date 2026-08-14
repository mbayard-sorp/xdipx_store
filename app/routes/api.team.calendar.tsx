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
 *
 * setStatus also enforces the calendar state machine (CALENDAR_TRANSITIONS,
 * ticket #3030). An edge not in the map is refused with 409, mirroring how the
 * suggestion bus rejects an illegal transition, so a routine cannot walk a row
 * backwards (done -> planned) or skip a state (planned -> done). Terminal
 * states ('done', 'skipped') have no outbound edges.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { and, eq, like } from 'drizzle-orm'
import { assertTeamAuth, listCalendar, proposeCalendarEvent } from '~/lib/team.server'
import { db } from '~/lib/db.server'
import { marketingCalendar } from '../../db/schema'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CALENDAR_STATUSES = ['planned', 'active', 'done', 'skipped'] as const
type CalendarStatus = (typeof CALENDAR_STATUSES)[number]
// The calendar state machine (ticket #3030). A campaign is proposed 'planned',
// activated, then either closed ('done') or, if it never ran, 'skipped'. Only
// these edges are legal; an edge not in the map is a 409, so a routine can
// neither reopen a finished campaign nor skip a state. Terminal states have no
// outbound edges. This is the single source of transition authority.
const CALENDAR_TRANSITIONS: Readonly<Record<CalendarStatus, readonly CalendarStatus[]>> = {
  planned: ['active', 'skipped'],
  active:  ['done'],
  done:    [],
  skipped: [],
}
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
      .select({ id: marketingCalendar.id, name: marketingCalendar.name, status: marketingCalendar.status })
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

    // The state machine (ticket #3030). Refuse any edge not in the map with a
    // 409, the way the suggestion bus refuses an illegal transition, so a
    // routine cannot reopen a finished campaign or skip a state. A same-status
    // call is not a declared edge and is refused too.
    const from = row.status as CalendarStatus
    if (!CALENDAR_TRANSITIONS[from]?.includes(status as CalendarStatus)) {
      return new Response(
        `Conflict: calendar row ${id} cannot move from '${from}' to '${status}'`,
        { status: 409 },
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
