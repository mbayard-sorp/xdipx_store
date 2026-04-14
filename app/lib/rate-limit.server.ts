import { kvIncr, kvSet } from './kv.server'

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  if (first) return first
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  return 'unknown'
}

/**
 * IP-based fixed-window rate limit via KV. Returns `{ ok: false, count }` if
 * the caller has exceeded `limit` within `windowSeconds`. Key scope must be
 * unique per endpoint (e.g. "waitlist:submit") so limits don't cross-contaminate.
 *
 * Fails open on KV errors — we prefer serving traffic over 500s on rate limit
 * infrastructure hiccups.
 */
export async function checkRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; count: number }> {
  try {
    const ip = getClientIp(request)
    const key = `rl:${scope}:${ip}`
    const count = await kvIncr(key)
    if (count === 1) await kvSet(key, count, windowSeconds)
    return { ok: count <= limit, count }
  } catch {
    return { ok: true, count: 0 }
  }
}

export function rateLimited(): Response {
  return Response.json(
    { error: 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': '60' } },
  )
}
