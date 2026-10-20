/**
 * POST /api/team/ad-health-snapshot (ticket #16686, plan §9.2). Team-token
 * guarded, like every api.team.ad-* route.
 *
 * The daily ads routine records what it read through the Meta Ads MCP, so the
 * console can show it without calling Meta while a page loads.
 *
 * { op: 'record', channel: 'meta', kind, observedAt, payload, source? }
 *   kind is pixel | errors | activity | opportunity | anomaly | breakdown
 *   (account is also accepted; the hourly cron writes it). observedAt is when
 *   the reading was taken, ISO. payload is a JSON object up to 200 KB.
 *   source defaults to 'routine'.
 *   -> { ok: true, snapshot: { id, channel, kind, observedAt, source, createdAt } }
 * { op: 'latest', channel? }
 *   The newest snapshot per (channel, kind) from the last 15 days, and the
 *   newest breakdown per dimension.
 *   -> { ok: true, snapshots: SnapshotRow[], breakdowns: SnapshotRow[] }
 *
 * Payload shapes the console reads best (readers in
 * app/lib/ads/health-snapshots-core.ts accept the common MCP spellings too):
 *   pixel:       { datasetId, events: [{ event, emq, count24h, count7d }], leadEvents24h?, leadEvents7d? }
 *   errors:      { items: [{ level, id, name, severity, message }] }
 *   opportunity: { score, recommendations: [{ title, detail, impact }] }
 *   anomaly:     { items: [{ metric, direction, severity, message, object }] }
 *   activity:    { windowHours, items: [AdActivity fields, outOfBand?, why?] }
 *   breakdown:   { dimension: 'placement'|'age'|'gender', since, until,
 *                  rows: [{ adsetId, adsetName, slice, spendCents, impressions, linkClicks, leads }] }
 *
 * Writes only ad_health_snapshots. Never calls a platform, never touches
 * pipeline_settings.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { latestSnapshots, recordSnapshot } from '~/lib/ads/health-snapshots.server'
import { SnapshotValidationError, parseLatestInput, parseRecordInput } from '~/lib/ads/health-snapshots-core'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const op = b['op']
  if (op !== 'record' && op !== 'latest') {
    return Response.json({ error: 'op must be "record" or "latest"' }, { status: 400 })
  }

  try {
    if (op === 'record') {
      const input = parseRecordInput(b)
      const row = await recordSnapshot(input)
      const { payload: _payload, ...snapshot } = row
      return Response.json({ ok: true, snapshot })
    }
    const { channel } = parseLatestInput(b)
    const latest = await latestSnapshots(channel)
    return Response.json({ ok: true, ...latest })
  } catch (err) {
    if (err instanceof SnapshotValidationError) return Response.json({ error: err.message }, { status: 400 })
    return apiError('team-ad-health-snapshot', err, 'ad-health-snapshot op failed')
  }
}
