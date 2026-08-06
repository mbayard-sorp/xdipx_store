/**
 * Q&A catalog tools — proxy to the Vercel /api/internal/qa-tool endpoint so
 * we share one implementation (and MAP rule logic) with SMS.
 */
const APP_URL = process.env['XDIPX_APP_URL'] ?? 'https://xdipx.com'
const SECRET = process.env['INTERNAL_API_SECRET'] ?? ''

// Hard timeout on the qa-tool proxy round-trip. Without it a hung proxy call is
// unbounded dead air on a live phone call: the silence re-engage timer is
// cleared on message receipt (server.ts) and only re-armed after the whole turn
// resolves, so an unbounded fetch holds the caller in silence until the call
// cap. 6s sits comfortably above the endpoint's normal latency. Env-overridable
// for the same reason IVR_V2_TIMEOUT_MS is (see v2-bridge.ts). Note: Fly does
// not read Vercel env, so overriding needs `fly secrets set IVR_QA_TOOL_TIMEOUT_MS`.
const QA_TOOL_TIMEOUT_MS = Number(process.env['IVR_QA_TOOL_TIMEOUT_MS'] ?? 6_000)

export async function callQaTool(
  tool: string,
  input: Record<string, unknown>,
  ctx?: { phone?: string; channel?: 'voice' | 'sms' },
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${APP_URL}/api/internal/qa-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ tool, input, phone: ctx?.phone, channel: ctx?.channel ?? 'voice' }),
      signal: AbortSignal.timeout(QA_TOOL_TIMEOUT_MS),
    })
  } catch (err) {
    // AbortSignal.timeout raises a TimeoutError; other transport failures land
    // here too. Return the same degradable proxy_failed shape as an HTTP error
    // so the tool loop speaks a fallback instead of hanging on dead air.
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'fetch'
    return { ok: false, error: `proxy_failed_${reason}` }
  }
  if (!res.ok) {
    return { ok: false, error: `proxy_failed_${res.status}` }
  }
  return (await res.json()) as unknown
}
