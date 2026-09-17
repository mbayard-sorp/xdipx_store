/**
 * Reddit Ads OAuth 2.0 helpers.
 *
 * Required env vars:
 *   REDDIT_ADS_CLIENT_ID      - the Reddit app id (Ads Manager -> Apps -> Create App).
 *                               Falls back to REDDIT_CLIENT_ID, which is what .env uses today.
 *   REDDIT_ADS_CLIENT_SECRET  - the same app's secret.
 *                               Falls back to REDDIT_CLIENT_SECRET.
 *
 * Optional env vars:
 *   REDDIT_ADS_SCOPES         - override the requested scopes. Default 'adsread'.
 *                               Reddit's ads scopes are adsread, adsedit, adsconversions,
 *                               plus the generic history and read. Only widen this with
 *                               owner sign-off: the ads lane is propose-only (see
 *                               docs/ads-policy.md and .claude/agents/ads-manager.md),
 *                               and adsedit is a write scope that can spend money.
 *   REDDIT_ADS_REDIRECT_URI   - the exact registered redirect URI, when it is not
 *                               "<APP_URL>/api/reddit-callback".
 *   REDDIT_ADS_USER_AGENT     - override the User-Agent sent to Reddit.
 *                               Falls back to REDDIT_USER_AGENT.
 *
 * Setup:
 *   1. Register the app with redirect URI https://xdipx.com/api/reddit-callback
 *   2. Hit /api/reddit-connect signed in as an admin, approve on Reddit, and copy the
 *      refresh token the callback prints. It is shown exactly once and never stored.
 *   3. Put it in Vercel as REDDIT_ADS_REFRESH_TOKEN for the API client to consume.
 *
 * Two Reddit quirks this file exists to absorb:
 *   - duration=permanent is what makes Reddit return a refresh token. Without it you get
 *     a one-hour access token and nothing else, which is useless to a cron.
 *   - Reddit rate-limits generic User-Agents hard, so every call sends a descriptive one.
 *
 * Access tokens last one hour. Nothing here writes a token to the database or to a log.
 */

import crypto from 'node:crypto'
import { createCookie } from 'react-router'
import { requireSecret } from './env.server'

const isProd = process.env['NODE_ENV'] === 'production'

// REDDIT_ADS_* wins when a dedicated Ads app is registered separately; the plain
// REDDIT_* names are what the store's existing .env already uses.
const CLIENT_ID     = process.env['REDDIT_ADS_CLIENT_ID']     || process.env['REDDIT_CLIENT_ID']     || ''
const CLIENT_SECRET = process.env['REDDIT_ADS_CLIENT_SECRET'] || process.env['REDDIT_CLIENT_SECRET'] || ''

const AUTHORIZE_URL = 'https://www.reddit.com/api/v1/authorize'
const TOKEN_URL     = 'https://www.reddit.com/api/v1/access_token'

/** Reddit wants a comma-separated scope list; accept either separator in the env override. */
const SCOPES = (process.env['REDDIT_ADS_SCOPES'] || 'adsread')
  .split(/[\s,]+/)
  .filter(Boolean)
  .join(',')

const USER_AGENT = process.env['REDDIT_ADS_USER_AGENT']
  || process.env['REDDIT_USER_AGENT']
  || 'web:com.xdipx.ads-reporting:v1.0 (by /u/xdipx)'

export const REDDIT_ADS_OAUTH_ENABLED = !!(CLIENT_ID && CLIENT_SECRET)

/** The scopes this deploy will ask for, for display on the callback page. */
export const REDDIT_ADS_SCOPES = SCOPES

// -- CSRF state cookie --------------------------------------------------------
// Short-lived and signed. sameSite must stay 'lax' so it survives the top-level
// redirect back from reddit.com.

export const redditOAuthStateCookie = createCookie('__xdipx_reddit_oauth', {
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
 * The redirect URI, which must be byte-identical in the authorize call and the token
 * exchange or Reddit rejects the code. Prefers the configured production URL over the
 * request origin so a preview deploy cannot mint a URI Reddit has never seen.
 */
export function redditRedirectUri(request: Request): string {
  const base = process.env['REDDIT_ADS_REDIRECT_URI']
  if (base) return base
  const origin = process.env['APP_URL'] || new URL(request.url).origin
  return new URL('/api/reddit-callback', origin).toString()
}

// -- Auth URL -----------------------------------------------------------------

export function getRedditAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: 'code',
    state,
    redirect_uri:  redirectUri,
    duration:      'permanent',
    scope:         SCOPES,
  })
  return `${AUTHORIZE_URL}?${params}`
}

// -- Token exchange -----------------------------------------------------------

export interface RedditTokenSet {
  accessToken:  string
  /** Only returned by the authorization-code exchange, and only with duration=permanent. */
  refreshToken: string | null
  scope:        string
  expiresIn:    number
}

async function requestToken(body: URLSearchParams): Promise<RedditTokenSet> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   USER_AGENT,
    },
    body,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Reddit token request failed (${res.status}): ${text.slice(0, 300)}`)
  }

  let json: { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string }
  try {
    json = JSON.parse(text) as typeof json
  } catch {
    throw new Error(`Reddit token request returned non-JSON: ${text.slice(0, 300)}`)
  }

  // Reddit answers 200 with an {error} body for bad grants, so status alone is not enough.
  if (json.error) throw new Error(`Reddit token request rejected: ${json.error}`)
  if (!json.access_token) throw new Error('Reddit token request returned no access_token')

  return {
    accessToken:  json.access_token,
    refreshToken: json.refresh_token ?? null,
    scope:        json.scope ?? '',
    expiresIn:    json.expires_in ?? 3600,
  }
}

export async function exchangeRedditCode(code: string, redirectUri: string): Promise<RedditTokenSet> {
  return requestToken(new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: redirectUri,
  }))
}

/**
 * Trade the stored refresh token for a fresh one-hour access token. The counterpart to
 * the callback: without this the minted refresh token has no consumer.
 */
export async function refreshRedditAccessToken(refreshToken: string): Promise<RedditTokenSet> {
  return requestToken(new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  }))
}
