/**
 * Host gate for the paid-lane bridge pages (Ad Studio v2 PR-D).
 *
 * The bridge is served by this same app, not a second platform. It is live
 * only when the request host is `curious.xdipx.com`, so adding that domain to
 * the Vercel project is what turns it on (docs/store-team/ad-bridge-host.md).
 * In development `?bridgeHost=1` stands in for the host so the page can be
 * previewed on localhost. That override is ignored in production.
 *
 * Server-only. The two small path helpers are also imported by server/index.ts
 * (via the compiled `.js` specifier), which is why this file has no React,
 * Sanity or Shopify imports.
 */

export const BRIDGE_HOST = 'curious.xdipx.com'

/** Slug shape shared by the Sanity validation and the path allowlist. */
const SLUG = '[a-z0-9][a-z0-9-]{0,59}'
const BRIDGE_PATH_RE = new RegExp(`^/(?:bridge/)?${SLUG}(?:\\.data)?$`, 'i')

type HeaderBag = { get(name: string): string | null } | Record<string, string | string[] | undefined>

function readHeader(headers: HeaderBag, name: string): string {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(n: string): string | null }).get(name) ?? ''
  }
  const v = (headers as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

/** The host the visitor typed, preferring the proxy header Vercel sets. */
export function requestHost(headers: HeaderBag): string {
  const raw = readHeader(headers, 'x-forwarded-host') || readHeader(headers, 'host')
  return raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '')
}

export function isBridgeHost(host: string): boolean {
  return host === BRIDGE_HOST
}

/** True when this request may render a bridge page. */
export function isBridgeHostRequest(request: Request): boolean {
  if (isBridgeHost(requestHost(request.headers))) return true
  if (process.env['NODE_ENV'] !== 'production') {
    return new URL(request.url).searchParams.get('bridgeHost') === '1'
  }
  return false
}

/**
 * The slug a bridge-host path asks for, or null. Accepts `/<slug>`, its
 * `/bridge/<slug>` twin and the single-fetch `.data` variants. A match here
 * only means the path is slug-shaped: static storefront routes such as /about
 * are slug-shaped too, so the caller must also confirm a bridge page exists
 * for the slug before letting the request through (server/index.ts does).
 */
export function bridgeSlugFromPath(pathname: string): string | null {
  if (!BRIDGE_PATH_RE.test(pathname)) return null
  return pathname.replace(/^\/(?:bridge\/)?/i, '').replace(/\.data$/i, '').toLowerCase()
}

/**
 * Paths the bridge page itself needs besides its slug: React Router's route
 * discovery manifest and the consent log the cookie banner posts to.
 */
export function bridgeHostSupportPath(pathname: string): boolean {
  return pathname === '/__manifest' || pathname === '/api/consent'
}
