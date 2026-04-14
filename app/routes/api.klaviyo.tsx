import type { ActionFunctionArgs } from 'react-router'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

/**
 * Klaviyo webhook handler.
 * Klaviyo does not sign webhooks, so this endpoint is anonymous by design.
 * Defensive posture: rate-limit per IP and cap body size. The route only logs
 * — no side effects — so abuse is low-impact today. Add signature verification
 * if Klaviyo ever publishes a secret.
 */
export async function action({ request }: ActionFunctionArgs) {
  const rl = await checkRateLimit(request, 'klaviyo-hook', 60, 60)
  if (!rl.ok) return rateLimited()

  const raw = await request.text().catch(() => '')
  if (raw.length > 8_192) return Response.json({ ok: true }) // drop oversized payloads silently
  try {
    const payload = JSON.parse(raw) as unknown
    console.log('[klaviyo webhook]', JSON.stringify(payload).slice(0, 200))
  } catch {
    // ignore
  }

  return Response.json({ ok: true })
}
