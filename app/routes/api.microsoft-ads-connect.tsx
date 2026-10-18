/**
 * GET /api/microsoft-ads-connect - start the Microsoft Advertising OAuth handshake.
 *
 * Admin-only. Mints a signed CSRF state cookie and bounces to Microsoft's
 * account picker and consent screen. Microsoft sends the browser back to
 * /api/microsoft-ads-callback, which exchanges the code and stores the
 * refresh token for the active MSADS_ENV.
 *
 * A one-time setup action (again after consent is lost), not something a cron
 * or an agent calls. Runbook: docs/store-team/microsoft-ads-api-runbook.md.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  generateState,
  getMsAdsAuthUrl,
  msAdsOAuthEnabled,
  msAdsOAuthStateCookie,
  msAdsRedirectUri,
} from '~/lib/microsoft-ads-oauth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  if (!msAdsOAuthEnabled()) {
    return new Response(
      'Microsoft Ads OAuth is not configured. Set MSADS_CLIENT_ID, MSADS_CLIENT_SECRET and MSADS_TOKEN_KEY.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const state = generateState()

  return new Response(null, {
    status: 302,
    headers: {
      Location:        getMsAdsAuthUrl(msAdsRedirectUri(request), state),
      'Set-Cookie':    await msAdsOAuthStateCookie.serialize(state),
      'Cache-Control': 'no-store',
    },
  })
}
