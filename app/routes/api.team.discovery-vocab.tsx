/**
 * GET /api/team/discovery-vocab
 *
 * Read-only, credential-free per-tag product counts across the three Ask
 * Emma vocab dimensions (mood / audience / matters), for cloud routines that
 * have a team token but no Shopify Admin credentials (ticket #5631).
 *
 * Why this exists: `buildDiscoveryIndex()` calls `adminGraphQL`, which needs
 * `SHOPIFY_ADMIN_ACCESS_TOKEN` in the caller process. That's absent from the
 * cloud checkout the homepage-designer / homepage-cro routines run in, so
 * "how many products actually carry mood tag X" — the single gate blocking a
 * finder concept from reaching build-ready — was unanswerable from the cloud
 * without a human running a script locally. This route runs SERVER-SIDE,
 * where the Admin token already lives (same shape as
 * `api.team.social-image.tsx`), and reads the already-built, KV/Neon-cached
 * discovery index (`getDiscoveryIndex()`) rather than triggering a live
 * Shopify crawl on every call.
 *
 * Response: { counts: [{ group, tag, productCount }], indexSize }.
 * `indexSize` is 0 on a cold cache miss (see `getDiscoveryIndex`'s own
 * contract) — the caller should treat that as "index not warm yet, retry
 * shortly" rather than "zero products carry any tag".
 */

import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { getDiscoveryIndex, computeVocabCounts } from '~/lib/discovery.server'
import { apiError } from '~/lib/api-error.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  try {
    const index = await getDiscoveryIndex()
    const counts = computeVocabCounts(index)
    return Response.json({ counts, indexSize: index.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return apiError('team-discovery-vocab', err, 'discovery-vocab lookup failed')
  }
}
