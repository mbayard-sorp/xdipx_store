/**
 * Google Search Console snapshot — weekly pull of last-28-day top queries,
 * top pages, totals, and sitemap status into the gsc_snapshots table so the
 * weekly strategy routine can read search performance without any MCP.
 *
 * Auth: service account, zero extra dependencies (RS256 JWT via node:crypto,
 * exchanged for an access token). Env:
 *   GSC_SA_JSON  — the full service-account JSON key (preferred), OR
 *   GSC_SA_EMAIL + GSC_SA_PRIVATE_KEY — the two fields split out.
 *   GSC_SITE_URL — optional property override; defaults to sc-domain:xdipx.com.
 *
 * The service account must be added as a user on the Search Console property.
 * Missing creds is a supported state: runGscSnapshot() returns
 * { skipped: 'no credentials' } so the cron merges before setup.
 */
import { createSign } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env['DATABASE_URL']!)

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DEFAULT_SITE = 'sc-domain:xdipx.com'

function loadCredentials(): { email: string; privateKey: string } | null {
  const rawJson = process.env['GSC_SA_JSON']?.trim()
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as { client_email?: string; private_key?: string }
      if (parsed.client_email && parsed.private_key) {
        return { email: parsed.client_email, privateKey: parsed.private_key }
      }
    } catch (err) {
      console.error('[gsc] GSC_SA_JSON is set but not valid JSON:', err)
      return null
    }
  }
  const email = process.env['GSC_SA_EMAIL']?.trim()
  // Vercel env vars store newlines escaped; restore them for the PEM.
  const privateKey = process.env['GSC_SA_PRIVATE_KEY']?.replace(/\\n/g, '\n')
  if (email && privateKey) return { email, privateKey }
  return null
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

async function getAccessToken(creds: { email: string; privateKey: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: creds.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(creds.privateKey).toString('base64url')
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`GSC token exchange failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) throw new Error('GSC token exchange returned no access_token')
  return json.access_token
}

interface SearchAnalyticsRow {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

async function searchAnalytics(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SearchAnalyticsRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(`GSC searchAnalytics failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { rows?: SearchAnalyticsRow[] }
  return json.rows ?? []
}

export interface GscSnapshotResult {
  skipped?: string
  captured?: {
    periodStart: string
    periodEnd: string
    totalClicks: number
    totalImpressions: number
    queryCount: number
    pageCount: number
    sitemapCount: number
  }
}

export async function runGscSnapshot(): Promise<GscSnapshotResult> {
  const creds = loadCredentials()
  if (!creds) {
    console.log('[gsc] skipped: no service-account credentials (set GSC_SA_JSON or GSC_SA_EMAIL + GSC_SA_PRIVATE_KEY)')
    return { skipped: 'no credentials' }
  }
  const siteUrl = process.env['GSC_SITE_URL']?.trim() || DEFAULT_SITE

  const token = await getAccessToken(creds)

  // GSC data lags ~2-3 days; end the window 3 days ago to avoid partial days.
  const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000)
  const periodStart = start.toISOString().split('T')[0]!
  const periodEnd = end.toISOString().split('T')[0]!
  const base = { startDate: periodStart, endDate: periodEnd, rowLimit: 100 }

  const [totalsRows, queryRows, pageRows, sitemapsRes] = await Promise.all([
    searchAnalytics(token, siteUrl, { ...base, rowLimit: 1 }),
    searchAnalytics(token, siteUrl, { ...base, dimensions: ['query'] }),
    searchAnalytics(token, siteUrl, { ...base, dimensions: ['page'] }),
    fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`, {
      headers: { 'Authorization': `Bearer ${token}` },
    }),
  ])

  const totals = totalsRows[0]
    ? {
        clicks: totalsRows[0].clicks ?? 0,
        impressions: totalsRows[0].impressions ?? 0,
        ctr: totalsRows[0].ctr ?? 0,
        position: totalsRows[0].position ?? 0,
      }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 }

  const mapRows = (rows: SearchAnalyticsRow[], key: 'query' | 'page') =>
    rows.map(r => ({
      [key]: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }))

  let sitemaps: unknown[] = []
  if (sitemapsRes.ok) {
    const json = await sitemapsRes.json() as {
      sitemap?: { path?: string; lastSubmitted?: string; isPending?: boolean; errors?: string; warnings?: string }[]
    }
    sitemaps = (json.sitemap ?? []).map(s => ({
      path: s.path ?? '',
      lastSubmitted: s.lastSubmitted ?? null,
      isPending: s.isPending ?? false,
      errors: s.errors ?? '0',
      warnings: s.warnings ?? '0',
    }))
  } else {
    console.warn(`[gsc] sitemaps list failed (non-fatal): ${sitemapsRes.status}`)
  }

  const topQueries = mapRows(queryRows, 'query')
  const topPages = mapRows(pageRows, 'page')

  await sql`
    INSERT INTO gsc_snapshots (period_start, period_end, totals, top_queries, top_pages, sitemaps)
    VALUES (
      ${periodStart}, ${periodEnd},
      ${JSON.stringify(totals)}::jsonb,
      ${JSON.stringify(topQueries)}::jsonb,
      ${JSON.stringify(topPages)}::jsonb,
      ${JSON.stringify(sitemaps)}::jsonb
    )
  `

  return {
    captured: {
      periodStart,
      periodEnd,
      totalClicks: totals.clicks,
      totalImpressions: totals.impressions,
      queryCount: topQueries.length,
      pageCount: topPages.length,
      sitemapCount: sitemaps.length,
    },
  }
}
