/**
 * POST /api/team/run
 *
 * Run lifecycle + read access for any store team.
 *   { op: 'start',  team, runType? }                      -> { id }
 *   { op: 'update', id, update: RunUpdate }               -> { ok: true }
 *   { op: 'get',    id }                                  -> { run: RunRow | null }
 *   { op: 'list',   team?, status?, sinceDays?, limit? }  -> { runs: RunRow[] }
 *
 * The two read ops exist because GET /api/team/status only surfaces
 * DISTINCT ON (team) the single most-recent run per team, so an older run that
 * is still status='running' and holding a team's concurrency lock
 * (isRunInProgress) goes invisible the moment a newer run starts for that team.
 * 'get' fetches any run by id regardless of recency; 'list' returns run rows
 * newest-first, filterable by team / status / sinceDays, so a caller can find
 * the specific status='running' row occupying the lock without inferring it
 * from event-log timing. See ticket #3235.
 *
 * The read queries are written inline here rather than added to team.server.ts:
 * that module holds team valves and spend controls and is a protected path, so
 * a read-op addition stays in the (unprotected) route, matching how sibling
 * api.team.* routes (status, calendar, outreach) query db directly.
 */

import type { ActionFunctionArgs } from 'react-router'
import { and, desc, eq, gte, type SQL } from 'drizzle-orm'
import { assertTeamAuth, isTeamId, startRun, updateRun, type RunUpdate } from '~/lib/team.server'
import { db } from '~/lib/db.server'
import { homepageTeamRuns } from '../../db/schema'

/** Max run rows returned by { op: 'list' } in one call. */
export const RUN_LIST_MAX = 100
/** Default run rows returned by { op: 'list' } when no limit is given. */
const RUN_LIST_DEFAULT = 25

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'start') {
    const team = b['team']
    if (!isTeamId(team)) return new Response('Bad Request: unknown team', { status: 400 })
    const runType = typeof b['runType'] === 'string' && b['runType'].length <= 24 ? b['runType'] : team
    const id = await startRun(team, runType)
    return Response.json({ id })
  }

  if (b['op'] === 'update' && typeof b['id'] === 'number') {
    await updateRun(b['id'] as number, (b['update'] ?? {}) as RunUpdate)
    return Response.json({ ok: true })
  }

  if (b['op'] === 'get') {
    if (typeof b['id'] !== 'number') return new Response('Bad Request: id required', { status: 400 })
    const rows = await db
      .select()
      .from(homepageTeamRuns)
      .where(eq(homepageTeamRuns.id, b['id'] as number))
      .limit(1)
    return Response.json({ run: rows[0] ?? null })
  }

  if (b['op'] === 'list') {
    const conditions: SQL[] = []

    const team = b['team']
    if (team !== undefined) {
      if (!isTeamId(team)) return new Response('Bad Request: unknown team', { status: 400 })
      conditions.push(eq(homepageTeamRuns.team, team))
    }

    const status = b['status']
    if (typeof status === 'string' && status.length > 0 && status.length <= 16) {
      conditions.push(eq(homepageTeamRuns.status, status))
    }

    const sinceDays = b['sinceDays']
    if (typeof sinceDays === 'number' && sinceDays > 0) {
      const cutoff = new Date(Date.now() - sinceDays * 86_400_000)
      conditions.push(gte(homepageTeamRuns.startedAt, cutoff))
    }

    const rawLimit = typeof b['limit'] === 'number' ? b['limit'] : RUN_LIST_DEFAULT
    const limit = Math.min(Math.max(1, Math.floor(rawLimit)), RUN_LIST_MAX)

    const rows = await db
      .select()
      .from(homepageTeamRuns)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(homepageTeamRuns.startedAt))
      .limit(limit)
    return Response.json({ runs: rows })
  }

  return new Response('Bad Request', { status: 400 })
}
