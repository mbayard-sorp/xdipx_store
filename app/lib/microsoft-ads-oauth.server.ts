/**
 * Microsoft Advertising OAuth 2.0 (authorization-code grant, confidential web app).
 *
 * Required env vars:
 *   MSADS_CLIENT_ID      - Application (client) ID of the "xdipx Ads API" Entra app.
 *   MSADS_CLIENT_SECRET  - a client secret VALUE from that app (not the secret id).
 *   MSADS_TOKEN_KEY      - random string, at least 32 chars, that encrypts the stored
 *                          refresh token (see microsoft-ads-token.server.ts).
 *
 * Optional:
 *   MSADS_REDIRECT_URI   - the exact registered redirect URI, when it is not
 *                          "<APP_URL>/api/microsoft-ads-callback".
 *
 * Setup: docs/store-team/microsoft-ads-api-runbook.md.
 *
 * Why a confidential app with a secret, unlike the public-client app behind the
 * Claude MCP connector: Microsoft binds a public-client refresh token to the
 * device that minted it, and Vercel functions run across regions, so only a
 * web app's token survives being used from the server.
 *
 * Why the refresh token goes to the DB, unlike Reddit's print-once flow:
 * Microsoft may rotate the refresh token on every refresh and expects the
 * newest one to be kept. An env var would go stale on first use.
 *
 * Nothing here logs a token.
 */

import crypto from 'node:crypto'
import { createCookie } from 'react-router'
import { requireSecret } from './env.server'
import { MSADS_AUTHORIZE_URL, MSADS_TOKEN_URL, msAdsConfig, msAdsEnv, msAdsScope } from './microsoft-ads-core'

const isProd = process.env['NODE_ENV'] === 'production'

export function msAdsOAuthEnabled(): boolean {
  const c = msAdsConfig()
  return !!(c.clientId && c.clientSecret && process.env['MSADS_TOKEN_KEY'])
}

// -- CSRF state cookie --------------------------------------------------------
// sameSite 'lax' so it survives the top-level redirect back from Microsoft.

export const msAdsOAuthStateCookie = createCookie('__xdipx_msads_oauth', {
  httpOnly: true,
  path:     '/',
  sameSite: 'lax',
  secure:   isProd,
  secrets:  [requireSecret('SESSION_SECRET')],
  maxAge:   600,
})

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Must be byte-identical in the authorize call and the token exchange.
 * Prefers APP_URL over the request origin so a preview deploy cannot send a
 * redirect URI the Entra app has never registered.
 */
export function msAdsRedirectUri(request: Request): string {
  const explicit = process.env['MSADS_REDIRECT_URI']
  if (explicit) return explicit
  const origin = process.env['APP_URL'] || new URL(request.url).origin
  return new URL('/api/microsoft-ads-callback', origin).toString()
}

export function getMsAdsAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     msAdsConfig().clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri:  redirectUri,
    scope:         msAdsScope(msAdsEnv()),
    state,
    // Always show the account picker. The browser may already be signed in
    // to a work tenant, and the Ads account to connect is a different login.
    prompt:        'select_account',
  })
  return `${MSADS_AUTHORIZE_URL}?${params}`
}

// -- Token requests -------------------------------------------------------------

export interface MsAdsTokenSet {
  accessToken:  string
  /** Microsoft may return a new one on any refresh; null when it did not. */
  refreshToken: string | null
  scope:        string
  expiresIn:    number
}

export class MsAdsTokenError extends Error {
  constructor(message: string, readonly oauthError: string | null) {
    super(message)
    this.name = 'MsAdsTokenError'
  }
}

async function requestToken(body: URLSearchParams): Promise<MsAdsTokenSet> {
  const c = msAdsConfig()
  body.set('client_id', c.clientId)
  body.set('client_secret', c.clientSecret)
  body.set('scope', msAdsScope(c.env))

  const res = await fetch(MSADS_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await res.text()
  let json: {
    access_token?: string; refresh_token?: string; scope?: string; expires_in?: number
    error?: string; error_description?: string
  }
  try {
    json = JSON.parse(text) as typeof json
  } catch {
    throw new MsAdsTokenError(`Microsoft token request returned non-JSON (${res.status})`, null)
  }

  if (!res.ok || json.error) {
    // error_description can be long and carries trace ids; the first line is the useful part.
    const detail = (json.error_description ?? '').split(/\r?\n/)[0]?.slice(0, 300) ?? ''
    throw new MsAdsTokenError(
      `Microsoft token request failed (${res.status}): ${json.error ?? 'unknown_error'} ${detail}`.trim(),
      json.error ?? null,
    )
  }
  if (!json.access_token) throw new MsAdsTokenError('Microsoft token request returned no access_token', null)

  return {
    accessToken:  json.access_token,
    refreshToken: json.refresh_token ?? null,
    scope:        json.scope ?? '',
    expiresIn:    json.expires_in ?? 3600,
  }
}

export function exchangeMsAdsCode(code: string, redirectUri: string): Promise<MsAdsTokenSet> {
  return requestToken(new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: redirectUri,
  }))
}

export function refreshMsAdsToken(refreshToken: string): Promise<MsAdsTokenSet> {
  return requestToken(new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  }))
}
