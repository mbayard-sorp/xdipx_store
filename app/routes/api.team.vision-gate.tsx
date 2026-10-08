/**
 * POST /api/team/vision-gate — server-side anatomy / product-fidelity vision-gate check.
 *
 *   { imageUrl, assetId? } -> VisionVerdict (+ recorded:true, assetId when assetId given)
 *   { imageBase64, mediaType } -> VisionVerdict
 *   { verdict, assetId } -> VisionVerdict (+ recorded:true, assetId), record-only, no model call
 *   { mode: 'fidelity', imageBase64, mediaType, referenceImageBase64, referenceMediaType, team?, runId?, labelTolerant? } -> ProductFidelityVerdict
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
 * Gated on the CALLING team's budget (`gate(team, runId)`, `team` from the
 * request body, defaulting to 'content' for back-compat with the original
 * Notebook hero caller), the way api.team.social-image.tsx gates on 'social'
 * — defense in depth on a model-spend surface reachable with a team token.
 * This route only judges an already-generated candidate; it never generates
 * or bills image spend itself, so there is no image-cap check here (unlike
 * the generate op on api.team.social-image.tsx).
 *
 * The hardcoded `gate('content', runId)` this used to run unconditionally
 * broke the homepage path (ticket #11856, run 1099 2026-09-27): a homepage
 * generation posts its OWN runId, but that id belongs to the homepage team,
 * so it never excluded the sibling CONTENT run actually holding the lock —
 * every homepage vision-gate call failed closed whenever any unrelated
 * content-team run was in progress. `team` lets each caller gate on its own
 * lock instead of content's.
 *
 * Returns the VisionVerdict from runVisionGateOnImage / runVisionGate
 * unchanged, including `checkCompleted`, so a caller can tell a real anatomy
 * read from a check that never finished (auth/transport/timeout) apart from
 * a genuine fail — see that field's own doc comment in
 * social-vision-gate.server.ts.
 *
 * `assetId` (ticket #10511/#10560) is an opt-in: when given alongside
 * `imageUrl`, the fresh verdict is ALSO recorded onto that `social_media_assets`
 * row (via `regateAsset`), not merely returned. Before this, nothing could
 * refresh a stored verdict on an existing asset — it was written once at
 * generation and every check ever added to `VISION_CHECK_NAMES` afterward
 * invalidated it with no way to clear the backlog short of regenerating the
 * art. Omit `assetId` to keep the old judge-only behavior (imageBase64
 * candidates have no asset row yet to record against).
 *
 * `mode: 'fidelity'` (ticket #13333) is a second, independent check: whether
 * a rendered candidate stayed faithful to the real bare product reference it
 * was generated against (`app/lib/social-product-fidelity.server.ts`,
 * ticket #11487), not an anatomy read at all. `gateProductFidelityBuffer`'s
 * own default `callVision` builds the Anthropic client IN THE CALLER
 * PROCESS exactly like the anatomy gate's does, so it hit the same wall: a
 * cloud content run with no `ANTHROPIC_API_KEY` could never complete a
 * fidelity check, and `scripts/gen-notebook-art.ts`'s unconditional
 * upload-time check (ticket #13119) refused the upload rather than ship an
 * unchecked image, even on a run whose anatomy gate had completed cleanly
 * through its own remote fallback right above. Both images travel here as
 * base64 (the caller already fetched the reference locally, a plain
 * unauthenticated GET) rather than as a second url for this route to fetch,
 * mirroring the anatomy branch's own `imageBase64`/`mediaType` shape.
 * Returns the `ProductFidelityVerdict` from `runProductFidelityCheckOnImages`
 * unchanged, including `checkCompleted`, the same way the anatomy branch
 * returns `VisionVerdict` unchanged.
 *
 * `labelTolerant` (ticket #14309, fidelity mode only) is forwarded straight
 * through to `runProductFidelityCheckOnImages` as `{ labelTolerant: true }`:
 * the caller already decided the SKU is label-heavy
 * (`gen-notebook-art.ts`'s `--label-tolerant`), this route just relays the
 * choice to the check that actually builds the model prompt.
 *
 * `verdict` (ticket #13524, split off #13397 step 1-of-5) is a record-only
 * mode: pass an already-computed `VisionVerdict` (shape-validated against the
 * same `isValidVerdictShape` contract a model response has to pass) alongside
 * `assetId`, and this route skips the in-process Anthropic call entirely and
 * writes it straight through `recordVisionVerdict`, the same write the
 * model-driven branch below makes after its own call. A malformed or
 * incomplete verdict is rejected outright (400, nothing written), never
 * silently recorded as if it had been judged. #13397's own eventual aim is
 * moving vision judgment into each routine's own sandbox; this route only
 * grows the write-through seam for that, it does not do any of that
 * rewiring itself.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, gate, isTeamId, type TeamId } from '~/lib/team.server'
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
    const mode = str(b['mode'])
    const imageBase64 = str(b['imageBase64'])
    const mediaType = str(b['mediaType'])

    // Money gate: both checks are a Sonnet vision call, so both gate the
    // same as every other model-spend surface reachable with a team token.
    // `team` (ticket #11856) is the CALLER's own team, defaulting to
    // 'content' for the original Notebook hero caller, which never sends one.
    const teamParam = str(b['team'])
    const team: TeamId = teamParam && isTeamId(teamParam) ? teamParam : 'content'

    if (mode === 'fidelity') {
      const referenceImageBase64 = str(b['referenceImageBase64'])
      const referenceMediaType = str(b['referenceMediaType'])
      if (!imageBase64 || !mediaType) {
        return new Response('Bad Request: imageBase64 + mediaType required for a fidelity request', { status: 400 })
      }
      if (!referenceImageBase64 || !referenceMediaType) {
        return new Response('Bad Request: referenceImageBase64 + referenceMediaType required for a fidelity request', { status: 400 })
      }
      const runId = num(b['runId'])
      const gateResult = await gate(team, runId)
      if (!gateResult.ok) {
        return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
      }
      const { runProductFidelityCheckOnImages } = await import('~/lib/social-product-fidelity.server')
      const fidelityRefId = runId?.toString()
      // Ticket #14309. Branched (rather than always passing a trailing
      // `opts`/`refId`, possibly `undefined`) to keep this route's call to
      // runProductFidelityCheckOnImages at the exact arity a caller had
      // before this mode existed when neither refId nor labelTolerant is
      // set — api-team-vision-gate.test.ts asserts the call args exactly.
      const fidelityOpts = b['labelTolerant'] === true ? { labelTolerant: true } : undefined
      const verdict = fidelityOpts !== undefined
        ? fidelityRefId !== undefined
          ? await runProductFidelityCheckOnImages(
              { data: imageBase64, mediaType },
              { data: referenceImageBase64, mediaType: referenceMediaType },
              undefined,
              fidelityRefId,
              fidelityOpts,
            )
          : await runProductFidelityCheckOnImages(
              { data: imageBase64, mediaType },
              { data: referenceImageBase64, mediaType: referenceMediaType },
              undefined,
              undefined,
              fidelityOpts,
            )
        : fidelityRefId !== undefined
          ? await runProductFidelityCheckOnImages(
              { data: imageBase64, mediaType },
              { data: referenceImageBase64, mediaType: referenceMediaType },
              undefined,
              fidelityRefId,
            )
          : await runProductFidelityCheckOnImages(
              { data: imageBase64, mediaType },
              { data: referenceImageBase64, mediaType: referenceMediaType },
            )
      return Response.json(verdict, { headers: { 'Cache-Control': 'no-store' } })
    }

    const assetId = num(b['assetId'])

    // Record-only mode (ticket #13524): a pre-computed verdict skips the
    // in-process Anthropic call entirely. Shape-validated against the same
    // contract a model response has to pass; malformed/incomplete is
    // rejected outright (400), never silently recorded.
    const precomputedVerdict = b['verdict']
    if (precomputedVerdict !== undefined) {
      if (assetId == null) {
        return new Response('Bad Request: assetId required when passing a pre-computed verdict', { status: 400 })
      }
      const { isValidVerdictShape, enforceEnumeratedAnatomy, recordVisionVerdict } = await import(
        '~/lib/social-vision-gate.server'
      )
      if (!isValidVerdictShape(precomputedVerdict)) {
        return new Response('Bad Request: verdict did not match the expected VisionVerdict shape', { status: 400 })
      }
      const gateResult = await gate(team, num(b['runId']))
      if (!gateResult.ok) {
        return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
      }
      const verdict = enforceEnumeratedAnatomy({
        ...precomputedVerdict,
        checkedAt: new Date().toISOString(),
        checkCompleted: true,
      })
      await recordVisionVerdict(assetId, verdict)
      return Response.json({ ...verdict, recorded: true, assetId }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const imageUrl = str(b['imageUrl'])
    if (!imageUrl && !(imageBase64 && mediaType)) {
      return new Response('Bad Request: imageUrl, or imageBase64 + mediaType, required', { status: 400 })
    }

    const runId = num(b['runId'])
    const gateResult = await gate(team, runId)
    if (!gateResult.ok) {
      return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
    }

    const { runVisionGate, runVisionGateOnImage, regateAsset } = await import('~/lib/social-vision-gate.server')
    const refId = runId?.toString()
    const verdict = imageUrl
      ? assetId != null
        ? refId !== undefined
          ? await regateAsset(assetId, imageUrl, undefined, refId)
          : await regateAsset(assetId, imageUrl)
        : refId !== undefined
          ? await runVisionGate(imageUrl, undefined, refId)
          : await runVisionGate(imageUrl)
      : refId !== undefined
        ? await runVisionGateOnImage({ data: imageBase64!, mediaType: mediaType! }, undefined, refId)
        : await runVisionGateOnImage({ data: imageBase64!, mediaType: mediaType! })

    return Response.json(
      { ...verdict, ...(assetId != null ? { recorded: true, assetId } : {}) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof Response) return err
    return apiError('team-vision-gate', err, 'vision-gate check failed')
  }
}
