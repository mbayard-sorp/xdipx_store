/**
 * POST /api/homepage-team/run
 *
 * Run lifecycle for the dashboard.
 *   { op: 'start', runType?: 'merchandise'|'design'|'manual', phase?, agent? } -> { id }
 *   { op: 'update', id, update: RunUpdate } -> { ok: true }
 *
 * op:'start' stamps current_phase (default 'run-start') before returning, so a
 * run that dies pre-first-update never auto-expires with a NULL phase (#5604,
 * mirroring the twin api.team.run.tsx from #5431).
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
    // #5604: mirror the twin api.team.run.tsx (#5431) -- stamp a phase marker
    // before returning the id, so a run started here that dies before its
    // first op:'update' still names where it stopped instead of auto-expiring
    // with current_phase NULL (the log-monitor "phase: unknown" alert class).
    // A caller MAY name its own opening phase/agent; absent that, default to a
    // generic marker so the column is never blank.
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
    await updateRun(b['id'] as number, (b['update'] ?? {}) as RunUpdate)
    return Response.json({ ok: true })
  }

  return new Response('Bad Request', { status: 400 })
}
