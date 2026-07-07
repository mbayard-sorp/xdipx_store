/**
 * /api/team/brief — the weekly store-wide strategy brief.
 *
 *   GET  -> { brief: { id, weekStart, brief, metricsJson, createdBy, createdAt } | null }
 *   POST { op: 'publish', weekStart, brief, metricsJson?, createdBy? } -> { id }
 *
 * Written by store-strategist at the end of the weekly strategy routine;
 * read by every team routine at run start. Publishing supersedes the
 * previously active brief. Briefs are advisory — they direct, they don't gate.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth, getActiveBrief, publishBrief } from '~/lib/team.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const brief = await getActiveBrief()
  return Response.json({ brief }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'publish') {
    const weekStart = b['weekStart']
    if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return new Response('Bad Request: weekStart must be YYYY-MM-DD', { status: 400 })
    }
    if (typeof b['brief'] !== 'string' || !b['brief']) {
      return new Response('Bad Request: brief required', { status: 400 })
    }
    const id = await publishBrief({
      weekStart,
      brief:       b['brief'],
      metricsJson: b['metricsJson'],
      createdBy:   typeof b['createdBy'] === 'string' ? b['createdBy'] : undefined,
    })
    return Response.json({ id })
  }

  return new Response('Bad Request', { status: 400 })
}
