/**
 * /api/team/calendar — shared marketing calendar (reads + proposals).
 *
 *   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> { events: [...] }
 *   POST { op: 'propose', eventDate, name, type?, theme? } -> { id }  (status 'planned')
 *
 * Every team routine reads this for today's theme/promo window. Proposals land
 * as 'planned' — merch-calendar / the owner activate them.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth, listCalendar, proposeCalendarEvent } from '~/lib/team.server'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

  return new Response('Bad Request', { status: 400 })
}
