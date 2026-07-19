/**
 * GET /api/sensation-map — resolve one Sensation Map dial state to products.
 *
 * Query params:
 *   type=vibrator        (required; one of PRODUCT_TYPE_DIALS)
 *   feel=Sensual         (optional; a live mood tag, normalized. Omit = any)
 *
 * Returns the SensationMatch shape:
 *   { items: DiscoveryProduct[], relaxed, relaxedReason, resolved: {type, feel} }
 *
 * The homepage instrument SSRs its default state from the loader; each dial
 * change re-queries here via useFetcher (no useEffect-fetch). Distinct from
 * /api/discovery on purpose: that endpoint returns category rails, this returns
 * a flat, never-empty matched set with relaxation metadata. The shared machinery
 * is the discovery index + `scoreProduct`, not the endpoint.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { matchSensationMapState } from '~/lib/sensation-map.server'
import { normalizeTag } from '~/lib/discovery-tags'
import { PRODUCT_TYPE_DIALS, type ProductTypeDial } from '~/types'

export async function loader({ request }: LoaderFunctionArgs) {
  // 120 req / 60s — a browsing visitor toggles dials a handful of times; leaves
  // wide headroom while still catching scraping. Mirrors /api/discovery.
  const rl = await checkRateLimit(request, 'sensation-map', 120, 60)
  if (!rl.ok) return rateLimited()

  const url = new URL(request.url)

  const rawType = url.searchParams.get('type') ?? ''
  if (!(PRODUCT_TYPE_DIALS as readonly string[]).includes(rawType)) {
    return Response.json({ error: 'invalid or missing type' }, { status: 400 })
  }
  const type = rawType as ProductTypeDial

  // Feel is optional; normalize to the same canonical form the index uses so it
  // matches indexed mood tags. An unknown/blank value degrades to "any feel"
  // (the matcher still resolves, never empty).
  const rawFeel = url.searchParams.get('feel')
  const feel = rawFeel ? (normalizeTag(rawFeel) || null) : null

  const match = await matchSensationMapState({ type, feel })

  return Response.json(match, {
    headers: {
      // Short edge cache for repeated identical dial combos; the query string is
      // part of the cache key. Matches /api/discovery.
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  })
}
