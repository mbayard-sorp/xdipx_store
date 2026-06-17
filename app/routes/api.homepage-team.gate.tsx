/**
 * GET /api/homepage-team/gate
 *
 * The scheduled cloud routine calls this BEFORE any paid step. Returns the kill
 * switch, today's spend, remaining $ budget, and the run-cap state. Guarded by
 * the team callback secret (x-team-secret / Bearer).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth, gate } from '~/lib/homepage-team.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const result = await gate()
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
