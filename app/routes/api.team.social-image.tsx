/**
 * POST /api/team/social-image — server-side social image generation + rehost.
 *
 *   { op: 'generate', prompt, handle, archetype, mood, date, slide?,
 *     refImageUrl?, imageSize?, only?, caller?, runId?, + the scene axes }
 *       -> GenerateSocialImageResult { url, filename, provider, model }
 *   { op: 'cast', prompt, handle, mood, date, slide?, presenterImageUrl?,
 *     castSlug?, castSlugs?, productImageUrl?, extraImageUrls?, scale,
 *     count?, caller?, runId?, + the scene axes }
 *       -> GenerateCastCompositeResult { urls, filenames, costs, requestIds, plateRequestId? }
 *          plus bodyReferenceMissing?/handReferenceMissing?/warning?/productImageFellBack?
 *          (#10336, #10341, #11476)
 *          plus derivedLengthInches?/derivedScaleCue? when `handle` resolves to a
 *          product carrying `xdipx.specifications` (#10981)
 *          plus ok:false/reason when every candidate across both attempts was
 *          billed (`costs` populated) and dropped (`urls` empty) — a rehost
 *          fetch failure, a crop-to-zone refusal, or a vision-gate rejection.
 *          HTTP status stays 200 (spend already happened; `costs` still needs
 *          to reach the caller), so check the body, not just the status (#11463)
 *
 * THE SCENE AXES, on both ops (tickets #10479/#10480): bodyZone, contactMode,
 * cropScale and sceneLocation, each optional, each validated against the
 * single-source vocabulary in `app/lib/social-scene-vocab.ts` and stamped
 * onto the `social_media_assets` row as `axis:<key>=<value>` tags at ingest.
 * This route is where those choices are MADE, so this is where they are
 * persisted; `api.team.social-post`'s draft op resolves them back from the
 * asset by media URL rather than asking the drafting agent to restate them.
 * Two documentation-only attempts at the restate-them version (migrations 093
 * and 099) produced 0 populated rows out of 281.
 *
 * Why this route exists (ticket #4133). Image generation rehosts the result to
 * Shopify Files (`uploadMoodImageToShopifyFiles` -> `adminGraphQL`), which needs
 * `SHOPIFY_ADMIN_ACCESS_TOKEN` in the CALLER process. The scheduled cloud
 * sandbox does not carry the Admin token, so when `scripts/gen-social-image.ts`
 * imported `social-media.server` and ran the rehost locally it threw, and every
 * scheduled Instagram draft was born with a raw packshot URL that the publish
 * gate then blocked on image-provenance. The fix is the same shape the video
 * lane already uses: the sandbox POSTs here and the privileged call runs
 * SERVER-SIDE, where the Admin token already lives. No secret ever reaches the
 * sandbox and no rehost target changes. (The ticket floated Vercel Blob as an
 * alternative rehost target; running server-side already keeps the Admin token
 * out of the sandbox with a smaller diff, and either satisfies
 * `isGeneratedSocialAsset`, so the rehost target is left unchanged here.)
 *
 * Spend accounting (changed by ticket #8032): this route now owns the
 * `social-images` spend row itself, for both ops, instead of leaving it to
 * `scripts/gen-social-image.ts` (#887's original design). The CLI has no
 * node_modules in the scheduled cloud sandbox, so a sandbox-originated run
 * calls this route directly and the CLI's step-5 spend post never ran,
 * leaving generation invisible to the money gate and the daily image cap
 * (run 738, 2026-09-07: 11 images generated, gate still read spentCents:0).
 * `scripts/gen-social-image.ts` no longer posts its own spend for the same
 * reason double-logging would over-bill: this route is now the single owner
 * regardless of caller. The money gate is enforced here too as
 * defense-in-depth, because this is now a real spend surface reachable with
 * a team token — mirroring `api.team.video-job`'s enqueue ops.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, gate, recordEvent } from '~/lib/team.server'
import { SOCIAL_ARCHETYPES, type SocialArchetype } from '~/lib/social-media.server'
import { apiError } from '~/lib/api-error.server'
import { logImageCost } from '~/lib/token-log.server'
import { parseSceneAxes, requireSceneAxesForGeneration } from '~/lib/social-scene-vocab'
import { Sentry } from '~/lib/sentry.server'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ONLY_VALUES = ['atlas', 'fal', 'imagen'] as const

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
/**
 * imageSize is a fal `image_size` token OR a `{ width, height }` pair; the CLI
 * sends the platform pixel size as a pair. Forward it verbatim so aspect ratio
 * is unchanged from the pre-route local call.
 */
