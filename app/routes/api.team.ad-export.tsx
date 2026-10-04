/**
 * POST /api/team/ad-export (Ad Studio v2, PR-E). Team-token guarded.
 *
 * { op: 'build', creativeIds: number[] } or { op: 'build', ideaId: number }
 *   Builds the lane's export (Search Editor CSV, Meta paused draft payload,
 *   banner zip) for hearted creatives, stores it, and returns the summary plus a
 *   download URL (csv, zip) or the payload (Meta). Refuses with 422 and the
 *   reasons when a gate block or a lane policy rule fails.
 * { op: 'status', creativeIds?: number[], ideaId?: number }
 *   -> { ok, exports: [{ creativeId, state, filename, url, error, externalAdId }] }
 *
 * There is deliberately NO push op. Creating anything in a platform is an admin
 * route action behind requireAdmin, and only while ads_spend_enabled is on. The
 * team token can build files and read status, nothing else.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { ExportRefusal } from '~/lib/ad-export/common'
import { buildExport, getExportStatus, type ExportTarget } from '~/lib/ad-export/service.server'

const BUILD_MAX = 24

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

function intList(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const out = v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0)
  return out.length === v.length ? out : null
}

function targetOf(b: Record<string, unknown>): ExportTarget | Response {
  const ids = b['creativeIds'] == null ? undefined : intList(b['creativeIds'])
  if (ids === null) return bad('creativeIds must be an array of integers')
  const ideaId = b['ideaId']
  if (ideaId != null && (typeof ideaId !== 'number' || !Number.isInteger(ideaId) || ideaId <= 0)) return bad('ideaId must be a positive integer')
  if (ids?.length && ideaId != null) return bad('Pass creativeIds or ideaId, not both')
  if (ids?.length) {
    if (ids.length > BUILD_MAX) return bad(`At most ${BUILD_MAX} creatives per call`)
    return { creativeIds: ids }
  }
  if (typeof ideaId === 'number') return { ideaId }
  return bad('Pass creativeIds or ideaId')
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const op = b['op']

  try {
    if (op === 'build') {
      const t = targetOf(b)
      if (t instanceof Response) return t
      try {
        const out = await buildExport(t, 'agent')
        return Response.json({
          ok: true,
          lane: out.lane,
          exporter: out.exporter,
          filename: out.filename,
          contentType: out.contentType,
          downloadUrl: out.url,
          bytes: out.bytes,
          summary: out.summary,
          creativeIds: out.creativeIds,
          ...(out.payload !== undefined ? { payload: out.payload } : {}),
        })
      } catch (err) {
        if (err instanceof ExportRefusal) {
          const status = err.code === 'not_found' ? 404 : err.code === 'blob_not_configured' ? 503 : 422
          return Response.json({ ok: false, code: err.code, error: err.message, issues: err.issues }, { status })
        }
        throw err
      }
    }

    if (op === 'status') {
      const t = targetOf(b)
      if (t instanceof Response) return t
      return Response.json({ ok: true, exports: await getExportStatus(t) })
    }

    if (op === 'push') return Response.json({ error: 'push is not available on the team token. It is an admin action, and only while ads_spend_enabled is on.' }, { status: 403 })
    return bad('op must be build or status')
  } catch (err) {
    return apiError('team-ad-export', err, 'ad-export op failed')
  }
}
