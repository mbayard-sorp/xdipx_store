/**
 * POST /api/team/social-asset-query — reuse-first search over social_media_assets.
 *
 * Closes the gap found on ticket #10658 (X zero-post day, 2026-09-21, split
 * into #10660): `routine-social-daily.md`'s reuse-first step has always
 * instructed the routine to query `social_media_assets` for a reusable
 * candidate before generating, but the only query implementation
 * (`listLibraryAssets` in social-studio.server.ts) sits behind
 * `/admin/socials/library`'s admin-session auth, which the scheduled
 * team-token sandbox cannot obtain, and the sandbox has no direct Neon
 * network path either. This route is a thin team-token-authed wrapper around
 * the same `listLibraryAssets` query so a scheduled run can reach it over
 * HTTP, the same shape `api.team.social-image.tsx` already uses to keep a
 * privileged/direct call server-side.
 *
 * { op: 'search', product?, cast?, archetype?, tag?, source?, picked?,
 *   generationBatchId?, requestId?, limit? }
 *   -> { assets: [{ id, url, width, height, aspect, archetype, productHandle,
 *        castSlugs, tags, source, createdAt, visionVerdict, visionVerdictAt,
 *        generationBatchId, providerRequestId }] }
 *
 * `generationBatchId` (#11009): a caller that lost the HTTP response from
 * `api.team.social-image.tsx`'s `cast` op (a platform-level timeout kill, not
 * a JS exception the route could catch and report) can look up every
 * candidate already billed and ingested under the batch id that response
 * would have carried, via `{op:'search', generationBatchId}`.
 *
 * `requestId` (#11022): the owner's feedback on library frames is keyed by
 * the provider (Atlas/fal) request id, which is stored on every ingested
 * candidate at generation time regardless of whether it survived the vision
 * gate or the crop-to-zone pass. A `{op:'search', requestId}` call resolves
 * one exactly, bypassing the `picked`/`dropped` defaults below (which exist
 * to scope a reuse-first search, not a "does this id exist" lookup) so a
 * gate-dropped or crop-rejected candidate is still reachable by its id.
 *
 * `picked` defaults to false: an asset already attached to any draft or post
 * is not free for reuse, so the default view is "never yet used" candidates
 * only. A caller that needs the full set (including already-picked rows) has
 * `/admin/socials/library` for that; this route stays scoped to reuse. A
 * `requestId` lookup skips this default (it wants the one row, picked or
 * not) unless `picked` is passed explicitly.
 *
 * This route does not itself apply the routine's mandatory freshness /
 * cast-rotation filter (instagram-campaigns.md §3.8) or re-run the vision
 * gate; it returns the raw candidate rows plus provenance so the caller
 * applies those checks before treating a candidate as usable, exactly as the
 * routine already requires for any reused asset. Read-only, so there is no
 * money gate here — no spend happens on this route.
 *
 * `excludeProductIdentityBlocked` (#11954): always on, unconditionally.
 * Reuse-first burned gate attempts on assets 720/728/730 (B-Swish Bthrilled
 * wand) that had a passing `visionVerdict` but got a publish-gate BLOCK on
 * product-identity every time they were offered — a mismatch the frame-only
 * vision check can't see, since it never compares against the actual SKU.
 * `applyPublishGateVerdict` now stamps such a BLOCK back onto the asset row
 * (`product_identity_failed_at`), and this route excludes any row carrying
 * that stamp, unlike `/admin/socials/library`, which still shows it.
 *
 * `excludeUnjudged` (#13173): always on, unconditionally. A row with no
 * recorded `visionVerdict` at all was never judged — the platform killed the
 * cast request (Vercel's 300s function ceiling) between ingest and the
 * vision gate, leaving a row that looks exactly like a fresh, reusable
 * candidate. Excluded here the same way a product-identity BLOCK is, unlike
 * `/admin/socials/library`, which still shows it for provenance.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { listLibraryAssets } from '~/lib/social-studio.server'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    if (b['op'] !== 'search') return new Response('Bad Request: op must be "search"', { status: 400 })

    const limitRaw = typeof b['limit'] === 'number' && Number.isFinite(b['limit']) ? b['limit'] : DEFAULT_LIMIT
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitRaw)))

    // A requestId lookup wants the one row by its provider id, regardless of
    // whether it was ever picked or was dropped by the crop-to-zone pass, so
    // it bypasses the reuse-first `picked`/`dropped` defaults below unless
    // the caller pins them explicitly.
    const requestId = str(b['requestId'])
    const picked = b['picked'] === true ? true : b['picked'] === false ? false : requestId ? null : false

    const page = await listLibraryAssets({
      q: requestId ?? '',
      tag: str(b['tag']),
      product: str(b['product']),
      cast: str(b['cast']),
      archetype: str(b['archetype']),
      source: str(b['source']),
      picked,
      before: null,
      archived: false,
      generationBatchId: str(b['generationBatchId']),
      dropped: requestId ? true : false,
      // #11954: this route is reuse-first by its own contract (see the module
      // doc above), so an asset the publish gate has already BLOCKed on
      // product-identity is never a valid candidate — it can't ship for this
      // SKU regardless of how many times it's offered.
      excludeProductIdentityBlocked: true,
      // #13173: a row with no recorded visionVerdict was never judged at
      // all (the platform killed the cast request between ingest and the
      // gate), not "checked and passed" — exclude it the same way an
      // unjudged row must never look like a free reuse candidate.
      excludeUnjudged: true,
    })

    const assets = page.assets.slice(0, limit).map(a => ({
      id: a.id,
      url: a.url,
      width: a.width,
      height: a.height,
      aspect: a.aspect,
      archetype: a.archetype,
      productHandle: a.productHandle,
      castSlugs: a.castSlugs ?? [],
      tags: a.tags ?? [],
      source: a.source,
      createdAt: a.createdAt,
      visionVerdict: a.visionVerdict ?? null,
      visionVerdictAt: a.visionVerdictAt ?? null,
      generationBatchId: a.generationBatchId ?? null,
      providerRequestId: a.providerRequestId ?? null,
    }))

    return Response.json({ assets })
  } catch (err) {
    return apiError('team-social-asset-query', err, 'social-asset-query op failed')
  }
}
