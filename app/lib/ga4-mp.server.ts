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
  // GA4 session id from the `_ga_<suffix>` cookie (ticket #12670). Without
  // it, Measurement Protocol events are not joined to a session and land in
  // the "Unassigned" channel, which hid every purchase from GA4 acquisition
  // reports. null/absent is a valid, if degraded, send.
  sessionId?:    string | null
}

/**
 * Builds the GA4 Measurement Protocol request body for a purchase event.
 * Pure and exported so the session_id/engagement_time_msec wiring (ticket
 * #12670) is unit-tested without a network call or a GA4 config lookup.
 */
export function buildGa4PurchaseBody(e: Ga4PurchaseEvent, clientId: string): {
  client_id: string
  events: { name: 'purchase'; params: Record<string, unknown> }[]
} {
  return {
    client_id: clientId,
    // Non-personalized server event; no user-id, no ad-consent implied.
    events: [{
      name: 'purchase',
      params: {
        transaction_id: e.transactionId,
        value:          e.value,
        currency:       e.currency,
        items:          e.items,
        // session_id joins this event to the browsing session that produced
        // it, which is what lets GA4 attribute the purchase to a real
        // channel instead of "Unassigned". engagement_time_msec is required
        // alongside it for GA4 to treat the session as engaged; 1 is the
        // documented minimum for a server-sent event with no real duration
        // to report.
        ...(e.sessionId ? { session_id: e.sessionId, engagement_time_msec: 1 } : {}),
      },
    }],
  }
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
  const body = buildGa4PurchaseBody(e, clientId)

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
