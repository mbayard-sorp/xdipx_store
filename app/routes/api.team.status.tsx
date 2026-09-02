/**
 * GET /api/team/status
 *
 * Read-only, store-wide operational snapshot (p0-6 auditability): every
 * team's gate() result (enabled, budget, run counts), the standalone valves,
 * and each team's most recent run. Aggregates what GET /api/team/gate already
 * exposes per team; it introduces no new information class.
 *
 * Also carries `owner{}` and `health{}` from `computeOwnerQueue()` — the SAME
 * computation the daily digest and /admin/ops render. That is the point of
 * invariant 4: a routine reading this and the owner reading their email are
 * looking at one list, not two that drift.
 *
 * `health.laneFlow` is per-kind intake versus terminal over 14 days. The weekly
 * strategy run re-derives that by hand every Monday, and it is the number that
 * distinguishes "the fleet is failing" from "the fleet is succeeding into a
 * state nothing empties" — which was this whole program's founding diagnosis.
 *
 * Auth note: the team token is a single shared secret held by all cloud-agent
 * secret stores (TEAM_TOKEN / HOMEPAGE_TEAM_TOKEN / CRON_SECRET fallback). It
 * is a broad ops credential, not a per-team or read-scoped one; treat this
 * endpoint's output accordingly.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { sql } from 'drizzle-orm'
import { assertTeamAuth, gate, getValve, TEAM_IDS } from '~/lib/team.server'
import { computeOwnerQueue } from '~/lib/owner-queue.server'
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

  const [gates, lastRunsRes, valveEntries, ownerQueue] = await Promise.all([
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
    // Never let the queue take the whole endpoint down: this is the snapshot
    // every routine reads at Step 0, and a gate check that 500s because a
    // blocker query hiccuped would stop runs that had nothing to do with it.
    computeOwnerQueue().catch((err) => {
      console.warn('[api.team.status] owner queue unavailable', err)
      return null
    }),
  ])

  const lastRuns = new Map(
    ((lastRunsRes.rows ?? []) as unknown as LastRunRow[]).map(r => [r.team, r]),
  )

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      teams: gates.map(g => ({ ...g, lastRun: lastRuns.get(g.team) ?? null })),
      valves: Object.fromEntries(valveEntries),
      // null means the queue could not be computed this run. Distinct from an
      // empty queue, and a consumer must not read one as the other.
      owner: ownerQueue
        ? {
            generatedAt: ownerQueue.generatedAt,
            money: ownerQueue.money,
            entries: ownerQueue.entries,
            fingerprint: ownerQueue.fingerprint,
            gaps: ownerQueue.gaps,
          }
        : null,
      health: ownerQueue?.health ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
