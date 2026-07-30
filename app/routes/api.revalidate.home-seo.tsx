/**
 * POST /api/revalidate/home-seo
 *
 * Busts the cache behind the homepage SERP snippet (`singleton.homeSeo`, the
 * homepage <title> and <meta name="description">). Two callers, two auth
 * schemes, one route:
 *
 *  - the homepage merchandising routine, right after it patches + publishes
 *    the singleton, using the team token (`x-team-secret`);
 *  - a Sanity Studio publish webhook, so a human editing in Studio gets the
 *    same treatment, using the `x-sanity-webhook-secret` shared secret.
 *
 * Auth order matters: `assertTeamAuth` THROWS a 401 Response rather than
 * returning a boolean, so the non-throwing webhook check runs first and
 * `assertTeamAuth` produces the 401 for us if that fails.
 *
 * WHAT THIS DOES NOT DO: make a publish visible immediately. The homepage is
 * edge-cached (`s-maxage=900, stale-while-revalidate=3600`, see
 * app/lib/storefront-home.server.ts) and there is no Vercel CDN purge API in
 * this codebase. This clears the KV/L1 tiers so the ORIGIN renders fresh on the
 * next request; the edge window is unchanged. To verify a write without waiting
 * it out, fetch an origin-guaranteed URL (`/?variant=b&rt=<unique>`) after
 * calling this, since the CDN cache key includes the query string.
 *
 * --- Sanity Studio setup (owner action required) ---
 * 1. Sanity project dashboard -> API -> Webhooks -> Create webhook.
 * 2. URL: https://xdipx.com/api/revalidate/home-seo
 * 3. Dataset: production.
 * 4. Trigger on: Create, Update, Delete. Filter: `_type == "homeSeo"`.
 * 5. HTTP method: POST, API version v2021-03-25 or later.
 * 6. Header `x-sanity-webhook-secret` set to the same value as the app's
 *    SANITY_WEBHOOK_SECRET env var.
 * 7. Projection: { "_type": _type }
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { invalidateHomeSeoCache } from '~/lib/sanity.server'
import { isSanityWebhookRequest } from '~/lib/webhook-auth.server'

export async function action({ request }: ActionFunctionArgs) {
  // Method check BEFORE auth: api.revalidate.blog.tsx asserts auth first, which
  // would 401 Sanity's webhook verification pings before they reach this point.
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 })
  }

  const fromWebhook = isSanityWebhookRequest(request)
  if (!fromWebhook) assertTeamAuth(request) // throws a 401 Response when invalid

  // Quiet-ack anything that is not a homeSeo document, matching
  // api.webhooks.sanity-publish.tsx. Without this a broad Sanity webhook filter
  // would turn every publish in the dataset into a homeSeo purge. A direct
  // team-token call has no body requirement, so an unparseable/absent body is
  // only treated as "not for me" when the call came from the webhook.
  if (fromWebhook) {
    let type: unknown = undefined
    try {
      const body = (await request.json()) as { _type?: unknown }
      type = body?._type
    } catch {
      // fall through: a webhook with no readable body is not actionable
    }
    if (type !== 'homeSeo') {
      return Response.json({ ok: true, skipped: true })
    }
  }

  await invalidateHomeSeoCache()

  try {
    const { pingSearchEngines } = await import('~/lib/search-ping.server')
    await pingSearchEngines(['/'])
  } catch (err) {
    console.error('[revalidate-home-seo] search ping failed (non-blocking):', err)
  }

  return Response.json({ ok: true })
}
