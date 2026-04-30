/**
 * app/lib/sms-v2/web-pipeline-flag.server.ts
 *
 * Web chat equivalent of pipeline-flag.server.ts.
 *
 * Two controls:
 *   WEB_PIPELINE_VERSION — global default ('v1' | 'v2'). Default is 'v1' for
 *                          now (Phase 7-equivalent web cutover is a separate
 *                          future phase). Set 'v2' to flip web globally.
 *   WEB_V2_SESSIONS      — comma-separated session-id allowlist for dark-launch.
 *                          A session in this list is ALWAYS routed to v2
 *                          regardless of the global flag.
 *
 * Precedence: per-session allowlist > WEB_PIPELINE_VERSION global flag.
 *
 * This is intentionally a SIBLING of pipeline-flag.server.ts — different env
 * vars, different identifier (phone vs session id). Do not merge them.
 *
 * IMPORTANT — Fluid Compute env-var caching behaviour:
 *   Vercel reuses function instances across requests. Env vars are read once at
 *   module-load time and cached for the lifetime of the instance. A change to
 *   WEB_V2_SESSIONS or WEB_PIPELINE_VERSION via `vercel env add` only takes
 *   effect after a redeploy or dev server restart. This is intentional.
 *
 * Testing note:
 *   The module memoises the parsed allowlist at load time. Call __resetForTest()
 *   after mutating process.env to re-parse the allowlist and re-read the global
 *   flag. NOT safe to call from production request handlers.
 */

/** Parse a comma-separated list of session-id strings from an env value. */
export function parseSessionAllowlist(envValue: string | undefined): Set<string> {
  if (!envValue) return new Set()
  return new Set(
    envValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

// Module-level memoised state — read once per cold start.
let _allowlist: Set<string> = parseSessionAllowlist(process.env['WEB_V2_SESSIONS'])

// Warn once per cold start if the global flag is unrecognised.
let _warnedInvalidVersion = false

function readGlobalVersion(): 'v1' | 'v2' {
  // Default is 'v1' for web (Phase 7-equivalent cutover is a separate future phase).
  const raw = (process.env['WEB_PIPELINE_VERSION'] ?? 'v1').trim()
  if (raw === 'v1' || raw === 'v2') return raw
  if (!_warnedInvalidVersion) {
    console.warn(
      `[web-pipeline-flag] WEB_PIPELINE_VERSION='${raw}' is not 'v1' or 'v2' — coercing to 'v1'`,
    )
    _warnedInvalidVersion = true
  }
  return 'v1'
}

/**
 * Return 'v2' if sessionId is in the allowlist, otherwise fall back to the
 * global WEB_PIPELINE_VERSION env (default 'v1').
 */
export function pickWebPipelineVersion(sessionId: string): 'v1' | 'v2' {
  if (_allowlist.has(sessionId)) return 'v2'
  return readGlobalVersion()
}

/**
 * Re-read env vars and reset module state. Intended for smoke tests only —
 * call after mutating process.env to simulate a different deployment config
 * without spawning a child process.
 *
 * NOT safe to call from production request handlers.
 */
export function __resetForTest(): void {
  _allowlist = parseSessionAllowlist(process.env['WEB_V2_SESSIONS'])
  _warnedInvalidVersion = false
}
