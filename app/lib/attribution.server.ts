import { parse as parseCookie, serialize as serializeCookie } from 'cookie'

const UTM_COOKIE = '__xdipx_utm'
const REF_COOKIE = '__xdipx_ref'
const FBC_COOKIE = '_fbc'
const THIRTY_DAYS = 60 * 60 * 24 * 30
/** Meta's own _fbc lifetime. Matching it keeps our cookie and theirs in sync. */
const NINETY_DAYS = 60 * 60 * 24 * 90

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

/**
 * The `_fbc` cookie value Meta expects: `fb.<subdomainIndex>.<creationMs>.<fbclid>`.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 * - subdomainIndex is 1, counting from the top-level domain (0 = .com,
 *   1 = xdipx.com, 2 = www.xdipx.com). fbevents.js writes at the registrable
 *   domain, so 1 is what it uses. A mismatch makes fbevents.js write a SECOND
 *   _fbc cookie, and which one gets read afterwards is not deterministic.
 * - the timestamp is MILLISECONDS. Seconds precision degrades or invalidates
 *   the click attribution.
 */
export function buildFbc(fbclid: string, nowMs: number = Date.now()): string {
  return `fb.1.${nowMs}.${fbclid}`
}

/**
 * The cookie Domain attribute for the current host, or null when it must be
 * omitted. Vercel preview hosts are on a public suffix (the browser rejects a
 * Domain there) and localhost has no registrable domain.
 */
export function fbCookieDomain(request: Request): string | null {
  let host: string
  try { host = new URL(request.url).hostname } catch { return null }
  if (host === 'xdipx.com' || host.endsWith('.xdipx.com')) return '.xdipx.com'
  return null
}

/**
 * Capture `fbclid` from an ad click into the `_fbc` cookie.
 *
 * Without this there is no click-level Meta attribution at all: fbevents.js is
 * the only other thing that writes _fbc, and it is deferred behind first
 * interaction and boots consent-revoked, so a shopper who lands from an ad and
 * buys is invisible as a conversion from that ad.
 *
 * Last click wins, with a refreshed timestamp. Writes nothing when the param
 * is absent, so ordinary requests stay Set-Cookie free and edge-cacheable
 * (a URL bearing fbclid is unique per click and was never a shared cache entry
 * to begin with).
 */
export function captureFbClickId(request: Request, nowMs: number = Date.now()): string[] {
  let fbclid: string | null
  try { fbclid = new URL(request.url).searchParams.get('fbclid') } catch { return [] }
  if (!fbclid) return []

  const domain = fbCookieDomain(request)
  return [serializeCookie(FBC_COOKIE, buildFbc(fbclid, nowMs), {
    httpOnly: false, // fbevents.js must be able to read it
    path: '/',
    sameSite: 'lax', // an ad click is a top-level cross-site navigation
    maxAge: NINETY_DAYS,
    ...(domain ? { domain } : {}),
    ...(process.env['NODE_ENV'] === 'production' ? { secure: true } : {}),
  })]
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
  return getClientIPOrNull(request) ?? '0.0.0.0'
}

/**
 * The real client IP, or null when it cannot be determined.
 *
 * getClientIP's '0.0.0.0' placeholder is right for the consent audit log
 * (hashIP needs a value and a stable "unknown" bucket is fine there), but it is
 * actively harmful in a CAPI payload: Meta counts it as 100% IP coverage while
 * it matches nobody, so Event Match Quality reads healthy when it is not.
 * Conversion senders should omit the field instead.
 */
export function getClientIPOrNull(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  return null
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
