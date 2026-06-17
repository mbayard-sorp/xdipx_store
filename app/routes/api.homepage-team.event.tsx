/**
 * POST /api/homepage-team/event
 *
 * Append a step/message/decision to a run's activity feed (dashboard timeline +
 * conversation viewer). `transcriptRef` optionally points at a Vercel Blob key
 * holding the full verbatim transcript for that step.
 *
 *   { runId, eventType, summary, agentRole?, phase?, transcriptRef? }
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, recordEvent, type TeamEvent } from '~/lib/homepage-team.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (typeof b['runId'] !== 'number' || typeof b['summary'] !== 'string') {
    return new Response('Bad Request', { status: 400 })
  }
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined)
  const event: TeamEvent = {
    runId: b['runId'] as number,
    eventType: (s('eventType') as TeamEvent['eventType']) ?? 'step',
    summary: b['summary'] as string,
    ...(s('agentRole') ? { agentRole: s('agentRole')! } : {}),
    ...(s('phase') ? { phase: s('phase')! } : {}),
    ...(s('transcriptRef') ? { transcriptRef: s('transcriptRef')! } : {}),
  }
  await recordEvent(event)
  return Response.json({ ok: true })
}
