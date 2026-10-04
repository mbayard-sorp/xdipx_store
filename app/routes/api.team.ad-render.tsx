/**
 * POST /api/team/ad-render (Ad Studio v2, PR-C). Team-token guarded.
 *
 * { op: 'enqueue', ideaIds: number[] (1 to 50) }
 *   One draft creative per (idea, format) for hearted ideas. Idempotent.
 *   -> { ok, created: [{ ideaId, creativeId, format, slogan, existing }], skipped: [{ ideaId, format?, reason }] }
 * { op: 'render', creativeIds: number[] (1 to 12 per call) }
 *   Renders sequentially: plate, composite, five gates, upload. Honors the ads
 *   team daily budget and skips with the reason when it is spent. Stops
 *   starting new creatives after ~240s so the function never hits its limit;
 *   the rest come back in `deferred` and stay queued.
 *   -> { ok, results: [{ creativeId, status, skipped?, error?, gates?, assetUrl?, costUsd? }], deferred }
 * { op: 'status', creativeIds?: number[], ideaId?: number }
 *   -> { ok, creatives: [...] }
 *
 * A fully rendered idea moves hearted to rendered from the render path itself.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { enqueueRenders, getCreativeStatus, renderCreatives, RENDER_CALL_CAP } from '~/lib/ad-render.server'

const ENQUEUE_MAX = 50
const WALL_CLOCK_MS = 240_000

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

function intList(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const out = v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0)
  return out.length === v.length ? out : null
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const op = b['op']

  try {
    if (op === 'enqueue') {
      const ids = intList(b['ideaIds'])
      if (!ids || ids.length === 0) return bad('ideaIds must be a non-empty array of integers')
      if (ids.length > ENQUEUE_MAX) return bad(`At most ${ENQUEUE_MAX} ideas per call`)
      const res = await enqueueRenders(ids, 'agent')
      return Response.json({ ok: true, ...res })
    }

    if (op === 'render') {
      const ids = intList(b['creativeIds'])
      if (!ids || ids.length === 0) return bad('creativeIds must be a non-empty array of integers')
      if (ids.length > RENDER_CALL_CAP) return bad(`At most ${RENDER_CALL_CAP} creatives per call`)
      const res = await renderCreatives(ids, { budgetMs: WALL_CLOCK_MS, force: b['force'] === true })
      return Response.json({ ok: true, results: res.outcomes, deferred: res.deferred })
    }

    if (op === 'status') {
      const ids = b['creativeIds'] == null ? undefined : intList(b['creativeIds'])
      if (ids === null) return bad('creativeIds must be an array of integers')
      const ideaId = b['ideaId']
      if (ideaId != null && (typeof ideaId !== 'number' || !Number.isInteger(ideaId))) return bad('ideaId must be an integer')
      if (!ids?.length && ideaId == null) return bad('Pass creativeIds or ideaId')
      const creatives = await getCreativeStatus({ ...(ids ? { creativeIds: ids } : {}), ...(typeof ideaId === 'number' ? { ideaId } : {}) })
      return Response.json({ ok: true, creatives })
    }

    return bad('op must be enqueue, render or status')
  } catch (err) {
    return apiError('team-ad-render', err, 'ad-render op failed')
  }
}
