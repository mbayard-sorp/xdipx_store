/**
 * Shopify returns/update webhook — React Router fallback.
 * Primary handler lives in server/webhooks.ts (Express route) for proper
 * raw-body HMAC verification. This stub exists to prevent 404s if Shopify
 * routes here instead of /webhooks/returns-update.
 */
import type { ActionFunctionArgs } from 'react-router'

export async function action({ request }: ActionFunctionArgs) {
  const text = await request.text().catch(() => '')
  console.log('[rr-webhook] returns-update received', text.slice(0, 100))
  return Response.json({ ok: true })
}
