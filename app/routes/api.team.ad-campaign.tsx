/**
 * POST /api/team/ad-campaign — PROPOSE-ONLY ad campaign writes.
 *
 *   { op: 'propose', platform, name, objective, plannedDailyCents?,
 *     plannedTotalCents?, audienceJson?, creativeJson?, policyCheck, runId? } -> { id }
 *   { op: 'list', status? } -> { campaigns: [...] }
 *
 * The ads-manager stub's only write path. Rows land in ad_campaigns with
 * status='proposed'; the owner approves/rejects from the dashboard, and launch
 * is a human action in-platform. `policyCheck` is REQUIRED — every proposal
 * must state which docs/ads-policy.md category it fits and why it complies
 * (this store sells sexual-wellness products; ad platforms restrict them
 * heavily and an unchecked campaign risks an account ban).
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, createAdCampaign, listAdCampaigns } from '~/lib/team.server'

const PLATFORMS = ['meta', 'x', 'google', 'reddit', 'other']

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'propose') {
    if (typeof b['platform'] !== 'string' || !PLATFORMS.includes(b['platform'])) {
      return new Response(`Bad Request: platform must be one of ${PLATFORMS.join('|')}`, { status: 400 })
    }
    if (typeof b['name'] !== 'string' || !b['name'] || typeof b['objective'] !== 'string' || !b['objective']) {
      return new Response('Bad Request: name and objective required', { status: 400 })
    }
    if (typeof b['policyCheck'] !== 'string' || b['policyCheck'].trim().length < 20) {
      return new Response(
        'Bad Request: policyCheck required — cite the docs/ads-policy.md category this campaign fits and why it complies',
        { status: 400 },
      )
    }
    const id = await createAdCampaign({
      platform:          b['platform'],
      name:              b['name'],
      objective:         b['objective'],
      plannedDailyCents: typeof b['plannedDailyCents'] === 'number' ? b['plannedDailyCents'] : 0,
      plannedTotalCents: typeof b['plannedTotalCents'] === 'number' ? b['plannedTotalCents'] : undefined,
      audienceJson:      b['audienceJson'],
      creativeJson:      b['creativeJson'],
      policyCheck:       b['policyCheck'],
      runId:             typeof b['runId'] === 'number' ? b['runId'] : undefined,
    })
    return Response.json({ id })
  }

  if (b['op'] === 'list') {
    const campaigns = await listAdCampaigns(typeof b['status'] === 'string' ? b['status'] : undefined)
    return Response.json({ campaigns })
  }

  return new Response('Bad Request', { status: 400 })
}
