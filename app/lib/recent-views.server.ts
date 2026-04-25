/**
 * Recent-views cookie helpers.
 *
 * Tracks the last N product handles the visitor has viewed so Emma's discovery
 * rail can reference "what you looked at last week" without a database lookup.
 *
 * Cookie is readable from client JS (httpOnly=false) so the PDP can append the
 * current handle without a server round-trip. Values are plain product handles
 * already exposed in URLs — no PII.
 */

import { parse as parseCookie, serialize as serializeCookie } from 'cookie'

const COOKIE_NAME = 'xd_rv'
const MAX_HANDLES = 10
const MAX_AGE_DAYS = 30

export function readRecentHandles(request: Request): string[] {
  const header = request.headers.get('Cookie') ?? ''
  const cookies = parseCookie(header)
  const raw = cookies[COOKIE_NAME]
  if (!raw) return []
  return raw
    .split(',')
    .map(h => h.trim())
    .filter(Boolean)
    .slice(0, MAX_HANDLES)
}

export function appendRecentHandleCookie(request: Request, handle: string): string {
  const current = readRecentHandles(request)
  const deduped = [handle, ...current.filter(h => h !== handle)].slice(0, MAX_HANDLES)
  return serializeCookie(COOKIE_NAME, deduped.join(','), {
    httpOnly: false,
    path: '/',
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 60 * 60 * 24 * MAX_AGE_DAYS,
  })
}

export const RECENT_VIEWS_COOKIE = COOKIE_NAME
