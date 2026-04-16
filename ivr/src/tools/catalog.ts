/**
 * Q&A catalog tools — proxy to the Vercel /api/internal/qa-tool endpoint so
 * we share one implementation (and MAP rule logic) with SMS.
 */
const APP_URL = process.env['XDIPX_APP_URL'] ?? 'https://xdipx.com'
const SECRET = process.env['INTERNAL_API_SECRET'] ?? ''

export async function callQaTool(
  tool: string,
  input: Record<string, unknown>,
  ctx?: { phone?: string; channel?: 'voice' | 'sms' },
): Promise<unknown> {
  const res = await fetch(`${APP_URL}/api/internal/qa-tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': SECRET,
    },
    body: JSON.stringify({ tool, input, phone: ctx?.phone, channel: ctx?.channel ?? 'voice' }),
  })
  if (!res.ok) {
    return { ok: false, error: `proxy_failed_${res.status}` }
  }
  return (await res.json()) as unknown
}
