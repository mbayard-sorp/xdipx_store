/**
 * Shopify Orders/create webhook — React Router action handler.
 * NOTE: The primary webhook handler lives in server/webhooks.ts (Express route)
 * for proper raw-body HMAC verification.
 *
 * This route exists as a fallback / for environments that route all traffic
 * through React Router. HMAC verification requires the raw body which is
 * available in the Express handler.
 */
import type { ActionFunctionArgs } from 'react-router'

export async function action({ request }: ActionFunctionArgs) {
  // Actual handling is in server/webhooks.ts
  // This route is a no-op stub to prevent 404s if Shopify routes here
  const text = await request.text().catch(() => '')
  console.log('[rr-webhook] order-created received', text.slice(0, 100))
  return Response.json({ ok: true })
}
