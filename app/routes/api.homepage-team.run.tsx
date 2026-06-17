/**
 * POST /api/homepage-team/run
 *
 * Run lifecycle for the dashboard.
 *   { op: 'start', runType?: 'merchandise'|'design'|'manual' } -> { id }
 *   { op: 'update', id, update: RunUpdate } -> { ok: true }
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, startRun, updateRun, type RunUpdate } from '~/lib/homepage-team.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'start') {
    const runType = b['runType'] === 'design' || b['runType'] === 'manual' ? b['runType'] : 'merchandise'
    const id = await startRun(runType as 'merchandise' | 'design' | 'manual')
    return Response.json({ id })
  }

  if (b['op'] === 'update' && typeof b['id'] === 'number') {
    await updateRun(b['id'] as number, (b['update'] ?? {}) as RunUpdate)
    return Response.json({ ok: true })
  }

  return new Response('Bad Request', { status: 400 })
}
