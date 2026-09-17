/**
 * GET /api/reddit-connect - start the Reddit Ads OAuth handshake.
 *
 * Admin-only. Mints a signed CSRF state cookie and bounces to Reddit's consent screen.
 * Reddit sends the user back to /api/reddit-callback, which does the code exchange.
 *
 * This is a one-time setup action, not something a cron or an agent calls.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  REDDIT_ADS_OAUTH_ENABLED,
  generateState,
  getRedditAuthUrl,
  redditOAuthStateCookie,
  redditRedirectUri,
} from '~/lib/reddit-oauth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  if (!REDDIT_ADS_OAUTH_ENABLED) {
    return new Response(
      'Reddit Ads OAuth is not configured. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const state = generateState()

  return new Response(null, {
    status: 302,
    headers: {
      Location:       getRedditAuthUrl(redditRedirectUri(request), state),
      'Set-Cookie':   await redditOAuthStateCookie.serialize(state),
      'Cache-Control': 'no-store',
    },
  })
}
