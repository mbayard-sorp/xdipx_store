/**
 * Shared shared-secret comparison for Sanity webhook receivers.
 *
 * Pulled out of the individual route files so the logic is unit-testable
 * without importing a route module (there is no vitest config in this repo and
 * nothing under app/routes/ is currently covered, so route imports are an
 * untested code path we do not want a test to be the first to exercise).
 */

import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string compare that never throws and never leaks length via an
 * early return path. Same shape as the local helper in
 * app/routes/api.webhooks.sanity-publish.tsx, which this generalises.
 */
export function safeCompare(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ab.length !== bb.length) {
      timingSafeEqual(ab, ab)
      return false
    }
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/**
 * True when the request carries a valid `x-sanity-webhook-secret` header.
 *
 * Returns false (rather than throwing) so a caller can fall through to another
 * auth scheme. An unset SANITY_WEBHOOK_SECRET is always false: an unconfigured
 * secret must never authorise anything.
 */
export function isSanityWebhookRequest(request: Request): boolean {
  const secret = process.env['SANITY_WEBHOOK_SECRET']
  if (!secret) return false
  return safeCompare(secret, request.headers.get('x-sanity-webhook-secret') ?? '')
}
