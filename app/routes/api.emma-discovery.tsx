import type { ActionFunctionArgs } from 'react-router'
import { getEmmaDiscovery, type DiscoveryArgs } from '~/lib/emma-discovery.server'
import { getCartIdFromCookie } from '~/lib/cart.server'
import { getCustomerToken } from '~/lib/customer-session.server'
import { getCart, getCustomerProfile } from '~/lib/shopify.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

const SHOPIFY_ENRICH_TIMEOUT_MS = 800

/**
 * POST /api/emma-discovery — returns the Emma discovery payload (greeting,
 * narrator, starred picks, refinements, did-you-mean) for the current
 * query/filter/candidate context on /search and /collections.
 *
 * Body: DiscoveryArgs (see emma-discovery.server.ts).
 *
 * Server-side enrichment: cart titles + past-ordered titles are fetched here
 * (not sent by the client) so Emma's narrator can reference them. Both are
 * wrapped in timeouts so Shopify latency never blocks the Haiku call.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rl = await checkRateLimit(request, 'emma-discovery', 30, 60)
  if (!rl.ok) return rateLimited()

  let body: DiscoveryArgs
  try {
    body = (await request.json()) as DiscoveryArgs
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!body || !Array.isArray(body.candidates) || (body.surface !== 'search' && body.surface !== 'collection')) {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const [cartTitles, orderedTitles] = await Promise.all([
    fetchCartTitles(request),
    fetchOrderedTitles(request),
  ])

  // Cap candidate volume to protect prompt size and latency.
  const safeArgs: DiscoveryArgs = {
    ...body,
    query:       typeof body.query === 'string' ? body.query.slice(0, 120) : '',
    candidates:  body.candidates.slice(0, 20),
    recentViews: Array.isArray(body.recentViews) ? body.recentViews.slice(0, 10) : [],
    filters:     body.filters ?? {},
    cartTitles,
    orderedTitles,
  }

  const result = await getEmmaDiscovery(safeArgs)
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=0, no-store',
    },
  })
}

// Reject GETs — this endpoint is POST-only.
export function loader() {
  return new Response('Not found', { status: 404 })
}

// ── Enrichment helpers ─────────────────────────────────────────────────────

async function fetchCartTitles(request: Request): Promise<string[]> {
  const cartId = getCartIdFromCookie(request)
  if (!cartId) return []
  try {
    const cart = await withTimeout(getCart(cartId), SHOPIFY_ENRICH_TIMEOUT_MS)
    if (!cart) return []
    const seen = new Set<string>()
    const titles: string[] = []
    for (const line of cart.lines) {
      const t = line.merchandise.product.title?.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      titles.push(t)
      if (titles.length >= 5) break
    }
    return titles
  } catch {
    return []
  }
}

async function fetchOrderedTitles(request: Request): Promise<string[]> {
  const customer = await getCustomerToken(request)
  if (!customer || customer.tokenType !== 'storefront') return []
  try {
    const profile = await withTimeout(getCustomerProfile(customer.token), SHOPIFY_ENRICH_TIMEOUT_MS)
    if (!profile?.orders?.length) return []
    const seen = new Set<string>()
    const titles: string[] = []
    for (const order of profile.orders.slice(0, 5)) {
      for (const item of order.lineItems) {
        const t = item.title?.trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        titles.push(t)
        if (titles.length >= 5) return titles
      }
    }
    return titles
  } catch {
    return []
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]) as Promise<T | null>
}
