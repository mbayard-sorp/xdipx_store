import { SITE_ORIGIN } from './social-meta'

const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_', '_hs', 'hsa_']
const TRACKING_PARAM_KEYS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'igshid',
  'yclid',
  'twclid',
  'gbraid',
  'wbraid',
  'srsltid',
  'ref',
  'ref_src',
])

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase()
  if (TRACKING_PARAM_KEYS.has(k)) return true
  return TRACKING_PARAM_PREFIXES.some(p => k.startsWith(p))
}

export interface CanonicalOpts {
  path: string
  searchParams?: URLSearchParams | Record<string, string | undefined | null>
  allowedParams?: string[]
}

export function canonicalUrl({ path, searchParams, allowedParams = [] }: CanonicalOpts): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`

  if (!searchParams || allowedParams.length === 0) {
    return `${SITE_ORIGIN}${cleanPath}`
  }

  const out = new URLSearchParams()
  const allowed = new Set(allowedParams.map(p => p.toLowerCase()))

  const entries: Array<[string, string]> =
    searchParams instanceof URLSearchParams
      ? Array.from(searchParams.entries())
      : Object.entries(searchParams).flatMap(([k, v]) =>
          v == null || v === '' ? [] : [[k, String(v)] as [string, string]],
        )

  const kept: Array<[string, string]> = entries.filter(
    ([k]) => allowed.has(k.toLowerCase()) && !isTrackingParam(k),
  )

  kept.sort(([a], [b]) => a.localeCompare(b))
  for (const [k, v] of kept) out.append(k, v)

  const qs = out.toString()
  return qs ? `${SITE_ORIGIN}${cleanPath}?${qs}` : `${SITE_ORIGIN}${cleanPath}`
}

export function robotsContent(opts: { index?: boolean; follow?: boolean } = {}): string {
  const { index = true, follow = true } = opts
  return `${index ? 'index' : 'noindex'}, ${follow ? 'follow' : 'nofollow'}`
}

/**
 * Whether a route error's HTTP status means the page is genuinely gone, the
 * one case root.tsx's shared ErrorBoundary is allowed to emit `noindex` for.
 * Every other status (a transient 5xx, a 503 Storefront outage, a 499
 * aborted render, or no error at all) must fall through with no robots meta,
 * because Google treats `noindex` as sticky and a momentary blip should cost
 * a retry, not de-indexing (ticket #173, 2026-06-13 — see root.tsx and
 * sitemap-xml.ts's RECRAWL_EPOCH).
 *
 * Extracted as a pure predicate (ticket #9316) so the PDP's "no noindex for
 * an ACTIVE product in any stock state" guarantee is independently testable:
 * the PDP loader only ever throws 404 when Shopify does not return the
 * product at all, never for a stock level, so an active product can only
 * hit this ErrorBoundary via a non-404/410 status, which this always reads
 * as indexable.
 */
export function isPermanentlyUnindexableStatus(status: number | null): boolean {
  return status === 404 || status === 410
}

export function pageTitle(parts: Array<string | null | undefined>): string {
  // Sanity-authored titles sometimes arrive already suffixed ("Play … | xdipx");
  // strip that before appending so no title ever reads "… | xdipx | xdipx".
  const filtered = parts
    .map(p => p?.replace(/\s*\|\s*xdipx\s*$/i, ''))
    .filter((p): p is string => !!p && p.trim().length > 0)
  if (filtered.length === 0) return 'xdipx'
  if (filtered[filtered.length - 1] !== 'xdipx') filtered.push('xdipx')
  return filtered.join(' | ')
}

export function truncateForMeta(input: string | null | undefined, max = 155): string {
  if (!input) return ''
  const text = input.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const slice = text.slice(0, max - 1)
  const lastSpace = slice.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim()}…`
}
