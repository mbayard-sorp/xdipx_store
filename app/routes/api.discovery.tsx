/**
 * GET /api/discovery — refilter rails for the home page chip selections.
 *
 * Query params (all optional, repeated values for multi-select):
 *   mood=Sensual&mood=Playful
 *   audience=Us
 *   matters=Body-Safe%20Silicone
 *   budget=200          (default 200, clamped to 20..300)
 *   variant=a|b         (perRail = 12 for A — three rows of 4; 4 for B)
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
import { getDiscoveryRails, getDiscoveryRailPage } from '~/lib/discovery.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import {
  BUDGET_MAX,
  BUDGET_MIN,
  DEFAULT_BUDGET,
  CATEGORIES,
  type Category,
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

const RAIL_PAGE_SIZE_MAX = 24
const isCategory = (v: string | null): v is Category =>
  !!v && (CATEGORIES as readonly string[]).includes(v)

export async function loader({ request }: LoaderFunctionArgs) {
  // 120 req / 60s — a real user can hit ~15 in a normal browse session
  // (chip toggles + several "View more" clicks across rails), so this leaves
  // ~8x headroom while still catching scraping.
  const rl = await checkRateLimit(request, 'discovery', 120, 60)
  if (!rl.ok) return rateLimited()

  const url = new URL(request.url)
  const state = parseStateFromSearch(url.searchParams)
  const variant = url.searchParams.get('variant') === 'b' ? 'b' : 'a'

  // ── Single-rail pagination branch ──────────────────────────────────────
  // GET /api/discovery?category=Pleasure&offset=12&limit=12&...selections
  // Returns just one rail's next slice. Used by the rail "View more" CTA.
  const category = url.searchParams.get('category')
  if (isCategory(category)) {
    const offsetRaw = Number(url.searchParams.get('offset'))
    const limitRaw  = Number(url.searchParams.get('limit'))
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0
    const limit  = Number.isFinite(limitRaw)
      ? Math.min(RAIL_PAGE_SIZE_MAX, Math.max(1, Math.floor(limitRaw)))
      : 12
    const page = await getDiscoveryRailPage(state, category, offset, limit)
    return Response.json(
      { category, offset, limit, items: page.items, total: page.total },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    )
  }

  const { rails, total, available } = await getDiscoveryRails(state, {
    perRail:   variant === 'b' ? 4 : 12,
    dropEmpty: variant === 'b',
  })

  const hasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0

  return Response.json(
    { rails, total, hasAny, variant, available },
    {
      headers: {
        // Short edge cache for repeated identical filter combos. Vary on
        // the URL implicitly (query string is part of the cache key).
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  )
}
