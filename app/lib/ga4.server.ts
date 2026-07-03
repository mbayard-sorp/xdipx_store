/**
 * GA4 Data API (analyticsdata.googleapis.com v1beta) — read-only engagement /
 * traffic signals for the autonomous homepage merchandising routine.
 *
 * Server-only. Auth mirrors imagen.server.ts: a base64-encoded service-account
 * key in GOOGLE_SERVICE_ACCOUNT_JSON (scope analytics.readonly), falling back to
 * Application Default Credentials locally. Uses google-auth-library + fetch — the
 * `googleapis` SDK is intentionally NOT a dependency. Never throws: returns
 * graceful zeroed signals so the routine falls back to heuristic merchandising.
 *
 * Requires GA4 access (see docs/homepage-team): the SA must have Viewer on the
 * property AND the Analytics Data API must be enabled in the SA's own GCP
 * project. Property comes from GA4_PROPERTY_ID (bare numeric, e.g. 532477050).
 */
import { GoogleAuth } from 'google-auth-library'
import { cached } from '~/lib/kv.server'

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const CACHE_TTL_SECONDS = 10 * 60

export interface HomepageSignals {
  /** false when GA4_PROPERTY_ID / service account is not set up at all. */
  isConfigured: boolean
  windowDays: number
  activeUsers: number
  sessions: number
  screenPageViews: number
  /** 0..1 */
  engagementRate: number
  topPages: Array<{ path: string; views: number }>
  topProductPages: Array<{ path: string; views: number }>
  /** Ecommerce totals, zeroed when the property has no ecommerce events yet. */
  addToCarts: number
  checkouts: number
  purchases: number
  revenue: number
  /** Per-item-list breakdown (GA4 itemListName), empty until list events flow. */
  itemLists: Array<{
    listName: string
    itemsViewed: number
    itemsAddedToCart: number
    itemsPurchased: number
    itemRevenue: number
  }>
  /** Non-fatal warnings (a sub-report failed, sparse data, auth error, etc.). */
  dataGaps: string[]
}

interface GaReport {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>
    metricValues?: Array<{ value?: string }>
  }>
}

function empty(windowDays: number, isConfigured: boolean, gap?: string): HomepageSignals {
  return {
    isConfigured,
    windowDays,
    activeUsers: 0,
    sessions: 0,
    screenPageViews: 0,
    engagementRate: 0,
    topPages: [],
    topProductPages: [],
    addToCarts: 0,
    checkouts: 0,
    purchases: 0,
    revenue: 0,
    itemLists: [],
    dataGaps: gap ? [gap] : [],
  }
}

function loadAuth(): GoogleAuth | null {
  const projectId = process.env['GOOGLE_CLOUD_PROJECT_ID'] || undefined
  const raw = process.env['GOOGLE_SERVICE_ACCOUNT_JSON']
  if (raw) {
    try {
      const key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
        client_email: string
        private_key: string
      }
      return new GoogleAuth({
        credentials: { client_email: key.client_email, private_key: key.private_key },
        scopes: [SCOPE],
        ...(projectId ? { projectId } : {}),
      })
    } catch {
      return null
    }
  }
  // Local dev: Application Default Credentials (gcloud auth application-default login).
  return new GoogleAuth({ scopes: [SCOPE], ...(projectId ? { projectId } : {}) })
}

async function runReport(propertyId: string, token: string, body: unknown): Promise<GaReport> {
  const res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GA4 runReport ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as GaReport
}

