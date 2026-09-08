/**
 * POST /api/team/event
 *
 * Activity feed for any team's runs, plus cross-team read visibility for the
 * store-strategist's weekly retro.
 *   { op: 'record', runId, summary, eventType?, agentRole?, phase?, transcriptRef?, finish? } -> { ok }
 *   { op: 'list', team?, sinceDays? } -> { events: [...] }  (newest first)
 *
 * `finish` (ticket #8027): an optional same-request run-finish, so the LAST
 * retro event and the run's finish update travel in one HTTP call instead of
 * two separate ones. Three video-lane runs (writers-room #633/#654,
 * video-render #666) each posted a full retro event trail and then never
 * made the separate `POST /api/team/run {op:'update', finished:true, ...}`
 * call that followed it in the playbook -- a session death (turn/token
 * budget exhausted, container torn down) landing in the gap between the two
 * calls reads identically to a genuine hang, and the idle reaper marks a run
 * that did real, completed work 'auto-expired' hours later. Passing `finish`
 * on the last `record` call removes that gap: nothing else has to happen
 * after this request for the run to close cleanly.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, isTeamId, listRecentEvents, recordEvent, updateRun, type RunUpdate } from '~/lib/team.server'

const EVENT_TYPES = ['step', 'message', 'tool', 'decision', 'error'] as const
type EventType = (typeof EVENT_TYPES)[number]

const RUN_STATUSES = ['running', 'succeeded', 'failed', 'skipped', 'rolled_back'] as const
type RunStatus = (typeof RUN_STATUSES)[number]

/** Parse the optional `finish` payload into a RunUpdate, or undefined if absent/malformed. */
function parseFinish(raw: unknown): RunUpdate | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const f = raw as Record<string, unknown>
  const update: RunUpdate = { finished: true }
  if ((RUN_STATUSES as readonly string[]).includes(f['status'] as string)) {
    update.status = f['status'] as RunStatus
  }
  if (typeof f['summary'] === 'string') update.summary = f['summary']
  if (typeof f['prUrl'] === 'string') update.prUrl = f['prUrl']
  if (typeof f['error'] === 'string') update.error = f['error']
  return update
}

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
    const finish = parseFinish(b['finish'])
    if (finish) await updateRun(b['runId'] as number, finish)
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
