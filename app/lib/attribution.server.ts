import { parse as parseCookie, serialize as serializeCookie } from 'cookie'

const UTM_COOKIE = '__xdipx_utm'
const REF_COOKIE = '__xdipx_ref'
const THIRTY_DAYS = 60 * 60 * 24 * 30

export interface UTMData {
  source:   string | null
  medium:   string | null
  campaign: string | null
  content:  string | null
  capturedAt: string
}

export function captureUTM(request: Request): { utm: UTMData | null; refCode: string | null; cookies: string[] } {
  const url = new URL(request.url)
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  const setCookies: string[] = []

  // UTM capture — only write if params present in URL
  const source   = url.searchParams.get('utm_source')
  const medium   = url.searchParams.get('utm_medium')
  const campaign = url.searchParams.get('utm_campaign')
  const content  = url.searchParams.get('utm_content')

  let utm: UTMData | null = null
  if (source ?? medium ?? campaign) {
    utm = { source, medium, campaign, content, capturedAt: new Date().toISOString() }
    setCookies.push(serializeCookie(UTM_COOKIE, JSON.stringify(utm), {
      httpOnly: false, // accessible for GA4 client-side
      path: '/',
      sameSite: 'lax',
      maxAge: THIRTY_DAYS,
    }))
  } else if (cookies[UTM_COOKIE]) {
    try { utm = JSON.parse(cookies[UTM_COOKIE]) as UTMData } catch { /* ignore */ }
  }

  // Ref code capture
  const refFromUrl = url.searchParams.get('ref')
  let refCode: string | null = refFromUrl ?? cookies[REF_COOKIE] ?? null
  if (refFromUrl) {
    setCookies.push(serializeCookie(REF_COOKIE, refFromUrl, {
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
      maxAge: THIRTY_DAYS,
    }))
  }

  return { utm, refCode, cookies: setCookies }
}

export function getStoredUTM(request: Request): UTMData | null {
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  if (!cookies[UTM_COOKIE]) return null
  try { return JSON.parse(cookies[UTM_COOKIE]) as UTMData } catch { return null }
}

export function getStoredRefCode(request: Request): string | null {
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  return cookies[REF_COOKIE] ?? null
}

/**
 * Read the browser-set Meta click/browser cookies from an incoming request.
 * Read-only. Returns null for each cookie when absent.
 * The values flow into CAPI user_data and are written as Shopify cart
 * attributes by the api.cart action so they survive to the order webhook.
 */
export function getFbCookies(request: Request): { fbp: string | null; fbc: string | null } {
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  return {
    fbp: cookies['_fbp'] ?? null,
    fbc: cookies['_fbc'] ?? null,
  }
}

/**
 * Read the GA4 client id from the `_ga` cookie so a server-side purchase event
 * can be attributed to the same GA4 client that browsed. The cookie is
 * `GA1.1.<clientId1>.<clientId2>`; the client_id GA4 expects is the last two
 * dot-parts joined, e.g. `1234567890.1712345678`. Returns null when absent.
 * Written as the `_ga_cid` cart attribute by the api.cart action so it reaches
 * the order webhook.
 */
export function getGaClientId(request: Request): string | null {
  const raw = parseCookie(request.headers.get('Cookie') ?? '')['_ga']
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length < 4) return null
  return `${parts[2]}.${parts[3]}`
}

export function getClientIP(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '0.0.0.0'
  )
}

export function hashIP(ip: string): string {
  // Simple deterministic hash — use node:crypto in production for HMAC
  let hash = 0
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}
