/**
 * GET /api/team/status
 *
 * Read-only, store-wide operational snapshot (p0-6 auditability): every
 * team's gate() result (enabled, budget, run counts), the standalone valves,
 * and each team's most recent run. Aggregates what GET /api/team/gate already
 * exposes per team; it introduces no new information class.
 *
 * Auth note: the team token is a single shared secret held by all cloud-agent
 * secret stores (TEAM_TOKEN / HOMEPAGE_TEAM_TOKEN / CRON_SECRET fallback). It
 * is a broad ops credential, not a per-team or read-scoped one; treat this
 * endpoint's output accordingly.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { sql } from 'drizzle-orm'
import { assertTeamAuth, gate, getValve, TEAM_IDS } from '~/lib/team.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { db } from '~/lib/db.server'

interface LastRunRow {
  team: string
  id: number
  run_type: string
  status: string
  started_at: string
  finished_at: string | null
  summary: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)

  const [gates, lastRunsRes, valveEntries] = await Promise.all([
    Promise.all(TEAM_IDS.map(t => gate(t))),
    db.execute(sql`
      SELECT DISTINCT ON (team)
             team, id, run_type, status, started_at::text AS started_at,
             finished_at::text AS finished_at, summary
      FROM homepage_team_runs
      ORDER BY team, started_at DESC`),
    Promise.all(
      Object.entries(VALVE_KEYS).map(async ([name, key]) => [name, await getValve(key)] as const),
    ),
  ])

  const lastRuns = new Map(
    ((lastRunsRes.rows ?? []) as unknown as LastRunRow[]).map(r => [r.team, r]),
  )

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      teams: gates.map(g => ({ ...g, lastRun: lastRuns.get(g.team) ?? null })),
      valves: Object.fromEntries(valveEntries),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
