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
/**
 * When KV isn't configured (local dev), bypass rate limiting entirely.
 * The in-memory KV fallback now honors TTL, but rate limits create constant
 * friction during local iteration with no upside since traffic is one
 * developer. Production traffic always has real KV configured.
 */
const RATE_LIMIT_BYPASS =
  !process.env['KV_REST_API_URL'] || !process.env['KV_REST_API_TOKEN']

export async function checkRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; count: number }> {
  if (RATE_LIMIT_BYPASS) return { ok: true, count: 0 }
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
