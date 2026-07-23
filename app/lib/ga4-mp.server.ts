/**
 * GA4 Measurement Protocol: server-side purchase event.
 *
 * The client funnel ends at begin_checkout (analytics.client.ts); checkout
 * completes on Shopify's domain, so the conversion must be sent server-side from
 * the order webhook. Meta CAPI already gets a Purchase; without this, GA4 (the
 * stack's analytics of record for strategy/ads) never records revenue and every
 * team optimizes blind. GA4 dedupes ecommerce on transaction_id, so a retried
 * webhook is idempotent as long as transaction_id stays the order id.
 *
 * Server-only. Requires GA4_MEASUREMENT_ID (or the DB fallback) and
 * GA4_API_SECRET; degrades to a no-op (never throws) when either is missing.
 */
import { resolveGa4 } from '~/lib/ga4-config.server'

export interface Ga4PurchaseEvent {
  transactionId: string
  value:         number
  currency:      string
  items:         { item_id: string; item_name?: string; price?: number; quantity?: number }[]
  clientId?:     string | null
}

export async function sendGa4Purchase(e: Ga4PurchaseEvent): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const { id: measurementId } = await resolveGa4()
  const apiSecret = (process.env['GA4_API_SECRET'] ?? '').trim()
  if (!measurementId) return { ok: false, skipped: 'no GA4 measurement id' }
  if (!apiSecret)     return { ok: false, skipped: 'no GA4_API_SECRET' }

  // GA4 MP requires a client_id. When the shopper's _ga cookie was not captured,
  // fall back to a stable per-order id so the purchase is still counted (the
  // session attribution is lost, the revenue is not).
  const clientId = e.clientId && e.clientId.length > 0 ? e.clientId : `srv.${e.transactionId}`

  const body = {
    client_id: clientId,
    // Non-personalized server event; no user-id, no ad-consent implied.
    events: [{
      name: 'purchase',
      params: {
        transaction_id: e.transactionId,
        value:          e.value,
        currency:       e.currency,
        items:          e.items,
      },
    }],
  }

  try {
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    )
    // MP returns 204 on success and never a body; any 2xx is success.
    if (res.status >= 200 && res.status < 300) return { ok: true }
    return { ok: false, error: `GA4 MP HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
