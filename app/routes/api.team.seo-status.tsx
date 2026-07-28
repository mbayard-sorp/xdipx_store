/**
 * GET /api/team/seo-status[?fresh=1]
 *
 * The stored daily SEO diagnosis (seo_coverage_daily.notes), served as JSON so
 * agents whose egress is restricted to xdipx.com can read indexation state
 * without database access. Default is the last stored row (cheap); ?fresh=1
 * recomputes in-process, which fires live page probes and can file tickets, so
 * it is the deliberate exception rather than the default.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { getLatestSeoDaily, runSeoDaily } from '~/lib/seo-daily.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const fresh = new URL(request.url).searchParams.get('fresh') === '1'

  if (fresh) {
    const result = await runSeoDaily()
    return Response.json({ fresh: true, day: result.day, result }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const latest = await getLatestSeoDaily()
  if (!latest) {
    return Response.json(
      { fresh: false, day: null, result: null, note: 'no seo_coverage_daily row yet; /cron/seo-daily has not run' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return Response.json({ fresh: false, day: latest.day, result: latest.notes }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
