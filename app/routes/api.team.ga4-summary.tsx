/**
 * GET /api/team/ga4-summary[?windowDays=28]
 *
 * Traffic and ecommerce signals for every routine, over the team API, with no
 * GA4 connector attached to any cloud trigger. That last part is the point:
 * nine routines carry Gmail today and two also carry Drive and Calendar, and
 * this program is trying to shrink that surface, not add to it.
 *
 * Read `actionable`, not the metrics. It is false below the session floor,
 * where a delta is indistinguishable from one visitor behaving differently.
 * `verdict` is a sentence a routine can quote straight into a brief.
 */

import type { LoaderFunctionArgs } from 'react-router'

import { getGa4Summary, DEFAULT_WINDOW_DAYS } from '~/lib/ga4-summary.server'
import { assertTeamAuth } from '~/lib/team.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)

  const raw = new URL(request.url).searchParams.get('windowDays')
  const parsed = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : DEFAULT_WINDOW_DAYS
  // Clamp rather than reject: a routine asking for a silly window should get
  // usable numbers and get on with its run, not a 400 it has to handle.
  const windowDays = Math.min(Math.max(parsed, 1), 365)

  const summary = await getGa4Summary(windowDays)

  return Response.json(summary, {
    // The underlying module already caches for 10 minutes in KV; this stops an
    // edge or a routine's own HTTP layer adding a second, staler tier on top.
    headers: { 'Cache-Control': 'no-store' },
  })
}
