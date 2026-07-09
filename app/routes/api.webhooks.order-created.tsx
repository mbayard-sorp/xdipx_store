/**
 * Shopify orders/create webhook — React Router FALLBACK STUB. Not the real
 * handler and it performs no HMAC verification and no order processing.
 *
 * The real handler is the Express route /webhooks/order-created
 * (server/webhooks.ts), which needs the raw body for HMAC. This stub only
 * prevents 404 retries if a Shopify subscription is ever misconfigured to
 * point at /api/webhooks/order-created — but any hit here means an order
 * event was swallowed (no profit metafields, no CAPI, no referral capture),
 * so it logs at error level for the log-monitor cron to escalate. If the
 * Shopify webhook subscriptions are confirmed to never target
 * /api/webhooks/*, this file can be deleted.
 */
import type { ActionFunctionArgs } from 'react-router'

export async function action({ request }: ActionFunctionArgs) {
  const text = await request.text().catch(() => '')
  console.error(
    '[rr-webhook] orders/create hit the fallback stub — a Shopify webhook subscription is misconfigured; the event was NOT processed. Repoint it to /webhooks/order-created.',
    text.slice(0, 100),
  )
  return Response.json({ ok: true })
}
