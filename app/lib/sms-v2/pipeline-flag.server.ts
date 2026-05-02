/**
 * app/lib/sms-v2/pipeline-flag.server.ts
 *
 * Decides whether an inbound SMS message should be processed by v1 or v2.
 *
 * Two controls:
 *   SMS_V2_PHONES  — comma-separated E.164 allowlist (e.g. "+15555550100,+15555550101").
 *                    A phone in this list is ALWAYS routed to v2 regardless of the
 *                    global flag. Phase 0.5 used this for dark-launch; post-Phase 7
 *                    it's the override layer for special test phones.
 *   SMS_PIPELINE_VERSION — global default ('v1' | 'v2'). **Default is 'v2'** as of
 *                    Phase 7 cutover (2026-04-30). Setting `SMS_PIPELINE_VERSION=v1`
 *                    is the kill-switch for emergency rollback to the legacy path.
 *
 * Precedence: per-phone allowlist > SMS_PIPELINE_VERSION global flag.
 *
 * IMPORTANT — Fluid Compute env-var caching behaviour:
 *   Vercel reuses function instances across requests (Fluid Compute). Env vars
 *   are read once at module-load time and cached for the lifetime of the
 *   instance. A change to SMS_V2_PHONES or SMS_PIPELINE_VERSION via
 *   `vercel env add` only takes effect after a redeploy or `vercel env pull`
 *   + dev server restart. There is no hot-reload. This is intentional and
 *   acceptable for Phase 0.5's dark-launch use case; a redeploy is cheap.
 *
 * Testing note:
 *   The module memoises the parsed allowlist at load time. Smoke tests that
 *   need to exercise different env permutations must call __resetForTest()
 *   after mutating process.env, which re-parses the allowlist and re-reads the
 *   global flag. This avoids spawning a child process per permutation while
 *   keeping the hot-path allocation-free.
 */

/** Parse a comma-separated list of E.164 phone strings from an env value. */
export function parseAllowlist(envValue: string | undefined): Set<string> {
  if (!envValue) return new Set()
  return new Set(
    envValue
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  )
}

// Module-level memoised state — read once per cold start.
let _allowlist: Set<string> = parseAllowlist(process.env['SMS_V2_PHONES'])

// Warn once per cold start if the global flag is unrecognised (not 'v1' or 'v2').
let _warnedInvalidVersion = false

function readGlobalVersion(): 'v1' | 'v2' {
  // Default flipped to 'v2' in Phase 7 cutover (2026-04-30). Set
  // SMS_PIPELINE_VERSION=v1 as the kill-switch for emergency rollback.
  const raw = (process.env['SMS_PIPELINE_VERSION'] ?? 'v2').trim()
  if (raw === 'v1' || raw === 'v2') return raw
  if (!_warnedInvalidVersion) {
    console.warn(
      `[pipeline-flag] SMS_PIPELINE_VERSION='${raw}' is not 'v1' or 'v2' — coercing to 'v2'`,
    )
    _warnedInvalidVersion = true
  }
  return 'v2'
}

/**
 * Return 'v2' if phone is in the allowlist, otherwise fall back to the global
 * SMS_PIPELINE_VERSION env (default 'v2' as of Phase 7 cutover).
 */
export function pickPipelineVersion(phone: string): 'v1' | 'v2' {
  if (_allowlist.has(phone)) return 'v2'
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
  _allowlist = parseAllowlist(process.env['SMS_V2_PHONES'])
  _warnedInvalidVersion = false
}
