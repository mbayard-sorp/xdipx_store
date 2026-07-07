/**
 * POST /api/team/run
 *
 * Run lifecycle for any store team.
 *   { op: 'start', team, runType? } -> { id }
 *   { op: 'update', id, update: RunUpdate } -> { ok: true }
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, isTeamId, startRun, updateRun, type RunUpdate } from '~/lib/team.server'

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

  return new Response('Bad Request', { status: 400 })
}
