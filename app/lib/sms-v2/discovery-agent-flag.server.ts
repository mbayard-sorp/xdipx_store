/**
 * app/lib/sms-v2/discovery-agent-flag.server.ts
 *
 * Picks between the legacy gate-state-machine DISCOVERY handler ('v2-gate')
 * and the new Sonnet-driven discovery agent ('v2-agent').
 *
 * Three controls (precedence highest to lowest):
 *   DISCOVERY_AGENT_V2_PHONES    — comma-separated E.164 allowlist. A phone
 *                                  in this list is ALWAYS routed to v2-agent.
 *   DISCOVERY_AGENT_V2_SESSIONS  — comma-separated web session-id allowlist
 *                                  (the cookie UUID, NOT the `web:<id>`
 *                                  sentinel phone). Match → v2-agent.
 *   DISCOVERY_AGENT_VERSION      — global default ('v2-gate' | 'v2-agent').
 *                                  Defaults to 'v2-gate' so production
 *                                  behaviour is unchanged until we flip the
 *                                  flag.
 *
 * Mirrors the pipeline-flag.server.ts pattern: env vars are read once at
 * module-load, memoised, and re-read via __resetForTest() in tests.
 *
 * Fluid Compute caching: env-var changes only take effect after a redeploy
 * or `vercel env pull` + dev restart — same caveat as pipeline-flag.
 */

export type DiscoveryAgentVersion = 'v2-gate' | 'v2-agent'

/** Parse a comma-separated list of identifiers from an env value. */
export function parseAllowlist(envValue: string | undefined): Set<string> {
  if (!envValue) return new Set()
  return new Set(
    envValue
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

let _phoneAllowlist: Set<string> = parseAllowlist(process.env['DISCOVERY_AGENT_V2_PHONES'])
let _sessionAllowlist: Set<string> = parseAllowlist(process.env['DISCOVERY_AGENT_V2_SESSIONS'])
let _warnedInvalidVersion = false

function readGlobalVersion(): DiscoveryAgentVersion {
  const raw = (process.env['DISCOVERY_AGENT_VERSION'] ?? 'v2-gate').trim()
  if (raw === 'v2-gate' || raw === 'v2-agent') return raw
  if (!_warnedInvalidVersion) {
    console.warn(
      `[discovery-agent-flag] DISCOVERY_AGENT_VERSION='${raw}' is not 'v2-gate' or 'v2-agent' — coercing to 'v2-gate'`,
    )
    _warnedInvalidVersion = true
  }
  return 'v2-gate'
}

/**
 * Pick the discovery handler version for a given conversation.
 *
 * `phoneOrSessionId` accepts:
 *   - SMS / voice phone in E.164 form (e.g. "+16239001188")
 *   - Web sentinel phone "web:<sessionId>" — the function strips the prefix
 *     and matches against DISCOVERY_AGENT_V2_SESSIONS.
 *   - A bare web session id (no prefix) — also matched against the session
 *     allowlist for callers who already stripped the sentinel.
 */
export function pickDiscoveryAgentVersion(
  phoneOrSessionId: string,
): DiscoveryAgentVersion {
  if (!phoneOrSessionId) return readGlobalVersion()

  // Web sentinel: "web:<sessionId>"
  if (phoneOrSessionId.startsWith('web:')) {
    const sessionId = phoneOrSessionId.slice('web:'.length)
    if (_sessionAllowlist.has(sessionId)) return 'v2-agent'
    return readGlobalVersion()
  }

  // E.164 phone — check phone allowlist first, then session allowlist (in case
  // the caller passed a bare session id).
  if (_phoneAllowlist.has(phoneOrSessionId)) return 'v2-agent'
  if (_sessionAllowlist.has(phoneOrSessionId)) return 'v2-agent'

  return readGlobalVersion()
}

/**
 * Re-read env vars and reset module state. Test-only. Mirror of
 * pipeline-flag.server.ts/__resetForTest. Not safe to call from production
 * request handlers (mutating module state under concurrent reads).
 */
export function __resetForTest(): void {
  _phoneAllowlist = parseAllowlist(process.env['DISCOVERY_AGENT_V2_PHONES'])
  _sessionAllowlist = parseAllowlist(process.env['DISCOVERY_AGENT_V2_SESSIONS'])
  _warnedInvalidVersion = false
}
