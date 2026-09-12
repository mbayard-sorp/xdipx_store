/**
 * POST /api/team/vision-gate — server-side anatomy vision-gate check.
 *
 *   { imageUrl } -> VisionVerdict
 *   { imageBase64, mediaType } -> VisionVerdict
 *
 * Why this route exists (ticket #8989). scripts/gen-notebook-art.ts gates
 * every Notebook hero candidate through the same anatomy check the social
 * path uses (app/lib/social-vision-gate.server.ts) via `runVisionGateOnImage`,
 * whose default `callVision` builds `new Anthropic({ apiKey:
 * process.env.ANTHROPIC_API_KEY })` IN THE CALLER PROCESS. The scheduled
 * content sandbox carries no such key, so the gate failed closed on every
 * hero candidate and a hero-mandatory post could not publish (blocker #142,
 * content run 818, 2026-09-11; run 835 hit the same wall and had to route
 * around it through the social team's own image route/budget instead).
 *
 * This is the same shape ticket #4133 already proved for social images: the
 * sandbox POSTs here and the privileged call runs SERVER-SIDE, where the key
 * already lives, so no secret ever reaches the sandbox.
 *
 * Gated on the CONTENT team budget (`gate('content', runId)`), the way
 * api.team.social-image.tsx gates on 'social' — defense in depth on a
 * model-spend surface reachable with a team token. This route only judges an
 * already-generated candidate; it never generates or bills image spend
 * itself, so there is no image-cap check here (unlike the generate op on
 * api.team.social-image.tsx).
 *
 * Returns the VisionVerdict from runVisionGateOnImage / runVisionGate
 * unchanged, including `checkCompleted`, so a caller can tell a real anatomy
 * read from a check that never finished (auth/transport/timeout) apart from
 * a genuine fail — see that field's own doc comment in
 * social-vision-gate.server.ts.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, gate } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    const imageUrl = str(b['imageUrl'])
    const imageBase64 = str(b['imageBase64'])
    const mediaType = str(b['mediaType'])
    if (!imageUrl && !(imageBase64 && mediaType)) {
      return new Response('Bad Request: imageUrl, or imageBase64 + mediaType, required', { status: 400 })
    }

    // Money gate: the check is a Sonnet vision call, so it gates the same as
    // every other model-spend surface reachable with a team token.
    const gateResult = await gate('content', num(b['runId']))
    if (!gateResult.ok) {
      return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
    }

    const { runVisionGate, runVisionGateOnImage } = await import('~/lib/social-vision-gate.server')
    const verdict = imageUrl
      ? await runVisionGate(imageUrl)
      : await runVisionGateOnImage({ data: imageBase64!, mediaType: mediaType! })

    return Response.json(verdict, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    return apiError('team-vision-gate', err, 'vision-gate check failed')
  }
}
