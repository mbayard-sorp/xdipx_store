import type { ActionFunctionArgs } from 'react-router'

/**
 * Klaviyo webhook handler.
 * Receives events from Klaviyo (e.g. unsubscribes, bounces).
 * Signature verification should be added when Klaviyo provides a secret.
 */
export async function action({ request }: ActionFunctionArgs) {
  // Klaviyo sends JSON payloads
  const payload = await request.json().catch(() => null)
  if (!payload) return Response.json({ ok: true })

  // Log for now — add handlers per event type as needed
  console.log('[klaviyo webhook]', JSON.stringify(payload).slice(0, 200))

  return Response.json({ ok: true })
}
