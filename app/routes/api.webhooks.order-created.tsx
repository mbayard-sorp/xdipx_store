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

/**
 * Throttle window for the owner alert. A misconfigured subscription fires on
 * every order, and one alert per incident is the useful signal; a mailbox full
 * of them is not. Per-instance state, which is fine: the worst case is one
 * extra email per warm serverless instance.
 */
const ALERT_THROTTLE_MS = 60 * 60 * 1000
let lastAlertAt = 0

export async function action({ request }: ActionFunctionArgs) {
  const text = await request.text().catch(() => '')
  console.error(
    '[rr-webhook] orders/create hit the fallback stub — a Shopify webhook subscription is misconfigured; the event was NOT processed. Repoint it to /webhooks/order-created.',
    text.slice(0, 100),
  )

  // This used to be a log line only, and log lines are how the Purchase outage
  // went unnoticed from 2026-05 to 2026-07. The Purchase itself is now
  // recoverable (the reconcile sweep reads Shopify directly), but profit
  // metafields and referral capture are lost for good on this path, so the
  // owner needs to know the same day.
  const now = Date.now()
  if (now - lastAlertAt > ALERT_THROTTLE_MS) {
    lastAlertAt = now
    try {
      const { sendOwnerEmail } = await import('~/lib/owner-alerts.server')
      await sendOwnerEmail(
        'xdipx: Shopify order webhook is misconfigured',
        'An orders/create webhook hit the fallback stub at /api/webhooks/order-created, which does not process orders.\n\n' +
        'Repoint the subscription to https://xdipx.com/webhooks/order-created in Shopify Admin under Settings > Notifications > Webhooks.\n\n' +
        'Meta CAPI Purchase events are still recovered by the reconcile sweep, but profit metafields, co-purchase data and referral capture are lost for any order that lands here.',
      )
    } catch (err) {
      console.error('[rr-webhook] owner alert failed', err)
    }
  }

  return Response.json({ ok: true })
}
