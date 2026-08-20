/**
 * POST /api/team/url-liveness
 *
 * Verify that candidate citation URLs resolve, from the server (which has open
 * egress) rather than the cloud sandbox (whose agent proxy blocks the
 * citation-source domains). Lets the content routine mechanically confirm a
 * Sources URL before appending it. See ticket #2417 and
 * app/lib/citation-liveness.server.ts.
 *
 *   { urls: string[], includeBody?: boolean } -> { results: LivenessResult[] }
 *
 * With `includeBody:true` each live html page also returns a readable-text
 * `excerpt` of its body (ticket #4285), so the accuracy gate can confirm the
 * page supports a claim from here when its own WebFetch is blocked by the
 * sandbox egress policy. Default (omitted/false) is status + title only.
 *
 * Only https URLs on the citation host allowlist are ever fetched; everything
 * else comes back live:false with a reason and no request is made. Team-token
 * auth required.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { MAX_LIVENESS_URLS, checkCitationUrls } from '~/lib/citation-liveness.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const raw = b['urls']
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Response('Bad Request: urls (non-empty array) required', { status: 400 })
  }
  if (raw.length > MAX_LIVENESS_URLS) {
    return new Response(`Bad Request: at most ${MAX_LIVENESS_URLS} urls per request`, { status: 400 })
  }
  const urls = raw.map((u) => (typeof u === 'string' ? u : String(u)))

  const includeBody = b['includeBody'] === true
  const results = await checkCitationUrls(urls, { includeBody })
  return Response.json({ results })
}
