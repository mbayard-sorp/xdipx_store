/**
 * POST /api/team/event
 *
 * Activity feed for any team's runs, plus cross-team read visibility for the
 * store-strategist's weekly retro.
 *   { op: 'record', runId, summary, eventType?, agentRole?, phase?, transcriptRef? } -> { ok }
 *   { op: 'list', team?, sinceDays? } -> { events: [...] }  (newest first)
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, isTeamId, listRecentEvents, recordEvent } from '~/lib/team.server'

const EVENT_TYPES = ['step', 'message', 'tool', 'decision', 'error'] as const
type EventType = (typeof EVENT_TYPES)[number]

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'record') {
    if (typeof b['runId'] !== 'number' || typeof b['summary'] !== 'string' || !b['summary']) {
      return new Response('Bad Request: runId and summary required', { status: 400 })
    }
    const eventType = (EVENT_TYPES as readonly string[]).includes(b['eventType'] as string)
      ? (b['eventType'] as EventType)
      : 'step'
    await recordEvent({
      runId:         b['runId'] as number,
      eventType,
      summary:       b['summary'] as string,
      agentRole:     typeof b['agentRole'] === 'string' ? b['agentRole'] : undefined,
      phase:         typeof b['phase'] === 'string' ? b['phase'] : undefined,
      transcriptRef: typeof b['transcriptRef'] === 'string' ? b['transcriptRef'] : undefined,
    })
    return Response.json({ ok: true })
  }

  if (b['op'] === 'list') {
    const team = isTeamId(b['team']) ? b['team'] : undefined
    const sinceDays =
      typeof b['sinceDays'] === 'number' && b['sinceDays'] > 0 && b['sinceDays'] <= 90
        ? b['sinceDays']
        : 7
    const events = await listRecentEvents(team, sinceDays)
    return Response.json({ events })
  }

  return new Response('Bad Request', { status: 400 })
}
