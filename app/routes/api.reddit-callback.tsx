/**
 * GET /api/reddit-callback - the redirect URI registered on the Reddit app.
 *
 * Admin-only. Validates the CSRF state cookie set by /api/reddit-connect, exchanges the
 * authorization code, and prints the refresh token ONCE so it can be pasted into Vercel
 * as REDDIT_ADS_REFRESH_TOKEN.
 *
 * The token is deliberately not written to the database and not logged: there is no
 * secrets table, Sentry captures loader errors, and a refresh token in a log line is a
 * standing credential leak. Reload this page and it is gone; re-run /api/reddit-connect
 * to mint another.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { data, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  REDDIT_ADS_OAUTH_ENABLED,
  REDDIT_ADS_SCOPES,
  exchangeRedditCode,
  redditOAuthStateCookie,
  redditRedirectUri,
} from '~/lib/reddit-oauth.server'

type Result =
  | { ok: true;  refreshToken: string; scope: string; expiresIn: number; hasRefresh: boolean }
  | { ok: false; error: string }

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const headers = {
    // Clear the one-shot state cookie whatever happens next.
    'Set-Cookie':    await redditOAuthStateCookie.serialize('', { maxAge: 0 }),
    'Cache-Control': 'no-store',
  }
  const fail = (error: string) => data<Result>({ ok: false, error }, { headers })

  if (!REDDIT_ADS_OAUTH_ENABLED) {
    return fail('Reddit Ads OAuth is not configured. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.')
  }

  const url = new URL(request.url)
  const denied = url.searchParams.get('error')
  if (denied) return fail(`Reddit refused the authorization: ${denied}`)

  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return fail('Reddit did not return a code and state. Start again from /api/reddit-connect.')

  const expected = await redditOAuthStateCookie.parse(request.headers.get('Cookie'))
  if (!expected || typeof expected !== 'string') {
    return fail('The state cookie is missing or expired. Start again from /api/reddit-connect.')
  }
  if (expected !== state) {
    return fail('State mismatch. This response did not come from a handshake this browser started.')
  }

  try {
    const tokens = await exchangeRedditCode(code, redditRedirectUri(request))
    return data<Result>({
      ok:           true,
      refreshToken: tokens.refreshToken ?? '',
      hasRefresh:   !!tokens.refreshToken,
      scope:        tokens.scope || REDDIT_ADS_SCOPES,
      expiresIn:    tokens.expiresIn,
    }, { headers })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Token exchange failed.')
  }
}

export default function RedditCallback() {
  const result = useLoaderData<typeof loader>() as Result

  return (
    <main className="min-h-screen bg-paper px-4 py-10 md:px-8">
      <div className="mx-auto max-w-2xl">
        <p className="kicker mb-2">Reddit Ads</p>
        <h1 className="font-display text-2xl md:text-3xl text-ink mb-6">
          {result.ok ? 'Connected' : 'Not connected'}
        </h1>

        {!result.ok && (
          <div className="rounded-md border border-line bg-paper-2 p-4">
            <p className="font-body text-sm text-ink">{result.error}</p>
            <a className="link-coral mt-4 inline-block font-body text-sm" href="/api/reddit-connect">
              Start again
            </a>
          </div>
        )}

        {result.ok && !result.hasRefresh && (
          <div className="rounded-md border border-line bg-paper-2 p-4">
            <p className="font-body text-sm text-ink">
              Reddit returned an access token but no refresh token. That happens when the consent
              screen was not requested with duration=permanent, or when the app was already
              authorized under a temporary grant. Revoke this app under Reddit account settings,
              then start again.
            </p>
            <a className="link-coral mt-4 inline-block font-body text-sm" href="/api/reddit-connect">
              Start again
            </a>
          </div>
        )}

        {result.ok && result.hasRefresh && (
          <>
            <div className="rounded-md border border-line bg-plum-soft p-4 mb-6">
              <p className="font-body text-sm text-ink-2">
                Shown once. Copy it now, then store it in Vercel as
                {' '}<code className="font-mono text-xs">REDDIT_ADS_REFRESH_TOKEN</code>.
                Reloading this page will not show it again.
              </p>
            </div>

            <label className="block font-body text-xs uppercase tracking-wide text-ink-3 mb-2">
              Refresh token
            </label>
            <textarea
              readOnly
              rows={3}
              value={result.refreshToken}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-md border border-line bg-paper-2 p-3 font-mono text-xs text-ink break-all"
            />

            <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="font-body text-xs uppercase tracking-wide text-ink-3">Granted scopes</dt>
                <dd className="font-mono text-sm text-ink">{result.scope}</dd>
              </div>
              <div>
                <dt className="font-body text-xs uppercase tracking-wide text-ink-3">Access token lifetime</dt>
                <dd className="font-mono text-sm text-ink">{result.expiresIn}s</dd>
              </div>
            </dl>

            <p className="mt-8 font-body text-sm text-ink-3">
              The access token from this exchange was discarded. Anything calling the Ads API
              should refresh from the stored token rather than reuse a one-hour credential.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
