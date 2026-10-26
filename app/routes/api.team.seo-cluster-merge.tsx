/**
 * POST /api/team/seo-cluster-merge
 *
 * Executes an owner-approved SEO cluster merge map (seoCluster consolidation)
 * server-side, deterministically. Ticket #17788: this is the team-API
 * equivalent of `npx tsx scripts/merge-seo-clusters.ts`, for callers whose
 * execution environment denies running that script directly (even in
 * dry-run) — so a routine never needs direct script-execution rights to run
 * a merge map a human has already approved on the bus.
 *
 * Body: { map: [{ canonical, absorb: string[], newTitle? }], apply?: boolean }
 * `apply` defaults to false (dry run — reports counts, writes nothing).
 * Gated by the `seo_curation_enabled` valve, same lane as the seo-curator
 * routine that proposes these maps.
 *
 * -> { ok: true, result: { applied, entries, totals } }
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { apiError } from '~/lib/api-error.server'
import { applySeoClusterMergeMap, isSeoClusterMergeMap } from '~/lib/seo-cluster-merge.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)

  const enabled = await getPipelineSetting('seo_curation_enabled')
  if (enabled !== 'true') {
    return Response.json({ ok: false, error: 'seo_curation disabled' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const { map, apply } = (body ?? {}) as { map?: unknown; apply?: unknown }
  if (!isSeoClusterMergeMap(map) || map.length === 0) {
    return Response.json(
      { ok: false, error: 'map must be a non-empty array of { canonical: string, absorb: string[], newTitle?: string }' },
      { status: 400 },
    )
  }

  try {
    const result = await applySeoClusterMergeMap(map, { apply: apply === true })
    return Response.json({ ok: true, result })
  } catch (err) {
    return apiError('api.team.seo-cluster-merge', err, 'seo cluster merge failed')
  }
}
