/**
 * GET /api/team/gate?team=<id>[&excludeRun=<id>]
 *
 * Store-wide budget/kill-switch gate. Every team's scheduled routine calls
 * this BEFORE any paid step. Same contract as /api/homepage-team/gate plus a
 * required team param; the result adds `team` and `activeBriefId` (so the
 * routine knows to fetch the weekly strategy brief).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth, gate, isTeamId } from '~/lib/team.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const params = new URL(request.url).searchParams
  const team = params.get('team')
  if (!isTeamId(team)) return new Response('Bad Request: unknown team', { status: 400 })
  const raw = params.get('excludeRun')
  const excludeRun = raw && /^\d+$/.test(raw) ? Number(raw) : undefined
  const result = await gate(team, excludeRun)
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
