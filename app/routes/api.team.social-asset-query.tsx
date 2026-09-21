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
 * { op: 'search', product?, cast?, archetype?, tag?, source?, picked?, limit? }
 *   -> { assets: [{ id, url, width, height, aspect, archetype, productHandle,
 *        castSlugs, tags, source, createdAt, visionVerdict, visionVerdictAt }] }
 *
 * `picked` defaults to false: an asset already attached to any draft or post
 * is not free for reuse, so the default view is "never yet used" candidates
 * only. A caller that needs the full set (including already-picked rows) has
 * `/admin/socials/library` for that; this route stays scoped to reuse.
 *
 * This route does not itself apply the routine's mandatory freshness /
 * cast-rotation filter (instagram-campaigns.md §3.8) or re-run the vision
 * gate; it returns the raw candidate rows plus provenance so the caller
 * applies those checks before treating a candidate as usable, exactly as the
 * routine already requires for any reused asset. Read-only, so there is no
 * money gate here — no spend happens on this route.
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

    const page = await listLibraryAssets({
      q: '',
      tag: str(b['tag']),
      product: str(b['product']),
      cast: str(b['cast']),
      archetype: str(b['archetype']),
      source: str(b['source']),
      picked: b['picked'] === true,
      before: null,
      archived: false,
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
    }))

    return Response.json({ assets })
  } catch (err) {
    return apiError('team-social-asset-query', err, 'social-asset-query op failed')
  }
}
