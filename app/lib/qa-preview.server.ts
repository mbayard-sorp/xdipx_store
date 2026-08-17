/**
 * QA preview age-gate bypass (ticket #2826).
 *
 * POST /api/team/pr op:preview-fetch is a plain server-side GET with no JS
 * execution, and the age gate is client-only localStorage, so the proxied HTML
 * always showed the pre-verification AgeGatePanel branch on every gated route
 * (/, /social, /discover, the cart drawer). QA could never visually confirm
 * past-the-gate markup (hit live on ticket #2814 / PR #619).
 *
 * The bypass is a request header carrying an HMAC derived from the team
 * secret. The proxying route (api.team.pr.tsx, which already authenticated the
 * caller with assertTeamAuth) attaches it to the fetch it makes against the PR
 * preview; the root loader on the receiving deployment verifies it against its
 * OWN copy of the same secret and, only then, tells the age-gate hook to
 * render verified. Properties that keep the real gate intact:
 *
 *   - The header value is HMAC-SHA256(secret, fixed context string), never the
 *     secret itself, so the secret is not exposed to the preview's logs.
 *   - Verification is timing-safe and requires the secret to be configured on
 *     the receiving deployment; with no secret the bypass is inert.
 *   - Real visitors cannot produce the value without the secret, and nothing
 *     client-side ever sees it: no cookie is set, no flag is persisted; the
 *     bypass lives and dies with the single server-rendered response.
 *
 * Server-only. Never import from a client component.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Header the QA proxy sends and the root loader reads. */
export const QA_AGE_BYPASS_HEADER = 'x-xdipx-qa-age-bypass'

/** Fixed HMAC context — versioned so a future rotation invalidates old values. */
const HMAC_CONTEXT = 'xdipx-qa-age-bypass-v1'

/**
 * The secrets a bypass may be derived from — the same chain assertTeamAuth
 * accepts, so any deployment that can authenticate team calls can also verify
 * the bypass. First configured value wins on the SENDING side; the RECEIVING
 * side accepts a match against any of them (sender and receiver may be
 * different deployments with different subsets configured).
 */
function candidateSecrets(): string[] {
  return [
    process.env['TEAM_TOKEN'],
    process.env['HOMEPAGE_TEAM_TOKEN'],
    process.env['CRON_SECRET'],
  ].filter((s): s is string => typeof s === 'string' && s.length > 0)
}

function tokenFor(secret: string): string {
  return createHmac('sha256', secret).update(HMAC_CONTEXT).digest('hex')
}

/**
 * The header value to attach to a QA proxy fetch, or null when no team secret
 * is configured (the bypass simply isn't sent).
 */
export function qaAgeBypassToken(): string | null {
  const secret = candidateSecrets()[0]
  return secret ? tokenFor(secret) : null
}

/**
 * True only when the request carries a QA age-bypass header whose HMAC matches
 * one derived from a configured team secret. Timing-safe; false on any
 * missing/malformed input. This is read by the root loader on EVERY request,
 * so it must stay cheap: one header read, and HMACs only when it is present.
 */
export function isQaAgeBypassRequest(request: Request): boolean {
  const presented = request.headers.get(QA_AGE_BYPASS_HEADER)
  if (!presented) return false
  const presentedBuf = Buffer.from(presented)
  for (const secret of candidateSecrets()) {
    const expected = Buffer.from(tokenFor(secret))
    if (presentedBuf.length === expected.length && timingSafeEqual(presentedBuf, expected)) {
      return true
    }
  }
  return false
}
