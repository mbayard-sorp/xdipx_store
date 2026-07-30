/**
 * Server-readable recently-browsed product cookie. Separate from the client-only
 * localStorage store used by `RecentlyBrowsed.tsx` — that's fine; they can run
 * in parallel and converge. Needed server-side so the PDP loader can feed
 * browse context into the Emma aside generation without a client round-trip.
 */

import { parse as parseCookie, serialize as serializeCookie } from 'cookie'

const BROWSE_COOKIE = 'xdipx_browse'
const MAX_ITEMS     = 5

export function parseBrowseCookie(request: Request): string[] {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const cookies = parseCookie(cookieHeader)
  const raw = cookies[BROWSE_COOKIE]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_ITEMS)
    }
  } catch { /* ignore malformed cookie */ }
  return []
}

export function buildBrowseCookie(currentId: string, previousIds: string[]): string {
  const next = [currentId, ...previousIds.filter(id => id !== currentId)].slice(0, MAX_ITEMS)
  return serializeCookie(BROWSE_COOKIE, JSON.stringify(next), {
    httpOnly: false,                 // RecentlyBrowsed reads via JS on the client too if needed
    path: '/',
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    // 7 days, not 30. This cookie is what qualifies a visitor for a paid Emma
    // generation on the PDP, so its lifetime is a spend surface: a client that
    // retains it farms personalization for as long as it lasts, which is how a
    // single overnight catalog walk on 2026-07-21 stayed "personalized" across
    // 2,709 products. A week covers a real shopper returning to compare, and
    // recency is what makes browse context worth anything in the copy anyway.
    maxAge: 60 * 60 * 24 * 7,
  })
}
