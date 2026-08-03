/**
 * ivr/src/v2-bridge.ts
 *
 * Phase 9 — HTTP bridge from the Fly.io IVR server to the Vercel v2 engine.
 *
 * callEngineV2() wraps the POST /api/emma-engine/turn request with:
 *   - One retry on 5xx (to absorb transient Vercel cold-start latency).
 *   - A 500ms p99 latency target warning (log + fall through to v1 if breached).
 *   - Typed request/response matching VoiceReply from the Vercel adapter.
 *
 * The Fly bridge calls this instead of the local Claude SDK loop when
 * pickIvrPipelineVersion() returns 'v2'.
 *
 * If the endpoint is unreachable, slow, or returns non-2xx after retry,
 * callEngineV2() returns null — the caller (server.ts) must fall through to
 * the v1 local path.
 */

const VERCEL_URL = process.env['VERCEL_URL'] ?? ''
const INTERNAL_API_SECRET = process.env['INTERNAL_API_SECRET'] ?? ''

// p99 latency budget for the Vercel round-trip (network hop + engine).
// If we exceed this we log a warning but still attempt to use the reply
// (only a hard timeout causes a null/fallback result).
//
// 500ms was a target for a template-only engine. The v2 engine now runs a
// Sonnet tool loop (classify -> search -> compose), which measured at a 3.8s
// mean and a 10.6s worst case across 177 logged voice turns. A 500ms threshold
// fires on essentially every turn, so the warning carried no signal.
const P99_TARGET_MS = Number(process.env['IVR_V2_P99_TARGET_MS'] ?? 3_000)

// Hard timeout for the entire HTTP round-trip. If the Vercel endpoint doesn't
// respond within this window we give up on the reply.
//
// This was 5s, which sat *below* the engine's real latency: 53 of 177 logged
// voice turns (30%) ran longer and were aborted here even though the Vercel
// side went on to answer, commit its state writes, and log the turn. The
// caller heard a v1 answer while the v2 conversation silently advanced a
// stage — the two engines desynced and the call fell apart. Sized above the
// observed worst case instead.
const HARD_TIMEOUT_MS = Number(process.env['IVR_V2_TIMEOUT_MS'] ?? 12_000)

// Ceiling on the whole call (both attempts). Without this, a 5xx on attempt 0
// followed by a slow retry could hold the caller for 2 x HARD_TIMEOUT_MS of
// dead air. When the remaining budget can't fit a meaningful retry, we stop.
const TOTAL_BUDGET_MS = Number(process.env['IVR_V2_TOTAL_BUDGET_MS'] ?? 16_000)

/** The VoiceReply shape returned by the Vercel engine. */
export interface VoiceReply {
  ssml: string
  prompts?: { kind: 'say-and-listen' | 'gather-digits' | 'hangup' } | undefined
  outboundSms?: { body: string } | undefined
  hangup?: boolean | undefined
}

interface TurnRequestBody {
  channel: 'voice'
  callerPhone: string
  customerText: string
  callSid: string
  conversationId?: string | undefined
  intentHint?: 'dtmf' | 'speech' | undefined
}

/**
 * Call the Vercel v2 engine for a single IVR turn.
 *
 * Returns null if the call fails or times out. What the caller does with that
 * depends on where it is in the call: server.ts only falls through to the v1
 * local Claude path on the FIRST turn. Once v2 has answered, a null means
 * "ask the caller to repeat" — swapping engines mid-conversation hands the
 * caller a different prompt, different memory, and a different tool set.
 */
export async function callEngineV2(body: TurnRequestBody): Promise<VoiceReply | null> {
  if (!VERCEL_URL || !INTERNAL_API_SECRET) {
    console.error('[v2-bridge] VERCEL_URL or INTERNAL_API_SECRET not set — cannot call v2 engine')
    return null
  }

  const url = `${VERCEL_URL}/api/emma-engine/turn`
  const started = Date.now()

  // Single retry on 5xx.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Never start an attempt we don't have budget to finish — the caller is
    // sitting in silence for every millisecond of this.
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started)
    if (attempt > 0 && remaining < 2_000) {
      console.warn(
        `[v2-bridge] retry skipped callSid=${body.callSid} remainingMs=${remaining} — out of budget`,
      )
      return null
    }
    const attemptTimeout = Math.min(HARD_TIMEOUT_MS, Math.max(remaining, 2_000))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), attemptTimeout)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': INTERNAL_API_SECRET,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const elapsed = Date.now() - started
      if (elapsed > P99_TARGET_MS) {
        console.warn(
          `[v2-bridge] latency ${elapsed}ms exceeds p99 target ${P99_TARGET_MS}ms callSid=${body.callSid} attempt=${attempt}`,
        )
      }

      if (res.ok) {
        const data = (await res.json()) as VoiceReply
        console.log(
          `[v2-bridge] ok callSid=${body.callSid} attempt=${attempt} elapsed=${elapsed}ms`,
        )
        return data
      }

      // 4xx errors are not retried (auth/validation failures are deterministic).
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => '')
        console.error(
          `[v2-bridge] 4xx error ${res.status} callSid=${body.callSid} attempt=${attempt}: ${text}`,
        )
        return null
      }

      // 5xx — retry once, then fall through.
      console.warn(
        `[v2-bridge] 5xx error ${res.status} callSid=${body.callSid} attempt=${attempt} — ${attempt < 1 ? 'retrying' : 'falling through to v1'}`,
      )
    } catch (err) {
      const elapsed = Date.now() - started
      const isAbort = err instanceof Error && err.name === 'AbortError'
      console.error(
        `[v2-bridge] ${isAbort ? 'timeout' : 'fetch error'} callSid=${body.callSid} attempt=${attempt} elapsed=${elapsed}ms`,
        isAbort ? undefined : err,
      )
      // Abort (timeout) or network error — fall through to v1 without retry.
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  console.error(`[v2-bridge] all attempts exhausted callSid=${body.callSid} — falling through to v1`)
  return null
}
