/**
 * GET /api/team/ai-source-orders[?days=7]
 *
 * Orders and revenue attributed to an AI assistant (ChatGPT, Perplexity,
 * Copilot, Bing chat, Gemini, Claude) in the trailing N days, queried live
 * against Shopify (ticket #12685). Team-token auth, same as every other
 * `/api/team/*` route.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { getAiSourceOrders } from '~/lib/ai-source-orders.server'

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)

  const raw = new URL(request.url).searchParams.get('days')
  const parsed = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : 7
  const windowDays = Math.min(Math.max(parsed, 1), 90)

  const result = await getAiSourceOrders(windowDays)

  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
