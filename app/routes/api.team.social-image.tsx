/**
 * POST /api/team/social-image — server-side social image generation + rehost.
 *
 *   { op: 'generate', prompt, handle, archetype, mood, date, slide?,
 *     refImageUrl?, imageSize?, only?, caller?, runId? }
 *       -> GenerateSocialImageResult { url, filename, provider, model }
 *   { op: 'cast', prompt, handle, mood, date, slide?, presenterImageUrl,
 *     productImageUrl, extraImageUrls?, scale, count?, caller?, runId? }
 *       -> GenerateCastCompositeResult { urls, filenames, costs, requestIds, plateRequestId? }
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
import { assertTeamAuth, gate } from '~/lib/team.server'
import { SOCIAL_ARCHETYPES, type SocialArchetype } from '~/lib/social-media.server'
import { apiError } from '~/lib/api-error.server'
import { logImageCost } from '~/lib/token-log.server'

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

    // Money gate: generation spends real dollars, so gate before generating,
    // exactly like api.team.video-job's enqueue ops. The CLI already gates too;
    // this closes the hole a direct team-token call would otherwise open.
    const gateResult = await gate('social', num(b['runId']))
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
      const presenterImageUrl = str(b['presenterImageUrl'])
      const productImageUrl = str(b['productImageUrl'])
      const scale = str(b['scale'])
      if (!presenterImageUrl) return new Response('Bad Request: presenterImageUrl required', { status: 400 })
      if (!productImageUrl) return new Response('Bad Request: productImageUrl required', { status: 400 })
      if (!scale) return new Response('Bad Request: scale required', { status: 400 })
      const extraImageUrls = Array.isArray(b['extraImageUrls'])
        ? (b['extraImageUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
        : undefined
      const count = num(b['count'])
      // Frame shape, not pixel size. Only the two social stills shapes are
      // accepted: 4:5 for the Instagram grid, 16:9 for X's timeline. Anything
      // else falls through to the 4:5 default rather than reaching the model,
      // so a typo degrades to Instagram's shape instead of an odd frame.
      const aspectRatio = b['aspectRatio'] === '16:9' ? '16:9' as const
        : b['aspectRatio'] === '4:5' ? '4:5' as const
        : undefined

      const { generateCastComposite } = await import('~/lib/social-media.server')
      const result = await generateCastComposite({
        prompt,
        handle,
        mood,
        date,
        presenterImageUrl,
        productImageUrl,
        scale,
        caller,
        ...(slide ? { slide } : {}),
        ...(count ? { count } : {}),
        ...(extraImageUrls?.length ? { extraImageUrls } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
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

      return Response.json(result)
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
