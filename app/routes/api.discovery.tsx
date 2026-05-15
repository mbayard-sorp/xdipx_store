/**
 * GET /api/discovery — refilter rails for the home page chip selections.
 *
 * Query params (all optional, repeated values for multi-select):
 *   mood=Sensual&mood=Playful
 *   audience=Us
 *   matters=Body-Safe%20Silicone
 *   budget=200          (default 200, clamped to 20..300)
 *   variant=a|b         (perRail = 4 for A; 4 then 3 for B handled client-side)
 *
 * Returns:
 *   { rails: [{ category, score, total, items: [{ product, score }] }],
 *     total, hasAny }
 *
 * Client uses this to live-update the rails after each chip toggle without
 * a full route navigation. The home loader still SSRs the unselected state
 * so crawlers and no-JS users see something meaningful.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getDiscoveryRails } from '~/lib/discovery.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import {
  BUDGET_MAX,
  BUDGET_MIN,
  DEFAULT_BUDGET,
  type DiscoveryState,
} from '~/types/discovery'
import { normalizeTag } from '~/lib/discovery-tags'

const MAX_CHIPS_PER_GROUP = 20  // hard cap to prevent abuse via crafted URLs

function cleanIncoming(params: URLSearchParams, key: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of params.getAll(key)) {
    if (raw.length > 80) continue
    const v = normalizeTag(raw)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= MAX_CHIPS_PER_GROUP) break
  }
  return out
}

function parseStateFromSearch(params: URLSearchParams): DiscoveryState {
  const mood = cleanIncoming(params, 'mood')
  const audience = cleanIncoming(params, 'audience')
  const matters = cleanIncoming(params, 'matters')
  const rawBudget = Number(params.get('budget'))
  const budget = Number.isFinite(rawBudget)
    ? Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, rawBudget))
    : DEFAULT_BUDGET
  return { mood, audience, matters, budget, step: 0 }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const rl = await checkRateLimit(request, 'discovery', 60, 60)
  if (!rl.ok) return rateLimited()

  const url = new URL(request.url)
  const state = parseStateFromSearch(url.searchParams)
  const variant = url.searchParams.get('variant') === 'b' ? 'b' : 'a'

  const { rails, total } = await getDiscoveryRails(state, {
    perRail:   variant === 'b' ? 4 : 4,
    dropEmpty: variant === 'b',
  })

  const hasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0

  return Response.json(
    { rails, total, hasAny, variant },
    {
      headers: {
        // Short edge cache for repeated identical filter combos. Vary on
        // the URL implicitly (query string is part of the cache key).
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  )
}
