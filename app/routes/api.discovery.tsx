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
  AUDIENCES,
  BUDGET_MAX,
  BUDGET_MIN,
  DEFAULT_BUDGET,
  MATTERS,
  MOODS,
  type Audience,
  type DiscoveryState,
  type Matters,
  type Mood,
} from '~/types/discovery'

const MOOD_SET = new Set<string>(MOODS)
const AUDIENCE_SET = new Set<string>(AUDIENCES)
const MATTERS_SET = new Set<string>(MATTERS)

function parseStateFromSearch(params: URLSearchParams): DiscoveryState {
  const mood = params.getAll('mood').filter(v => MOOD_SET.has(v)) as Mood[]
  const audience = params.getAll('audience').filter(v => AUDIENCE_SET.has(v)) as Audience[]
  const matters = params.getAll('matters').filter(v => MATTERS_SET.has(v)) as Matters[]
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
