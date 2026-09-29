/**
 * POST /api/team/publish-gate
 *
 *   { postId: number, referencePackshotUrl?: string } -> { id, gate: { verdict, reviewer, notes,
 *     featuresProduct, productHandle?, findings } }
 *
 * The publish-gate half of ticket #6916. Runs `social-publish-gate`'s
 * pre-publish review as a server-side model call instead of a spawned
 * subagent, which the scheduled social routine's execution context does not
 * have (see `app/lib/team-gates.server.ts` header comment for the full
 * context, the scope this first cut does and does not cover, and the runs
 * that confirmed the subagent path is unreachable).
 *
 * `routine-social-daily.md` Step 6.5 calls this once per gate-eligible draft
 * (Instagram/X only) in place of spawning `social-publish-gate`, then relays
 * the returned `gate` object verbatim to
 * `POST /api/team/social-post {op:'gate', id, gate:{...}}` exactly as
 * before. That relay step, and the deterministic re-check it performs
 * server-side before writing `approved`, are UNCHANGED: this route only
 * replaces where the verdict comes from, not how it is applied.
 *
 * `referencePackshotUrl` (ticket #9770) is an optional caller-supplied real
 * product photo, used to ground the vision pass's product-identity judgment
 * when the row's own `shopifyProductId` is unset (so `productHandle` cannot
 * resolve one server-side) but the caller already has a verified packshot for
 * the SKU the caption names, per `routine-social-daily.md` Step 5. It is
 * never required: omit it and the endpoint resolves a packshot from
 * `shopifyProductId` exactly as before.
 *
 * `mode: 'brief'` makes no model call and spends nothing on the API key. It
 * runs the same deterministic floor, verdict cache, packshot lookup,
 * asset-reuse precedent and owner adjudications as the default mode, then
 * returns either a ready verdict (`final: true`, relay it as-is) or the rubric
 * and post text a `social-publish-gate` subagent judges from on the Max
 * subscription (`final: false`). The social routine uses the brief first and
 * falls back to the default mode only when it cannot spawn a subagent.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { buildPublishGateBrief, preparePublishGate, runPublishGateCheck } from '~/lib/team-gates.server'
import { apiError } from '~/lib/api-error.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request: invalid JSON body', { status: 400 })
  }

  const postId = typeof body['postId'] === 'number' ? body['postId'] : Number(body['postId'])
  if (!Number.isFinite(postId) || postId <= 0) {
    return new Response('Bad Request: postId (positive integer) required', { status: 400 })
  }

  const referencePackshotUrl = typeof body['referencePackshotUrl'] === 'string' ? body['referencePackshotUrl'] : undefined

  const opts = referencePackshotUrl !== undefined ? { referencePackshotUrl } : {}

  try {
    if (body['mode'] === 'brief') {
      const brief = buildPublishGateBrief(await preparePublishGate(postId, opts))
      return Response.json(brief, { headers: { 'Cache-Control': 'no-store' } })
    }
    const result = await runPublishGateCheck(postId, opts)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    return apiError('team-publish-gate', err, 'publish-gate check failed')
  }
}
