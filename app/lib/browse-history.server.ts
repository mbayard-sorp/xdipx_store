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
    maxAge: 60 * 60 * 24 * 30,       // 30 days
  })
}
