/**
 * GET /api/team/lead-funnel-report?days=30&list=<klaviyo list id>
 *
 * Team-token auth. Leads on the paid-leads Klaviyo list grouped by utm_content
 * and interest, with lead-to-order rate and revenue (Placed Order after
 * lead_captured_at), plus order_attribution and GA4 Door B counts. Reads at most
 * 1000 leads per request; the response says when it hit that cap.
 * Ticket #16145.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { buildLeadFunnelReport } from '~/lib/lead-funnel-report.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const url = new URL(request.url)
  const days = Number(url.searchParams.get('days') ?? '30')
  const report = await buildLeadFunnelReport({
    windowDays: Number.isFinite(days) ? days : 30,
    listId: url.searchParams.get('list'),
  })
  return Response.json(report)
}
