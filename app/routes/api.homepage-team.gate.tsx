/**
 * GET /api/homepage-team/gate?excludeRun=<id>
 *
 * The scheduled cloud routine calls this BEFORE any paid step. Returns the kill
 * switch, today's spend, remaining $ budget, and the run-cap state. Guarded by
 * the team callback secret (x-team-secret / Bearer).
 *
 * excludeRun: the caller's own run id (from /run op:start). The playbook starts
 * the run row before gating, so without this the caller self-blocks with
 * reason 'run_in_progress'. The lock still applies to every other run.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth, gate } from '~/lib/homepage-team.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const raw = new URL(request.url).searchParams.get('excludeRun')
  const excludeRun = raw != null && /^\d+$/.test(raw) ? parseInt(raw, 10) : undefined
  const result = await gate(excludeRun)
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
