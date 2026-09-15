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
 *
 * `{op:'update'}` validation (ticket #9336): the request body's `update` used
 * to be cast straight into RunUpdate with no runtime check, so a caller could
 * write any string as `status` -- RunUpdate's own type union was compile-time
 * only. Live rows show five stale spellings ('completed', 'success', 'done',
 * 'finished') that slipped through this way, backfilled in migration 098.
 * parseRunUpdate below validates `status` against the same RUN_STATUSES
 * allow-list api.team.event.tsx's `parseFinish` already uses (ticket #8027),
 * and -- also mirroring that fix -- always stamps `finished:true` when the
 * new status is a terminal one, so a caller that sets status:'succeeded'
 * without separately passing `finished:true` can no longer leave
 * finished_at permanently NULL.
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

/** Same allow-list as api.team.event.tsx's RUN_STATUSES (ticket #8027/#9336). */
const RUN_STATUSES = ['running', 'succeeded', 'failed', 'skipped', 'rolled_back'] as const
type RunStatus = (typeof RUN_STATUSES)[number]

/**
 * Validate + narrow a raw `update` payload into a RunUpdate. Rejects an
 * out-of-enum `status` instead of passing it through unchecked, and forces
 * `finished:true` whenever the new status is terminal (anything but
 * 'running'), so status and finished_at can no longer drift apart.
 */
export function parseRunUpdate(raw: unknown): { update: RunUpdate } | { error: string } {
  if (raw === undefined || raw === null) return { update: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Bad Request: update must be an object' }
  }
  const b = raw as Record<string, unknown>
  const update: RunUpdate = {}
  if (b['status'] !== undefined) {
    if (!(RUN_STATUSES as readonly string[]).includes(b['status'] as string)) {
      return { error: `Bad Request: unknown status '${String(b['status'])}'` }
    }
    update.status = b['status'] as RunStatus
    if (update.status !== 'running') update.finished = true
  }
  if (typeof b['currentPhase'] === 'string') update.currentPhase = b['currentPhase']
  if (typeof b['currentAgent'] === 'string') update.currentAgent = b['currentAgent']
  if (typeof b['summary'] === 'string') update.summary = b['summary']
  if (typeof b['prUrl'] === 'string') update.prUrl = b['prUrl']
  if (typeof b['error'] === 'string') update.error = b['error']
  if (b['finished'] === true) update.finished = true
  if (b['incrementAttempt'] === true) update.incrementAttempt = true
  return { update }
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'start') {
    const team = b['team']
    if (!isTeamId(team)) return new Response('Bad Request: unknown team', { status: 400 })
    const runType = typeof b['runType'] === 'string' && b['runType'].length <= 24 ? b['runType'] : team
    const id = await startRun(team, runType)
    // #5431(b): stamp a phase marker before returning the id, so a run that
    // dies before its first `op:'update'` still names where it stopped
    // instead of expiring with current_phase NULL. Evidence: runs 423/338/
    // 251/200/140 each auto-expired with BOTH current_phase and current_agent
    // NULL -- ~25h of wall clock producing no trace of what the run was doing.
    // A caller MAY name its own opening phase (e.g. "gate-check"); absent
    // that, default to a generic marker so the column is never blank.
    const phase = typeof b['phase'] === 'string' && b['phase'].length > 0 && b['phase'].length <= 48
      ? b['phase']
      : 'run-start'
    const agent = typeof b['agent'] === 'string' && b['agent'].length > 0 && b['agent'].length <= 48
      ? b['agent']
      : undefined
    await updateRun(id, { currentPhase: phase, ...(agent ? { currentAgent: agent } : {}) })
    return Response.json({ id })
  }

  if (b['op'] === 'update' && typeof b['id'] === 'number') {
    const parsed = parseRunUpdate(b['update'])
    if ('error' in parsed) return new Response(parsed.error, { status: 400 })
    await updateRun(b['id'] as number, parsed.update)
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
