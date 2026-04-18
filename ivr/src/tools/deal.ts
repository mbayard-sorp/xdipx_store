/**
 * readTodaysDeal — fetches the live daily deal from the xdipx Vercel app
 * via a shared-secret internal endpoint. Cached in-memory until next midnight
 * Pacific (matches the deal rotation cron) so heavy call volume doesn't
 * hammer the endpoint.
 */
const APP_URL = process.env['XDIPX_APP_URL'] ?? 'https://xdipx.com'
const SECRET = process.env['INTERNAL_API_SECRET'] ?? ''

export interface DealSummary {
  title: string
  tagline: string
  brand: string
  category: string
  dealPrice: number
  msrp: number
  mapPrice: number
  savingsPct: number
  inStock: boolean
  url: string
}

let cache: { deal: DealSummary | null; expiresAt: number } | null = null

function nextMidnightPT(): number {
  // Rough Pacific midnight — cache TTL not critical, just has to roll daily.
  const now = new Date()
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const midnight = new Date(pt)
  midnight.setHours(24, 0, 0, 0)
  return now.getTime() + (midnight.getTime() - pt.getTime())
}

export async function readTodaysDeal(): Promise<DealSummary | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.deal

  const res = await fetch(`${APP_URL}/api/internal/daily-deal`, {
    headers: { 'x-internal-secret': SECRET },
  })
  if (!res.ok) {
    throw new Error(`daily-deal fetch failed: ${res.status}`)
  }
  const body = (await res.json()) as { deal: DealSummary | null }
  cache = { deal: body.deal, expiresAt: nextMidnightPT() }
  return body.deal
}

/** Testing / admin helper — drops the cache so the next call re-fetches. */
export function resetDealCache(): void {
  cache = null
}