function imageSizeVal(v: unknown): string | { width: number; height: number } | undefined {
  if (typeof v === 'string' && v.length > 0) return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['width'] === 'number' && typeof o['height'] === 'number') {
      return { width: o['width'], height: o['height'] }
    }
  }
  return undefined
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    const op = b['op']
    if (op !== 'generate' && op !== 'cast') return new Response('Bad Request', { status: 400 })

    // Shared required fields.
    const prompt = str(b['prompt'])
    const handle = str(b['handle'])
    const mood = str(b['mood'])
    const date = str(b['date'])
    if (!prompt) return new Response('Bad Request: prompt required', { status: 400 })
    if (!handle) return new Response('Bad Request: handle required', { status: 400 })
    if (!mood) return new Response('Bad Request: mood required', { status: 400 })
    if (!date || !DATE_RE.test(date)) return new Response('Bad Request: date must be YYYY-MM-DD', { status: 400 })
    const slide = num(b['slide'])
    const caller = str(b['caller']) ?? 'social-media-manager'

    // The scene axes (ticket #10479/#10480). This is where they are CHOSEN,
    // so this is where they are validated and persisted: every value present
    // is checked against the single-source vocabulary in
    // `social-scene-vocab.ts` and stamped onto the library row at ingest, and
    // the draft op resolves them back by URL rather than asking the drafter
    // to restate them. Refusing here is cheap and correct (pre-spend, one
    // retry); refusing at draft time would strand an already-billed frame,
    // which is why that path backfills instead.
    const parsedAxes = parseSceneAxes(b)
    if (!parsedAxes.ok) return new Response(parsedAxes.error, { status: 400 })
    const sceneAxes = parsedAxes.axes

    // Required, not merely validated-if-present (ticket #10501). This route
    // is a direct team-token surface, so the CLI's own requirement
    // (scripts/gen-social-image.ts) is not enough by itself: a caller could
    // hit this route directly and route around it, leaving the asset
    // untagged the same way the routine's Step 5 template did before this
    // ticket. Refusing here is pre-spend (before `gate()` below) and costs
    // exactly one retry.
    const axesRequired = requireSceneAxesForGeneration(sceneAxes)
    if (!axesRequired.ok) return new Response(`Bad Request: ${axesRequired.error}`, { status: 400 })

    // Ticket #10560: captured once and reused below for the run-event sink,
    // rather than re-reading `b['runId']` a second time.
    const runId = num(b['runId'])

    // Money gate: generation spends real dollars, so gate before generating,
    // exactly like api.team.video-job's enqueue ops. The CLI already gates too;
    // this closes the hole a direct team-token call would otherwise open.
    const gateResult = await gate('social', runId)
    if (!gateResult.ok) {
      return Response.json({ error: 'gated', reason: gateResult.reason, gate: gateResult }, { status: 403 })
    }
    // Ticket #5429 fix 4: a positive social image cap no longer flips
    // gate().ok to false (it lets the rest of the run proceed instead), so
    // this generation call site has to check the cap itself rather than
    // trusting `ok` alone, or a cap-exceeded call would generate and bill
    // anyway. scripts/gen-social-image.ts already does this independently
    // (its own step 2); this route did not until now.
    if ((gateResult.maxImagesPerDay ?? 0) > 0 && gateResult.imagesToday >= (gateResult.maxImagesPerDay ?? 0)) {
      return Response.json({ error: 'gated', reason: 'over_image_cap', gate: gateResult }, { status: 403 })
    }

    if (op === 'cast') {
      let presenterImageUrl = str(b['presenterImageUrl'])
      let castPrompt = prompt
      let bodyReferenceMissing = false
      let handReferenceMissing = false
      let warning: string | undefined
      // Ticket #11476: the cast member's own hand reference, attached
      // automatically for a held contact mode via extraImageUrls, alongside
      // (never instead of) whatever the caller passes explicitly.
      let castExtraReferenceUrls: string[] = []
      const scale = str(b['scale'])

      // Presenter reference selection (ticket #10336). Same decision the CLI
      // makes since PR #1233, shared through social-cast-reference.server:
      // the crop scale picks the reference, and skinToneNote is stated in the
      // prompt rather than left for the model to invent. Both were dead code
      // on this route, which passed the portrait unconditionally.
      const castSlug = str(b['castSlug'])
      // Already enum-checked against the shared vocabulary above; `CropScale`
      // and the report's crop sets are both derived from that same list, so
      // this can no longer drift from what the report classifies on.
      const cropScale = sceneAxes.cropScale
      if (castSlug) {
        const { getApprovedCastMembers } = await import('~/lib/sanity.server')
        const { resolveCastReference } = await import('~/lib/social-cast-reference.server')
        const roster = await getApprovedCastMembers()
        // Never read an empty roster as "there are none": an unauthenticated
        // read of this dataset returned 1 of 8 once and the false zero reached
        // three binding documents.
        if (!roster.length) {
          return new Response('Bad Request: no approved cast members returned (check SANITY_API_TOKEN)', { status: 400 })
        }
        const member = roster.find(m => m.slug === castSlug)
        if (!member) {
          return new Response(`Bad Request: castSlug "${castSlug}" is not an approved cast member`, { status: 400 })
        }
        const resolved = resolveCastReference({ member, cropScale, prompt, contactMode: sceneAxes.contactMode })
        presenterImageUrl = resolved.presenterImageUrl
        castPrompt = resolved.prompt
        bodyReferenceMissing = resolved.bodyReferenceMissing
        handReferenceMissing = resolved.handReferenceMissing
        warning = resolved.warning
        castExtraReferenceUrls = resolved.extraReferenceUrls
      }

      // Product reference (ticket #10341). featuredMedia is sometimes the
      // retail carton, so when the caller gives a handle instead of a URL,
      // walk the media list for a bare-product frame.
      let productImageUrl = str(b['productImageUrl'])
      let productImageFellBack = false
      // Real-dimension scale cue (ticket #10981). Root cause of the
      // product-size-plausibility blocks (row 285, a Womanizer Beauty
      // rendered ~2x real size on a forearm): this route asked the caller
      // for a free-text `scale` and never consulted the real numbers already
      // sitting in Shopify (`xdipx.specifications`), so a composite with no
      // hand in frame had nothing to anchor it. Derived whenever a handle is
      // present, independent of whether the caller also supplied an explicit
      // productImageUrl, because the size problem exists either way.
      let derivedScaleCue: string | undefined
      let derivedLengthInches: number | undefined
      if (handle) {
        const { getProductByHandle, pickBareProductImage } = await import('~/lib/shopify.server')
        const product = await getProductByHandle(handle)
        if (!productImageUrl && product) {
          const picked = pickBareProductImage(product.images ?? [])
          if (picked.url) {
            productImageUrl = picked.url
            productImageFellBack = picked.fellBack
          }
        }
        // `Product` (app/types/index.ts) does not declare `specifications` in
        // its type even though `nodeToProduct` populates it from
        // `xdipx.specifications` when present; same cast precedent already
        // used to read this field off this same function's result in
        // scripts/generate-slate-2026-08-24.ts.
        const specs = (product as unknown as { specifications?: string[] } | null)?.specifications
        if (specs?.length) {
          const { lengthInchesFromSpecifications, scaleCueFromLengthInches } = await import('~/lib/social-media.server')
          const inches = lengthInchesFromSpecifications(specs)
          if (inches != null) {
            derivedLengthInches = inches
            derivedScaleCue = scaleCueFromLengthInches(inches, sceneAxes.bodyZone ?? null)
          }
        }
      }
      // Prepended, not appended: the trailing negative-prompt block is what
      // this composite tends to end on, same reasoning as `withProductScale`.
      // The caller's own `scale` (below) still applies on top of this via
      // `withProductScale` inside `generateCastComposite` — this is an
      // additive anchor, not a replacement for it.
      if (derivedScaleCue) {
        castPrompt = `${derivedScaleCue} ${castPrompt}`
      }

      if (!presenterImageUrl) return new Response('Bad Request: presenterImageUrl or castSlug required', { status: 400 })
      if (!productImageUrl) return new Response('Bad Request: productImageUrl required', { status: 400 })
      if (!scale) return new Response('Bad Request: scale required', { status: 400 })
      const callerExtraImageUrls = Array.isArray(b['extraImageUrls'])
        ? (b['extraImageUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : []
      // Ticket #11476: the cast hand reference rides alongside whatever the
      // caller passed explicitly, deduped so a caller that also names it via
      // `extraImageUrls` (e.g. the CLI's `--extra-ref`) does not send it twice.
      const extraImageUrls = [...new Set([...callerExtraImageUrls, ...castExtraReferenceUrls])]
      const count = num(b['count'])
      // Frame shape, not pixel size. Only the two social stills shapes are
      // accepted: 4:5 for the Instagram grid, 16:9 for X's timeline. Anything
      // else falls through to the 4:5 default rather than reaching the model,
      // so a typo degrades to Instagram's shape instead of an odd frame.
      const aspectRatio = b['aspectRatio'] === '16:9' ? '16:9' as const
        : b['aspectRatio'] === '4:5' ? '4:5' as const
        : undefined

      const { generateCastComposite } = await import('~/lib/social-media.server')
      const castSlugs = Array.isArray(b['castSlugs'])
        ? (b['castSlugs'] as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
        : castSlug ? [castSlug] : []

      const result = await generateCastComposite({
        prompt: castPrompt,
        handle,
        mood,
        date,
        presenterImageUrl,
        productImageUrl,
        scale,
        caller,
        ...(castSlugs.length ? { castSlugs } : {}),
        ...(Object.keys(sceneAxes).length ? { sceneAxes } : {}),
        ...(slide ? { slide } : {}),
        ...(count ? { count } : {}),
        ...(extraImageUrls?.length ? { extraImageUrls } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(bodyReferenceMissing ? { bodyReferenceMissing: true } : {}),
        ...(productImageFellBack ? { productImageFellBack: true } : {}),
      })

      // Log spend for every billed frame (mirrors what the CLI used to do in
      // its own process, #8032). One row per surviving candidate, keyed by
      // filename/requestId so a fal request id resolves to the exact asset it
      // produced; a remainder row for any billed-but-dropped candidate (failed
      // rehost or vision gate — still billed, #887); then any stage-1 plate.
      const frameCostKey = result.costs[0]?.costKey ?? 'fal/flux-2-edit'
      const framesBilled = result.costs[0]?.count ?? result.urls.length
      for (let i = 0; i < result.urls.length; i++) {
        await logImageCost({
          feature: 'social-images', model: frameCostKey, count: 1, caller,
          refId: result.filenames[i]!,
          ...(result.requestIds[i] ? { requestId: result.requestIds[i]! } : {}),
        })
      }
      const remainder = framesBilled - result.urls.length
      if (remainder > 0) {
        await logImageCost({ feature: 'social-images', model: frameCostKey, count: remainder, caller })
      }
      for (const plate of result.costs.slice(1)) {
        await logImageCost({
          feature: 'social-images', model: plate.costKey, count: plate.count, caller,
          ...(result.plateRequestId ? { requestId: result.plateRequestId } : {}),
        })
      }

      // Ticket #11463: every candidate across both attempts was billed and
      // dropped (a rehost fetch failure, a crop-to-zone refusal, or a
      // vision-gate rejection — the reproduced case), so this is a reportable
      // failure, not a success with nothing to show. `framesBilled > 0`
      // matters: a genuinely empty (unbilled) result stays a plain 200, same
      // as before this ticket.
      const billedButEmpty = result.urls.length === 0 && framesBilled > 0
      const dropReason = billedButEmpty
        ? (result.dropReasons?.length ? result.dropReasons.join('; ') : 'billed candidate(s) dropped for an unrecorded reason')
        : undefined
      if (billedButEmpty) {
        const summary = `[social-image:cast] ${handle}: billed ${framesBilled} candidate(s), shipped 0 — ${dropReason}`
        console.error(`[social-image] ${summary}`)
        if (runId != null) {
          try {
            await recordEvent({ runId, eventType: 'error', summary, agentRole: 'social-media-manager' })
          } catch (err) {
            console.error('[social-image] recordEvent failed (non-fatal):', err)
          }
        }
        try {
          Sentry.captureMessage(summary, 'warning')
        } catch (err) {
          console.error('[social-image] Sentry.captureMessage failed (non-fatal):', err)
        }
      }

      // Ticket #10560: the run is not blocked on a missing body reference or
      // a product-image fallback (a route cannot refuse without killing a
      // whole scheduled run), and the response field below was the ONLY
      // place either condition landed — nothing read it. Record it on the
      // caller's run timeline (readable at /admin/homepage-team) and to
      // Sentry, so it is visible without depending on a caller that echoes
      // and reads its own response. Both writes are non-fatal, matching
      // `tryIngestSocialAsset`'s contract: telemetry must never fail an
      // already-billed generation.
      if (bodyReferenceMissing || handReferenceMissing || productImageFellBack) {
        const parts = [
          ...(warning ? [warning] : []),
          ...(productImageFellBack ? ['Fell back to a packaging/retail-box frame; no bare-product image was available.'] : []),
        ]
        const summary = `[social-image:cast] ${handle}: ${parts.join(' ')}`
        if (runId != null) {
          try {
            await recordEvent({ runId, eventType: 'error', summary, agentRole: 'social-media-manager' })
          } catch (err) {
            console.error('[social-image] recordEvent failed (non-fatal):', err)
          }
        }
        try {
          Sentry.captureMessage(summary, 'warning')
        } catch (err) {
          console.error('[social-image] Sentry.captureMessage failed (non-fatal):', err)
        }
      }

      // The run is not blocked on a missing body reference (a route cannot
      // refuse without killing a whole scheduled run), but the routine has to
      // see it, so it rides back on the response too.
      return Response.json({
        ...result,
        // Ticket #11463: `ok:false` + `reason` on the billed-but-empty path,
        // so a caller that checks the response body (not just the HTTP
        // status, which stays 200 — the spend already happened and `costs`
        // still needs to reach the caller) cannot mistake this for success.
        // Absent entirely on the ordinary success path, matching every
        // existing caller's shape.
        ...(billedButEmpty ? { ok: false, reason: dropReason } : {}),
        ...(bodyReferenceMissing ? { bodyReferenceMissing: true } : {}),
        ...(handReferenceMissing ? { handReferenceMissing: true } : {}),
        ...(warning ? { warning } : {}),
        ...(productImageFellBack ? { productImageFellBack: true } : {}),
        // Ticket #10981: echoed so the run summary can quote what anchored
        // the prompt, and so a caller can assert against it in a test.
        ...(derivedLengthInches != null ? { derivedLengthInches } : {}),
        ...(derivedScaleCue ? { derivedScaleCue } : {}),
      })
    }

    // op === 'generate'
    const archetype = str(b['archetype'])
    if (!archetype || !(SOCIAL_ARCHETYPES as readonly string[]).includes(archetype)) {
      return new Response(`Bad Request: archetype must be one of ${SOCIAL_ARCHETYPES.join('|')}`, { status: 400 })
    }
    const only = str(b['only'])
    if (only && !(ONLY_VALUES as readonly string[]).includes(only)) {
      return new Response(`Bad Request: only must be one of ${ONLY_VALUES.join('|')}`, { status: 400 })
    }
    const refImageUrl = str(b['refImageUrl'])
    const imageSize = imageSizeVal(b['imageSize'])

    const { generateAndUploadSocialImage } = await import('~/lib/social-media.server')
    // logCost:true — this route is the single owner of the social-images spend
    // row (#8032; was `false` under #887's older CLI-owns-it design). Same
    // pattern already proven at api.admin.social-image.tsx's generate path.
    const result = await generateAndUploadSocialImage({
      prompt,
      handle,
      archetype: archetype as SocialArchetype,
      mood,
      date,
      caller,
      logCost: true,
      ...(Object.keys(sceneAxes).length ? { sceneAxes } : {}),
      ...(slide ? { slide } : {}),
      ...(refImageUrl ? { refImageUrl } : {}),
      ...(imageSize ? { imageSize } : {}),
      ...(only ? { only: only as 'atlas' | 'fal' | 'imagen' } : {}),
    })
    return Response.json(result)
  } catch (err) {
    return apiError('team-social-image', err, 'social-image op failed')
  }
}