async function fetchSignals(windowDays: number): Promise<HomepageSignals> {
  const propertyId = (process.env['GA4_PROPERTY_ID'] ?? '').replace(/^properties\//, '').trim()
  if (!propertyId) return empty(windowDays, false, 'GA4_PROPERTY_ID not set')

  const auth = loadAuth()
  if (!auth) return empty(windowDays, false, 'service account not configured')

  let token: string | null | undefined
  try {
    const client = await auth.getClient()
    token = (await client.getAccessToken()).token
  } catch (err) {
    return empty(windowDays, true, `auth failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!token) return empty(windowDays, true, 'no access token')

  const dateRanges = [{ startDate: `${windowDays}daysAgo`, endDate: 'today' }]
  const out = empty(windowDays, true)
  const gaps: string[] = []

  try {
    const totals = await runReport(propertyId, token, {
      dateRanges,
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'engagementRate' },
      ],
    })
    const v = totals.rows?.[0]?.metricValues ?? []
    out.activeUsers = Math.round(Number(v[0]?.value ?? 0))
    out.sessions = Math.round(Number(v[1]?.value ?? 0))
    out.screenPageViews = Math.round(Number(v[2]?.value ?? 0))
    const er = Number(v[3]?.value ?? 0)
    out.engagementRate = Number.isFinite(er) ? Math.max(0, Math.min(1, er)) : 0
  } catch (err) {
    gaps.push(`totals: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    const pages = await runReport(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 25,
    })
    for (const r of pages.rows ?? []) {
      const path = r.dimensionValues?.[0]?.value ?? ''
      const views = Math.round(Number(r.metricValues?.[0]?.value ?? 0))
      if (!path || views <= 0) continue
      if (out.topPages.length < 10) out.topPages.push({ path, views })
      if (path.startsWith('/products/') && out.topProductPages.length < 10) {
        out.topProductPages.push({ path, views })
      }
    }
  } catch (err) {
    gaps.push(`topPages: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Ecommerce totals. Events may not exist yet on a young property. A failed or
  // empty report degrades to zeros so callers can treat 0 as "no signal".
  try {
    const commerce = await runReport(propertyId, token, {
      dateRanges,
      metrics: [
        { name: 'addToCarts' },
        { name: 'checkouts' },
        { name: 'ecommercePurchases' },
        { name: 'purchaseRevenue' },
      ],
    })
    const v = commerce.rows?.[0]?.metricValues ?? []
    out.addToCarts = Math.round(Number(v[0]?.value ?? 0))
    out.checkouts = Math.round(Number(v[1]?.value ?? 0))
    out.purchases = Math.round(Number(v[2]?.value ?? 0))
    const rev = Number(v[3]?.value ?? 0)
    out.revenue = Number.isFinite(rev) ? rev : 0
  } catch (err) {
    gaps.push(`commerce: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Per-item-list breakdown. itemListName is item-scoped, so only item-scoped
  // metrics are valid here (not addToCarts/checkouts).
  try {
    const lists = await runReport(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'itemListName' }],
      metrics: [
        { name: 'itemsViewedInList' },
        { name: 'itemsAddedToCart' },
        { name: 'itemsPurchased' },
        { name: 'itemRevenue' },
      ],
      orderBys: [{ metric: { metricName: 'itemsViewedInList' }, desc: true }],
      limit: 25,
    })
    for (const r of lists.rows ?? []) {
      const listName = r.dimensionValues?.[0]?.value ?? ''
      if (!listName || listName === '(not set)') continue
      const m = r.metricValues ?? []
      out.itemLists.push({
        listName,
        itemsViewed: Math.round(Number(m[0]?.value ?? 0)),
        itemsAddedToCart: Math.round(Number(m[1]?.value ?? 0)),
        itemsPurchased: Math.round(Number(m[2]?.value ?? 0)),
        itemRevenue: Number(m[3]?.value ?? 0) || 0,
      })
      if (out.itemLists.length >= 10) break
    }
  } catch (err) {
    gaps.push(`itemLists: ${err instanceof Error ? err.message : String(err)}`)
  }

  out.dataGaps = gaps
  return out
}

/**
 * Homepage engagement + top-page + ecommerce signals over the last `windowDays`
 * (default 28). Cached 10 min. Returns isConfigured:false with zeroed signals
 * when GA4 isn't set up, and never throws — treat sparse early traffic as a weak
 * signal. Ecommerce fields (addToCarts/checkouts/purchases/revenue/itemLists)
 * zero out gracefully when the property has no ecommerce events yet.
 */
export async function getHomepageSignals(opts: { windowDays?: number } = {}): Promise<HomepageSignals> {
  const windowDays = opts.windowDays ?? 28
  // v2 key: the cached shape gained ecommerce fields; old entries must not serve.
  return cached(`ga4:homepage-signals:v2:${windowDays}`, CACHE_TTL_SECONDS, () => fetchSignals(windowDays))
}
