/**
 * `/start` helpers: the "just looking" door of the paid-lead funnel.
 *
 * Shared by the route loader (server) and the tile click handler (client), so
 * this file has no `.server` suffix and imports nothing server-only. The
 * interest list itself lives in `lead-interests.ts`; this file only decides
 * which tile is picked, what each tile links to, and how the pick is
 * remembered.
 */

import { getLeadInterest, type LeadInterestSlug } from '~/lib/lead-interests'

/** First-party cookie remembering the visitor's interest. Not httpOnly: the tile click writes it client-side. */
export const INTEREST_COOKIE = 'xdipx_interest'
export const INTEREST_COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 days

/** The bridge page's lead door. */
export const LEAD_DOOR_URL = 'https://curious.xdipx.com/hello'

/**
 * Query params carried from `/start` onto every outbound tile link, so paid
 * attribution survives the hop. fbclid rides along because Meta is the paid
 * source this page exists for.
 */
export const CARRIED_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
] as const

export function interestCookieHeader(slug: LeadInterestSlug): string {
  return `${INTEREST_COOKIE}=${slug}; Path=/; Max-Age=${INTEREST_COOKIE_MAX_AGE}; SameSite=Lax`
}

export function readInterestCookie(cookieHeader: string | null): LeadInterestSlug | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === INTEREST_COOKIE) return getLeadInterest(decodeURIComponent(rest.join('=')))?.slug ?? null
  }
  return null
}

/** Picks the carried params out of an incoming query string, in a stable order. */
export function carriedParams(searchParams: URLSearchParams): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const key of CARRIED_PARAMS) {
    const value = searchParams.get(key)
    if (value) out.push([key, value])
  }
  return out
}

/** Appends the carried params to a path or absolute URL. */
export function withCarriedParams(href: string, params: Array<[string, string]>): string {
  if (params.length === 0) return href
  const qs = new URLSearchParams(params).toString()
  return `${href}${href.includes('?') ? '&' : '?'}${qs}`
}
