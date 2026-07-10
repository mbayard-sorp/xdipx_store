/**
 * Shopify products/update webhook. React Router FALLBACK STUB. Not the real
 * handler and it performs no HMAC verification and no cache purge.
 *
 * The real handler is the Express route /webhooks/product-updated
 * (server/webhooks.ts), which needs the raw body for HMAC. This stub only
 * prevents 404 retries if a Shopify subscription is ever misconfigured to
 * point at /api/webhooks/product-updated, but any hit here means the
 * markdown twin cache purge was NOT run, so it logs at error level for the
 * log-monitor cron to escalate. If the Shopify webhook subscriptions are
 * confirmed to never target /api/webhooks/*, this file can be deleted.
 */
import type { ActionFunctionArgs } from 'react-router'

export async function action({ request }: ActionFunctionArgs) {
  const text = await request.text().catch(() => '')
  console.error(
    '[rr-webhook] products/update hit the fallback stub, a Shopify webhook subscription is misconfigured; the markdown cache purge was NOT run. Repoint it to /webhooks/product-updated.',
    text.slice(0, 100),
  )
  return Response.json({ ok: true })
}
