/**
 * GET /api/microsoft-ads-callback - the Web redirect URI registered on the
 * "xdipx Ads API" Entra app.
 *
 * Admin-only. Validates the CSRF state cookie set by /api/microsoft-ads-connect,
 * exchanges the code, and stores the refresh token encrypted in
 * microsoft_ads_tokens for the active MSADS_ENV. Unlike the Reddit callback it
 * never prints the token: Microsoft rotates it, so it has to live where the
 * server can replace it (see microsoft-ads-token.server.ts).
 *
 * Then it proves the connection with a read: who signed in, and which
 * customer and account IDs they can reach, so the owner can fill in
 * MSADS_*_CUSTOMER_ID / MSADS_*_ACCOUNT_ID from this page. IDs are not secrets.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { data, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { missingConfig, msAdsEnv, type MsAdsEnv } from '~/lib/microsoft-ads-core'
import {
  exchangeMsAdsCode,
  msAdsOAuthEnabled,
  msAdsOAuthStateCookie,
  msAdsRedirectUri,
} from '~/lib/microsoft-ads-oauth.server'
import { recordMsAdsConnect } from '~/lib/microsoft-ads-token.server'
import { getMsAdsAccounts, getMsAdsUser } from '~/lib/microsoft-ads.server'

interface AccountRow { customerId: string; accountId: string; name: string; number: string; status: string }

type Result =
  | {
      ok: true
      env: MsAdsEnv
      scope: string
      userName: string | null
      accounts: AccountRow[]
      verifyError: string | null
      missing: string[]
    }
  | { ok: false; env: MsAdsEnv; error: string }

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const env = msAdsEnv()

  const headers = {
    'Set-Cookie':    await msAdsOAuthStateCookie.serialize('', { maxAge: 0 }),
    'Cache-Control': 'no-store',
  }
  const fail = (error: string) => data<Result>({ ok: false, env, error }, { headers })

  if (!msAdsOAuthEnabled()) {
    return fail('Microsoft Ads OAuth is not configured. Set MSADS_CLIENT_ID, MSADS_CLIENT_SECRET and MSADS_TOKEN_KEY.')
  }

  const url = new URL(request.url)
  const denied = url.searchParams.get('error')
  if (denied) {
    const why = (url.searchParams.get('error_description') ?? '').split(/\r?\n/)[0]?.slice(0, 300) ?? ''
    return fail(`Microsoft refused the authorization: ${denied}${why ? ` (${why})` : ''}`)
  }

  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return fail('Microsoft did not return a code and state. Start again from /api/microsoft-ads-connect.')

  const expected = await msAdsOAuthStateCookie.parse(request.headers.get('Cookie'))
  if (!expected || typeof expected !== 'string') {
    return fail('The state cookie is missing or expired. Start again from /api/microsoft-ads-connect.')
  }
  if (expected !== state) {
    return fail('State mismatch. This response did not come from a handshake this browser started.')
  }

  let scope: string
  try {
    const t = await exchangeMsAdsCode(code, msAdsRedirectUri(request))
    if (!t.refreshToken) {
      return fail('Microsoft returned no refresh token. The consent screen must include offline_access; start again.')
    }
    await recordMsAdsConnect({ refreshToken: t.refreshToken, scope: t.scope, accessToken: t.accessToken, expiresIn: t.expiresIn })
    scope = t.scope
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Token exchange failed.')
  }

  // The token is stored. Anything below only verifies it.
  let userName: string | null = null
  const accounts: AccountRow[] = []
  let verifyError: string | null = null
  try {
    const { user, roles } = await getMsAdsUser()
    const first = [user.Name?.FirstName, user.Name?.LastName].filter(Boolean).join(' ')
    userName = first || user.UserName
    const customerIds = [...new Set(roles.map(r => String(r.CustomerId)))]
    for (const customerId of customerIds) {
      for (const a of await getMsAdsAccounts(customerId)) {
        accounts.push({
          customerId,
          accountId: String(a.Id),
          name:      a.Name,
          number:    a.Number,
          status:    a.AccountLifeCycleStatus,
        })
      }
    }
  } catch (err) {
    verifyError = err instanceof Error ? err.message : String(err)
  }

  return data<Result>({ ok: true, env, scope, userName, accounts, verifyError, missing: missingConfig() }, { headers })
}

export default function MicrosoftAdsCallback() {
  const result = useLoaderData<typeof loader>() as Result
  const prefix = result.env === 'sandbox' ? 'MSADS_SANDBOX_' : 'MSADS_'

  return (
    <main className="min-h-screen bg-paper px-4 py-10 md:px-8">
      <div className="mx-auto max-w-2xl">
        <p className="kicker mb-2">Microsoft Ads · {result.env}</p>
        <h1 className="font-display text-2xl md:text-3xl text-ink mb-6">
          {result.ok ? 'Connected' : 'Not connected'}
        </h1>

        {!result.ok && (
          <div className="rounded-md border border-line bg-paper-2 p-4">
            <p className="font-body text-sm text-ink break-words">{result.error}</p>
            <a className="link-coral mt-4 inline-block font-body text-sm" href="/api/microsoft-ads-connect">
              Start again
            </a>
          </div>
        )}

        {result.ok && (
          <>
            <div className="rounded-md border border-line bg-plum-soft p-4 mb-6">
              <p className="font-body text-sm text-ink-2">
                The refresh token is stored encrypted for the <strong>{result.env}</strong> environment.
                It is never shown. Reconnect here any time Microsoft drops consent.
              </p>
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-6">
              <div>
                <dt className="font-body text-xs uppercase tracking-wide text-ink-3">Signed in as</dt>
                <dd className="font-body text-sm text-ink">{result.userName ?? 'unknown'}</dd>
              </div>
              <div>
                <dt className="font-body text-xs uppercase tracking-wide text-ink-3">Granted scope</dt>
                <dd className="font-mono text-xs text-ink break-all">{result.scope}</dd>
              </div>
            </dl>

            {result.verifyError && (
              <div className="rounded-md border border-line bg-paper-2 p-4 mb-6">
                <p className="font-body text-sm text-ink break-words">
                  Connected, but the verification read failed: {result.verifyError}
                </p>
              </div>
            )}

            {result.accounts.length > 0 && (
              <div className="mb-6 overflow-x-auto">
                <table className="min-w-[520px] w-full font-body text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-3">
                      <th className="py-2 pr-3">Account</th>
                      <th className="py-2 pr-3">{prefix}CUSTOMER_ID</th>
                      <th className="py-2 pr-3">{prefix}ACCOUNT_ID</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.accounts.map(a => (
                      <tr key={`${a.customerId}-${a.accountId}`} className="border-t border-line">
                        <td className="py-2 pr-3 text-ink">{a.name} <span className="text-ink-3">({a.number})</span></td>
                        <td className="py-2 pr-3 font-mono text-xs">{a.customerId}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{a.accountId}</td>
                        <td className="py-2 text-ink-3">{a.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.missing.length > 0 && (
              <p className="font-body text-sm text-ink-3">
                Still unset for {result.env}: <span className="font-mono text-xs">{result.missing.join(', ')}</span>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}
