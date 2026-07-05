/**
 * GET /api/homepage-team/gate?excludeRun=<id>
 *
 * The scheduled cloud routine calls this BEFORE any paid step. Returns the kill
 * switch, today's spend, remaining $ budget, and the run-cap state. Guarded by
 * the team callback secret (x-team-secret / Bearer).
 *
 * excludeRun: the caller's own run id. The routine starts its run row before
 * gating, so without this the concurrency guard would refuse every run as
 * run_in_progress on its own row. Other running rows still lock.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth, gate } from '~/lib/homepage-team.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const raw = new URL(request.url).searchParams.get('excludeRun')
  const excludeRun = raw && /^\d+$/.test(raw) ? Number(raw) : undefined
  const result = await gate(excludeRun)
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
