/**
 * Ticket #13155: the Shopify-facing half of the paid-unfulfilled watchdog.
 * Pulls a bounded window of paid/unfulfilled orders, hands them to the pure
 * filter in paid-unfulfilled-watchdog.ts, and files one P1 owner blocker per
 * stuck order (order name only, never customer PII).
 */

import { type OrderCandidate, findStuckPaidOrders } from '~/lib/paid-unfulfilled-watchdog'

/** Wide enough that a 48h (weekend) threshold case is never missed, narrow enough to stay one page. */
const SCAN_WINDOW_DAYS = 5

interface OrderNode {
  id: string
  name: string
  createdAt: string
  cancelledAt: string | null
  test: boolean
  displayFinancialStatus: string
  displayFulfillmentStatus: string
}

/**
 * Paid, unfulfilled, non-cancelled-by-Shopify's-own-search orders from the
 * last SCAN_WINDOW_DAYS. The cancelled/test/age filtering still happens in
 * the pure module below — this query is a coarse pre-filter only, so a
 * Shopify search-syntax quirk can never silently narrow what the pure
 * filter gets to see.
 */
async function fetchCandidates(now: Date): Promise<OrderCandidate[]> {
  const { adminGraphQL } = await import('~/lib/shopify.server')
  const sinceIso = new Date(now.getTime() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const query = `financial_status:paid fulfillment_status:unfulfilled status:any created_at:>='${sinceIso}'`
  const res = await adminGraphQL<{ orders?: { nodes?: OrderNode[] } }>(
    `query PaidUnfulfilledOrders($query: String!) {
      orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          test
          displayFinancialStatus
          displayFulfillmentStatus
        }
      }
    }`,
    { query },
  )
  return (res.orders?.nodes ?? []).map(n => ({
    name: n.name,
    id: n.id,
    createdAt: n.createdAt,
    cancelledAt: n.cancelledAt,
    test: n.test,
    displayFinancialStatus: n.displayFinancialStatus,
    displayFulfillmentStatus: n.displayFulfillmentStatus,
  }))
}

export interface PaidUnfulfilledSweepResult {
  scanned: number
  stuck: OrderCandidate[]
  filed: string[]
}

/**
 * Run the sweep: fetch candidates, filter to genuinely stuck ones, file a
 * blocker per order. Never throws — a caller on a shared cron handler (see
 * /cron/janitor-sweep) must not have this check take down the rest of the
 * sweep, exactly like the credential-health check it sits beside.
 */
export async function checkPaidUnfulfilledOrders(now: Date = new Date()): Promise<PaidUnfulfilledSweepResult> {
  const candidates = await fetchCandidates(now)
  const stuck = findStuckPaidOrders(candidates, now)

  const { fileBlocker } = await import('~/lib/owner-blockers.server')
  const filed: string[] = []
  for (const order of stuck) {
    try {
      await fileBlocker({
        dedupeKey: `paid-unfulfilled-${order.name}`,
        title: `Order ${order.name} is paid and unfulfilled`,
        detail:
          `Created ${order.createdAt} and still ${order.displayFulfillmentStatus.toLowerCase()} past the `
          + 'age floor (36h, or 48h when the wait spanned a weekend). Fulfillment on this storefront is '
          + 'otherwise fully automatic via the Nalpac Integration app, so this order sitting unfulfilled '
          + 'means that app lost auth, was uninstalled, or Nalpac rejected the order.\n\n'
          + 'Detected by the paid-unfulfilled watchdog on /cron/janitor-sweep. Order name only; no '
          + 'customer PII in this row.',
        unblocks: 'This one customer actually receiving what they paid for, and whatever else is piling '
          + 'up silently behind the same broken fulfillment path.',
        whereToGo: `Shopify admin > Orders > ${order.name} to see why it has not fulfilled, and the `
          + 'Nalpac Integration app\'s install/auth status if more than one order shows up here at once.',
        category: 'other',
        priority: 1,
        source: 'sweep',
        sourceRef: 'cron:janitor-sweep',
        verifyProbe: 'order_fulfilled',
        verifyArg: `${order.name}|${order.id}`,
      })
      filed.push(order.name)
    } catch (err) {
      // Same rule as every other sweep-filed blocker: bookkeeping must never
      // turn a working sweep into a failed one.
      console.error(`[paid-unfulfilled-watchdog] could not file blocker for ${order.name} (ignored):`, err)
    }
  }
  return { scanned: candidates.length, stuck, filed }
}
