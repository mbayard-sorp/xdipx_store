/**
 * Ticket #13155 (owner-away all-hands 2026-10-02): nothing watches for a paid
 * order that never ships. Fulfillment is fully automatic via the Nalpac
 * Integration app, so if it loses auth, is uninstalled, or Nalpac rejects an
 * order, the order sits paid and unfulfilled until a customer emails
 * hello@ — which is not monitored.
 *
 * This is the pure half: given a page of order facts already pulled from
 * Shopify, decide which ones count as stuck. Kept separate from the Shopify
 * fetch (in paid-unfulfilled-watchdog.server.ts) so the age threshold, the
 * weekend allowance, and the cancelled/test exclusions are unit-testable
 * without a live Admin API token.
 */

export interface OrderCandidate {
  /** Shopify's display name, e.g. "#1008". Used in the blocker title and dedupe key. */
  name: string
  /** GID, e.g. "gid://shopify/Order/123456789". Used by the order_fulfilled probe for an exact re-read. */
  id: string
  createdAt: string
  cancelledAt: string | null
  test: boolean
  displayFinancialStatus: string
  displayFulfillmentStatus: string
}

/** Paid-but-unfulfilled is normal for the first few hours; this is the floor. */
export const STUCK_THRESHOLD_HOURS = 36

/** The same floor, widened when the wait included a weekend (fulfillment runs slower then). */
export const STUCK_THRESHOLD_HOURS_WEEKEND = 48

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Does any UTC calendar day between `from` and `to` fall on a Saturday or
 * Sunday? Walked day by day rather than computed, so a window that starts
 * Friday evening and ends Monday morning correctly counts as spanning a
 * weekend even though it is under 48 hours of wall-clock time. Capped at 10
 * iterations — the threshold itself tops out at 48 hours, so a real call
 * never approaches that, but a test driving an unusually old `now` should
 * still terminate rather than loop.
 */
function spansWeekend(from: Date, to: Date): boolean {
  let t = from.getTime()
  const end = to.getTime()
  for (let i = 0; i < 10 && t <= end; i++, t += DAY_MS) {
    const day = new Date(t).getUTCDay()
    if (day === 0 || day === 6) return true
  }
  return false
}

/** The age floor that applies to this one order's window, honest about the weekend widening it. */
export function stuckThresholdHours(createdAt: Date, now: Date): number {
  return spansWeekend(createdAt, now) ? STUCK_THRESHOLD_HOURS_WEEKEND : STUCK_THRESHOLD_HOURS
}

/**
 * Is this order a genuine "paid and never shipped" case? Excludes cancelled
 * and test orders outright — both are the merchant or Shopify saying this
 * order was never meant to fulfill — before even looking at age.
 */
export function isStuckPaidOrder(order: OrderCandidate, now: Date): boolean {
  if (order.test) return false
  if (order.cancelledAt) return false
  if (order.displayFinancialStatus !== 'PAID') return false
  if (order.displayFulfillmentStatus !== 'UNFULFILLED') return false

  const createdAt = new Date(order.createdAt)
  const ageHours = (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000)
  return ageHours >= stuckThresholdHours(createdAt, now)
}

export function findStuckPaidOrders(orders: readonly OrderCandidate[], now: Date): OrderCandidate[] {
  return orders.filter(o => isStuckPaidOrder(o, now))
}
