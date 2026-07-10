/**
 * POST /api/webhooks/sanity-publish
 *
 * Sanity Studio "publish" webhook receiver for blogPost documents. Covers
 * the path api.revalidate.blog.tsx doesn't: a human editor publishing a
 * blogPost directly in Studio (the automated content-writer routine already
 * calls api.revalidate.blog.tsx right after its own publish, which pings
 * search engines too — see the comment there). This route just fires the
 * IndexNow discovery ping (app/lib/search-ping.server.ts); it does not touch
 * caches, since Studio publishes are already picked up by the blog cache's
 * own 60s TTL.
 *
 * Inert unless SEARCH_PING_ENABLED === 'true' (search-ping.server.ts gate).
 * Never throws — a ping failure must not surface as a webhook error to Sanity.
 *
 * --- Sanity Studio setup (owner action required) ---
 * 1. In the Sanity project dashboard, go to API -> Webhooks -> Create webhook.
 * 2. URL: https://xdipx.com/api/webhooks/sanity-publish
 * 3. Dataset: production (or whichever dataset serves the live site).
 * 4. Trigger on: Create, Update (filter: `_type == "blogPost"`).
 * 5. HTTP method: POST, API version: v2021-03-25 or later.
 * 6. Add an HTTP header named `x-sanity-webhook-secret` with a random value,
 *    and set that same value as SANITY_WEBHOOK_SECRET in the app's env vars.
 * 7. Projection (payload sent to this endpoint):
 *    { "_type": _type, "slug": slug.current }
 */

import type { ActionFunctionArgs } from 'react-router'
import { timingSafeEqual } from 'node:crypto'

function safeCompare(a: string, b: string): boolean {
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

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 })
  }

  const secret = process.env['SANITY_WEBHOOK_SECRET']
  const incoming = request.headers.get('x-sanity-webhook-secret') ?? ''
  if (!secret || !safeCompare(secret, incoming)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const docType = typeof payload['_type'] === 'string' ? payload['_type'] : ''
  const slug = typeof payload['slug'] === 'string' ? payload['slug'].trim() : ''

  if (docType !== 'blogPost' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    // Not a blogPost publish we care about, or malformed payload — ack quietly.
    return Response.json({ ok: true, skipped: true })
  }

  try {
    const { pingSearchEngines } = await import('~/lib/search-ping.server')
    await pingSearchEngines([`/notebook/${slug}`, `/notebook/${slug}.md`, '/notebook'])
  } catch (err) {
    console.error('[sanity-publish webhook] search ping failed (non-blocking):', err)
  }

  return Response.json({ ok: true, slug })
}
