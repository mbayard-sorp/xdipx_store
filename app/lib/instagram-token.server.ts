/**
 * Instagram Graph API access-token auto-refresh (ticket #13153, owner-away
 * all-hands 2026-10-02).
 *
 * `IG_GRAPH_ACCESS_TOKEN` is a 60-day Instagram Business Login token
 * (app/lib/social-publish/instagram.server.ts header comment). Its Vercel
 * production var was created 2026-08-07 and never updated, so it lapses on
 * its own schedule with nothing watching. `graph.facebook.com`'s
 * `debug_token` endpoint rejects IG tokens (error code 190), so expiry
 * cannot be read back from Meta — the only way to know when a token expires
 * is to record what Meta told us the last time we refreshed it.
 *
 * This module is the single source of truth for "what Instagram token
 * should every caller use right now": `getInstagramAccessToken()` reads the
 * newest successfully-refreshed token from `instagram_token_refreshes`,
 * falling back to `IG_GRAPH_ACCESS_TOKEN` when the table is empty (before
 * the first successful refresh, or on a DB read failure). Every reader that
 * used to read `process.env['IG_GRAPH_ACCESS_TOKEN']` directly now calls
 * this instead.
 *
 * `refreshInstagramAccessToken()` is the weekly cron's actual work: call
 * Meta's long-lived-token refresh endpoint with the CURRENT token (valid
 * only when that token is itself unexpired and at least 24h old, per Meta's
 * own rule), and record the result. A failure records the error and leaves
 * every existing row alone — the table is append-only specifically so a bad
 * refresh attempt can never clobber the last known-good token.
 *
 * The token itself is never logged, in this file or by its callers.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { instagramTokenRefreshes } from '../../db/schema'

const REFRESH_ENDPOINT = 'https://graph.instagram.com/refresh_access_token'

/** Days out at which the stored token's expiry is worth an owner warning. */
export const EXPIRY_WARNING_DAYS = 10
/** Days without a successful refresh at which silence itself is worth a warning. */
export const STALE_REFRESH_DAYS = 14

interface LatestRefreshRow {
  accessToken: string | null
  expiresAt: Date | null
  success: boolean
  attemptedAt: Date
}

/** The most recent refresh attempt, success or failure, newest first. Null when the table is empty. */
async function getLatestAttempt(): Promise<LatestRefreshRow | null> {
  const rows = await db
    .select({
      accessToken: instagramTokenRefreshes.accessToken,
      expiresAt: instagramTokenRefreshes.expiresAt,
      success: instagramTokenRefreshes.success,
      attemptedAt: instagramTokenRefreshes.attemptedAt,
    })
    .from(instagramTokenRefreshes)
    .orderBy(desc(instagramTokenRefreshes.attemptedAt))
    .limit(1)
  return rows[0] ?? null
}

/** The most recent SUCCESSFUL refresh, newest first. Null when none has ever succeeded. */
async function getLatestSuccess(): Promise<LatestRefreshRow | null> {
  const rows = await db
    .select({
      accessToken: instagramTokenRefreshes.accessToken,
      expiresAt: instagramTokenRefreshes.expiresAt,
      success: instagramTokenRefreshes.success,
      attemptedAt: instagramTokenRefreshes.attemptedAt,
    })
    .from(instagramTokenRefreshes)
    .where(eq(instagramTokenRefreshes.success, true))
    .orderBy(desc(instagramTokenRefreshes.attemptedAt))
    .limit(1)
  return rows[0] ?? null
}

/**
 * The token every Instagram caller should use right now: the newest
 * successfully-refreshed token if one exists, otherwise the env var. Never
 * throws — a DB read failure falls back to env exactly like an empty table
 * does, so a Neon blip degrades to today's behavior rather than taking
 * Instagram down.
 */
export async function getInstagramAccessToken(): Promise<string | null> {
  try {
    const latest = await getLatestSuccess()
    if (latest?.accessToken) return latest.accessToken
  } catch (err) {
    console.error('[instagram-token] DB read failed, falling back to env (ignored):', err)
  }
  return process.env['IG_GRAPH_ACCESS_TOKEN']?.trim() || null
}

interface RawRefreshResponse {
  access_token: string
  token_type?: string
  expires_in: number
}

function isValidRefreshResponse(v: unknown): v is RawRefreshResponse {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o['access_token'] === 'string' && o['access_token'].length > 0 && typeof o['expires_in'] === 'number'
}

export interface RefreshResult {
  ok: boolean
  detail: string
  expiresAt: Date | null
}

export interface RefreshDeps {
  fetch?: typeof fetch
  currentToken?: () => Promise<string | null>
}

