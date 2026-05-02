/**
 * app/lib/sms-v2/ivr-pipeline-flag.server.ts
 *
 * Phase 9 — IVR pipeline version flag.
 *
 * Mirrors the SMS pipeline-flag pattern (pipeline-flag.server.ts) for the
 * voice (IVR) channel.
 *
 * Two controls:
 *   IVR_PIPELINE_VERSION  — global default ('v1' | 'v2'). Default is 'v1'.
 *                           Phase 9 does NOT flip the default — that is a
 *                           Phase 10 / operations decision. Set
 *                           IVR_PIPELINE_VERSION=v2 to route all callers to
 *                           the v2 engine.
 *
 *   IVR_V2_PHONES         — comma-separated E.164 allowlist. A phone in this
 *                           list is ALWAYS routed to v2 regardless of the
 *                           global flag. Use for dark-launch testing before
 *                           flipping the global default.
 *
 * Precedence: per-phone allowlist > IVR_PIPELINE_VERSION global flag.
 *
 * IMPORTANT — Fluid Compute env-var caching:
 *   Vercel reuses function instances. Env vars are read once at module-load
 *   time. A change to IVR_V2_PHONES or IVR_PIPELINE_VERSION only takes
 *   effect after a redeploy or dev server restart. This is intentional.
 *
 * Testing note:
 *   Call __resetForTest() after mutating process.env to re-parse the
 *   allowlist without spawning a child process. NOT safe in production
 *   request handlers.
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
let _allowlist: Set<string> = parseAllowlist(process.env['IVR_V2_PHONES'])

// Warn once per cold start if the global flag is unrecognised.
let _warnedInvalidVersion = false

function readGlobalVersion(): 'v1' | 'v2' {
  // Default is 'v1' — Phase 9 does not flip the IVR default.
  // Set IVR_PIPELINE_VERSION=v2 to enable globally.
  const raw = (process.env['IVR_PIPELINE_VERSION'] ?? 'v1').trim()
  if (raw === 'v1' || raw === 'v2') return raw
  if (!_warnedInvalidVersion) {
    console.warn(
      `[ivr-pipeline-flag] IVR_PIPELINE_VERSION='${raw}' is not 'v1' or 'v2' — coercing to 'v1'`,
    )
    _warnedInvalidVersion = true
  }
  return 'v1'
}

/**
 * Return 'v2' if phone is in the IVR_V2_PHONES allowlist, otherwise fall back
 * to the global IVR_PIPELINE_VERSION env (default 'v1' in Phase 9).
 */
export function pickIvrPipelineVersion(callerPhone: string): 'v1' | 'v2' {
  if (_allowlist.has(callerPhone)) return 'v2'
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
  _allowlist = parseAllowlist(process.env['IVR_V2_PHONES'])
  _warnedInvalidVersion = false
}
