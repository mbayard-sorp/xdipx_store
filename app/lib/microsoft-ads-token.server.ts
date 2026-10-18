/**
 * Microsoft Advertising access tokens: the single place every API call gets
 * one from.
 *
 * The refresh token lives encrypted in `microsoft_ads_tokens` (migration
 * 125), append-only, one row per connect or refresh attempt. The newest
 * SUCCESSFUL row for the active MSADS_ENV is the current token; a failed
 * refresh writes a failure row and leaves every good row alone, the same
 * shape as instagram_token_refreshes.
 *
 * Access tokens last about an hour and are cached in module memory per env,
 * so a warm function refreshes at most once an hour. A cold start refreshes
 * once. When Microsoft rotates the refresh token, the new one is stored as a
 * new row before the access token is handed out.
 *
 * `invalid_grant` means consent is gone (password change, revoked app,
 * expiry). Nothing can recover that automatically; the error says to
 * reconnect at /api/microsoft-ads-connect.
 *
 * No token is ever logged, here or by callers.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { microsoftAdsTokens } from '../../db/schema'
import { decryptToken, encryptToken, msAdsEnv, type MsAdsEnv } from './microsoft-ads-core'
import { MsAdsTokenError, refreshMsAdsToken } from './microsoft-ads-oauth.server'

/** Refresh this long before Microsoft's stated expiry. */
const EXPIRY_SKEW_MS = 5 * 60_000

const cache = new Map<MsAdsEnv, { token: string; expiresAt: number }>()

function tokenKey(): string {
  const key = process.env['MSADS_TOKEN_KEY']
  if (!key) throw new Error('MSADS_TOKEN_KEY is not set')
  return key
}

export class MsAdsNotConnectedError extends Error {
  constructor(env: MsAdsEnv, reason: string) {
    super(`Microsoft Ads (${env}) is not connected: ${reason}. Reconnect at /api/microsoft-ads-connect.`)
    this.name = 'MsAdsNotConnectedError'
  }
}

/**
 * Store the refresh token minted by the connect flow, and seed the cache with
 * the access token from the same exchange so the first call does not refresh.
 */
export async function recordMsAdsConnect(t: {
  refreshToken: string; scope: string; accessToken: string; expiresIn: number
}): Promise<void> {
  const env = msAdsEnv()
  await db.insert(microsoftAdsTokens).values({
    env,
    refreshTokenEnc: encryptToken(t.refreshToken, tokenKey()),
    scope:   t.scope,
    source:  'connect',
    success: true,
  })
  cache.set(env, { token: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 - EXPIRY_SKEW_MS })
}

async function latestGoodRow(env: MsAdsEnv) {
  const rows = await db
    .select({ refreshTokenEnc: microsoftAdsTokens.refreshTokenEnc, scope: microsoftAdsTokens.scope })
    .from(microsoftAdsTokens)
    .where(and(eq(microsoftAdsTokens.env, env), eq(microsoftAdsTokens.success, true)))
    .orderBy(desc(microsoftAdsTokens.attemptedAt), desc(microsoftAdsTokens.id))
    .limit(1)
  return rows[0] ?? null
}

/** A valid access token for the active MSADS_ENV, refreshing (and rotating) as needed. */
export async function getMsAdsAccessToken(): Promise<string> {
  const env = msAdsEnv()
  const hit = cache.get(env)
  if (hit && hit.expiresAt > Date.now()) return hit.token

  const row = await latestGoodRow(env)
  if (!row?.refreshTokenEnc) throw new MsAdsNotConnectedError(env, 'no stored refresh token')

  const key = tokenKey()
  let refreshToken: string
  try {
    refreshToken = decryptToken(row.refreshTokenEnc, key)
  } catch {
    // Wrong or rotated MSADS_TOKEN_KEY. The stored row is unreadable, not wrong.
    throw new MsAdsNotConnectedError(env, 'stored token cannot be decrypted with the current MSADS_TOKEN_KEY')
  }

  try {
    const t = await refreshMsAdsToken(refreshToken)
    if (t.refreshToken && t.refreshToken !== refreshToken) {
      await db.insert(microsoftAdsTokens).values({
        env,
        refreshTokenEnc: encryptToken(t.refreshToken, key),
        scope:   t.scope || row.scope,
        source:  'refresh',
        success: true,
      })
    }
    cache.set(env, { token: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 - EXPIRY_SKEW_MS })
    return t.accessToken
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.insert(microsoftAdsTokens).values({
      env,
      refreshTokenEnc: null,
      source:  'refresh',
      success: false,
      error:   message.slice(0, 500),
    }).catch(() => { /* recording the failure must not mask it */ })
    if (err instanceof MsAdsTokenError && err.oauthError === 'invalid_grant') {
      throw new MsAdsNotConnectedError(env, 'Microsoft rejected the stored refresh token (invalid_grant)')
    }
    throw err
  }
}

export interface MsAdsTokenStatus {
  env:           MsAdsEnv
  connected:     boolean
  lastSuccessAt: Date | null
  lastAttemptAt: Date | null
  lastError:     string | null
}

/** For the connect page and health checks. Never returns token material. */
export async function getMsAdsTokenStatus(): Promise<MsAdsTokenStatus> {
  const env = msAdsEnv()
  const [last] = await db
    .select({ success: microsoftAdsTokens.success, error: microsoftAdsTokens.error, at: microsoftAdsTokens.attemptedAt })
    .from(microsoftAdsTokens)
    .where(eq(microsoftAdsTokens.env, env))
    .orderBy(desc(microsoftAdsTokens.attemptedAt), desc(microsoftAdsTokens.id))
    .limit(1)
  const [good] = await db
    .select({ at: microsoftAdsTokens.attemptedAt })
    .from(microsoftAdsTokens)
    .where(and(eq(microsoftAdsTokens.env, env), eq(microsoftAdsTokens.success, true)))
    .orderBy(desc(microsoftAdsTokens.attemptedAt), desc(microsoftAdsTokens.id))
    .limit(1)
  return {
    env,
    connected:     !!good,
    lastSuccessAt: good?.at ?? null,
    lastAttemptAt: last?.at ?? null,
    lastError:     last && !last.success ? last.error : null,
  }
}