/**
 * Call Meta's long-lived-token refresh endpoint with the current token and
 * record the result. Never throws: a failure (no current token, a network
 * error, a non-2xx response, or an unrecognised response shape) is recorded
 * as a failed attempt and the function returns `{ ok: false, ... }` — it
 * never leaves the last known-good row unreadable, and it never retries
 * inline (the weekly cron is the retry).
 */
export async function refreshInstagramAccessToken(deps: RefreshDeps = {}): Promise<RefreshResult> {
  const doFetch = deps.fetch ?? fetch
  const currentToken = deps.currentToken ?? getInstagramAccessToken
  const current = await currentToken()
  if (!current) {
    const detail = 'no current Instagram token to refresh (IG_GRAPH_ACCESS_TOKEN unset and no prior successful refresh)'
    await recordAttempt({ success: false, error: detail })
    return { ok: false, detail, expiresAt: null }
  }

  try {
    const url = `${REFRESH_ENDPOINT}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`
    const res = await doFetch(url, { method: 'GET' })
    if (!res.ok) {
      // Never log the response body — it can echo the access_token back on
      // some error shapes, and the status code is enough to act on.
      const detail = `refresh_access_token HTTP ${res.status}`
      await recordAttempt({ success: false, error: detail })
      return { ok: false, detail, expiresAt: null }
    }
    const body = await res.json().catch(() => null)
    if (!isValidRefreshResponse(body)) {
      const detail = 'refresh_access_token returned an unrecognised response shape'
      await recordAttempt({ success: false, error: detail })
      return { ok: false, detail, expiresAt: null }
    }
    const expiresAt = new Date(Date.now() + body.expires_in * 1000)
    await recordAttempt({ success: true, accessToken: body.access_token, expiresAt })
    return { ok: true, detail: `refreshed, expires ${expiresAt.toISOString()}`, expiresAt }
  } catch (err) {
    const detail = `refresh_access_token request failed: ${err instanceof Error ? err.message : String(err)}`
    await recordAttempt({ success: false, error: detail })
    return { ok: false, detail, expiresAt: null }
  }
}

async function recordAttempt(row: { success: boolean; accessToken?: string; expiresAt?: Date; error?: string }): Promise<void> {
  try {
    await db.insert(instagramTokenRefreshes).values({
      success: row.success,
      accessToken: row.accessToken ?? null,
      expiresAt: row.expiresAt ?? null,
      error: row.error ?? null,
    })
  } catch (err) {
    // Bookkeeping must never be why a refresh that otherwise worked looks
    // like a failure to the caller — but it already has the real result by
    // the time this runs, so this can only make the NEXT read stale, not
    // this one wrong. Surfaced loudly so it doesn't stay silently stale.
    console.error('[instagram-token] could not record refresh attempt (ignored):', err)
  }
}

export interface ExpiryWarning {
  warn: boolean
  reason: string | null
  expiresAt: string | null
  lastSuccessAt: string | null
}

/**
 * Should the owner be warned about the Instagram token right now?
 *
 * Deliberately silent (never warns) when no refresh has ever succeeded: that
 * is "the cron has not run yet" or "the table predates this ticket", which
 * the cron-liveness floor (app/lib/cron-expectations.ts) already catches as
 * a missed schedule — duplicating that here would just be a second, worse
 * copy of the same check. Once at least one refresh has succeeded, this
 * warns when either the stored expiry is close (EXPIRY_WARNING_DAYS) or the
 * last success is stale (STALE_REFRESH_DAYS) — the second clause is what
 * catches a token that technically hasn't expired yet but whose refresh has
 * been silently failing every week.
 */
export async function checkInstagramTokenExpiryWarning(): Promise<ExpiryWarning> {
  const latestSuccess = await getLatestSuccess()
  if (!latestSuccess) {
    return { warn: false, reason: null, expiresAt: null, lastSuccessAt: null }
  }
  const now = Date.now()
  const reasons: string[] = []
  if (latestSuccess.expiresAt) {
    const daysToExpiry = (latestSuccess.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)
    if (daysToExpiry < EXPIRY_WARNING_DAYS) {
      reasons.push(`expires in ${daysToExpiry.toFixed(1)} days (${latestSuccess.expiresAt.toISOString()})`)
    }
  }
  const daysSinceSuccess = (now - latestSuccess.attemptedAt.getTime()) / (24 * 60 * 60 * 1000)
  if (daysSinceSuccess > STALE_REFRESH_DAYS) {
    reasons.push(`no successful refresh in ${daysSinceSuccess.toFixed(1)} days`)
  }
  return {
    warn: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join('; ') : null,
    expiresAt: latestSuccess.expiresAt?.toISOString() ?? null,
    lastSuccessAt: latestSuccess.attemptedAt.toISOString(),
  }
}

// Exported for the weekly cron's own logging and for tests that want to
// assert against the raw attempt history rather than just the derived getter.
export { getLatestAttempt, getLatestSuccess }
