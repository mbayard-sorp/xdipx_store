/**
 * app/lib/sms-v2/tools/order-status.server.ts
 *
 * Phase 6b — orderStatusLookup tool.
 *
 * Looks up the most recent Shopify order for a customer (by phone or GID),
 * optionally filtering by order name (e.g. "#1234").
 *
 * Exported:
 *   - OrderStatus  — the flat return shape
 *   - OrderNotFoundError  — typed error thrown when no order exists
 *   - orderStatusLookup({ phone?, customerGid?, orderName? })
 */

import { adminGraphQL, findCustomerByPhone, shopifyAdmin } from '~/lib/shopify.server'

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface OrderStatus {
  /** e.g. '#1042' */
  orderName: string
  status: 'pending' | 'paid' | 'fulfilled' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  trackingNumber?: string
  trackingUrl?: string
  carrier?: string
  /** Human-readable: 'Phoenix AZ Apr 12 6:23am' */
  lastScan?: string
  refundEligible: boolean
  cancelEligible: boolean
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class OrderNotFoundError extends Error {
  constructor(message = 'No order found') {
    super(message)
    this.name = 'OrderNotFoundError'
  }
}

// ─── Shopify Admin GQL types ──────────────────────────────────────────────────

interface ShopifyOrder {
  id: string
  name: string
  displayFinancialStatus: string
  displayFulfillmentStatus: string
  processedAt: string
  cancelledAt: string | null
  refunds: { id: string }[]
  fulfillments: Array<{
    status: string
    trackingInfo: Array<{
      number: string | null
      url: string | null
      company: string | null
    }>
    createdAt: string
    updatedAt: string
  }>
}

interface OrderByNameResponse {
  orders: {
    nodes: ShopifyOrder[]
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Format an ISO date string to a human-readable scan label like
 * 'Phoenix AZ Apr 12 6:23am'. We don't have city/state from Shopify's basic
 * fulfillment events, so we format just the date/time and let callers
 * prepend location from tracking URLs when available.
 */
function formatLastScan(isoString: string): string {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return isoString
  const mon = MONTH_ABBR[d.getMonth()] ?? ''
  const day = d.getDate()
  let hours = d.getHours()
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12 || 12
  return `${mon} ${day} ${hours}:${minutes}${ampm}`
}

/**
 * Map Shopify's `displayFinancialStatus` + `displayFulfillmentStatus` + refund/cancel
 * state to our flat status enum.
 *
 * Priority order (most specific first):
 *   1. Cancelled (cancelledAt set)
 *   2. Refunded (has refunds + financial status REFUNDED)
 *   3. Delivered (fulfillment status SUCCESS)
 *   4. Shipped / Fulfilled: look at active fulfillment tracking
 *   5. Paid / Pending
 */
function mapStatus(order: ShopifyOrder): OrderStatus['status'] {
  if (order.cancelledAt) return 'cancelled'

  const financial = order.displayFinancialStatus?.toUpperCase() ?? ''
  const fulfillment = order.displayFulfillmentStatus?.toUpperCase() ?? ''

  if (financial === 'REFUNDED' && order.refunds.length > 0) return 'refunded'

  if (fulfillment === 'DELIVERED') return 'delivered'
  if (fulfillment === 'FULFILLED') {
    // Check if any fulfillment has tracking — if so, label it 'shipped'
    const hasTracking = order.fulfillments.some(
      (f) => f.trackingInfo.some((t) => t.number),
    )
    return hasTracking ? 'shipped' : 'fulfilled'
  }
  if (fulfillment === 'PARTIALLY_FULFILLED' || fulfillment === 'IN_TRANSIT') return 'shipped'

  if (financial === 'PAID') return 'paid'
  return 'pending'
}

/**
 * Whether the order is eligible for a refund: not already refunded/cancelled
 * and within 30 days of processedAt.
 */
function computeRefundEligible(order: ShopifyOrder): boolean {
  const financial = order.displayFinancialStatus?.toUpperCase() ?? ''
  if (order.cancelledAt) return false
  if (financial === 'REFUNDED') return false
  const processed = new Date(order.processedAt)
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return Date.now() - processed.getTime() <= thirtyDaysMs
}

/**
 * Whether the order can still be cancelled: not yet fulfilled and not cancelled.
 */
function computeCancelEligible(order: ShopifyOrder): boolean {
  if (order.cancelledAt) return false
  const fulfillment = order.displayFulfillmentStatus?.toUpperCase() ?? ''
  return fulfillment === 'UNFULFILLED' || fulfillment === ''
}

/**
 * Extract the primary tracking info from the most recent fulfillment.
 */
function extractTracking(order: ShopifyOrder): {
  trackingNumber?: string
  trackingUrl?: string
  carrier?: string
  lastScan?: string
} {
  // Sort fulfillments by updatedAt desc and take the most recent one
  const sorted = [...order.fulfillments].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
  const latest = sorted[0]
  if (!latest) return {}

  const info = latest.trackingInfo[0]
  if (!info) return {}

  return {
    ...(info.number   != null ? { trackingNumber: info.number }              : {}),
    ...(info.url      != null ? { trackingUrl:    info.url }                 : {}),
    ...(info.company  != null ? { carrier:        info.company }             : {}),
    lastScan: formatLastScan(latest.updatedAt),
  }
}

const ORDER_FIELDS = `
  id
  name
  displayFinancialStatus
  displayFulfillmentStatus
  processedAt
  cancelledAt
  refunds(first: 1) { id }
  fulfillments(first: 5) {
    status
    updatedAt
    createdAt
    trackingInfo {
      number
      url
      company
    }
  }
`

// ─── Test seam ────────────────────────────────────────────────────────────────

/**
 * Module-level reference to the real implementation. Exposed as a mutable
 * export so smoke tests can swap it with a mock (same pattern as discovery.server.ts).
 */
export let _orderStatusLookupImpl: (args: {
  phone?: string
  customerGid?: string
  orderName?: string
}) => Promise<OrderStatus> = orderStatusLookupImpl

/** Replace the implementation (test seam only). Returns the previous impl. */
export function _setOrderStatusLookup(
  fn: typeof _orderStatusLookupImpl,
): typeof _orderStatusLookupImpl {
  const prev = _orderStatusLookupImpl
  _orderStatusLookupImpl = fn
  return prev
}

// ─── Public wrapper ──────────────────────────────────────────────────────────

/** Call via module reference so tests can swap the impl. */
export function orderStatusLookup(args: {
  phone?: string
  customerGid?: string
  orderName?: string
}): Promise<OrderStatus> {
  return _orderStatusLookupImpl(args)
}

// ─── Real implementation ──────────────────────────────────────────────────────

async function orderStatusLookupImpl({
  phone,
  customerGid,
  orderName,
}: {
  phone?: string
  customerGid?: string
  orderName?: string
}): Promise<OrderStatus> {
  let resolvedGid = customerGid

  // Step 1: resolve customer GID from phone if GID not provided
  if (!resolvedGid && phone) {
    const customer = await findCustomerByPhone(phone)
    if (!customer) {
      throw new OrderNotFoundError(`No customer found for phone ${phone}`)
    }
    resolvedGid = customer.id
  }

  if (!resolvedGid && !orderName) {
    throw new OrderNotFoundError('Must provide phone, customerGid, or orderName')
  }

  let order: ShopifyOrder | undefined

  // Step 2a: look up by customer GID (latest order, or filtered by orderName)
  if (resolvedGid) {
    const numericId = resolvedGid.replace('gid://shopify/Customer/', '')
    // Use REST for simple latest-order lookup — it's leaner than GQL pagination
    const restPath = `/customers/${numericId}/orders.json?limit=10&status=any&order=created_at+desc`
    type RestOrdersResponse = {
      orders: Array<{
        id: number
        name: string
        financial_status: string
        fulfillment_status: string | null
        processed_at: string
        cancelled_at: string | null
        refunds: { id: number }[]
        fulfillments: Array<{
          status: string
          created_at: string
          updated_at: string
          tracking_number: string | null
          tracking_url: string | null
          tracking_company: string | null
        }>
      }>
    }

    const restData = await shopifyAdmin<RestOrdersResponse>(restPath)
    const candidates = restData.orders

    // Filter by orderName if provided (e.g. "#1234")
    const raw = orderName
      ? candidates.find((o) => o.name.toLowerCase() === orderName.toLowerCase())
      : candidates[0]

    if (!raw) {
      throw new OrderNotFoundError(
        orderName
          ? `Order ${orderName} not found for this customer`
          : 'No orders found for this customer',
      )
    }

    // Normalize REST response into our GQL shape
    order = {
      id:                       `gid://shopify/Order/${raw.id}`,
      name:                     raw.name,
      displayFinancialStatus:   raw.financial_status.toUpperCase(),
      displayFulfillmentStatus: (raw.fulfillment_status ?? 'UNFULFILLED').toUpperCase(),
      processedAt:              raw.processed_at,
      cancelledAt:              raw.cancelled_at,
      refunds:                  raw.refunds.map((r) => ({ id: String(r.id) })),
      fulfillments:             raw.fulfillments.map((f) => ({
        status:      f.status,
        createdAt:   f.created_at,
        updatedAt:   f.updated_at,
        trackingInfo: [
          {
            number:  f.tracking_number,
            url:     f.tracking_url,
            company: f.tracking_company,
          },
        ],
      })),
    }
  } else if (orderName) {
    // Step 2b: look up directly by order name via Admin GQL (no customer context)
    const data = await adminGraphQL<OrderByNameResponse>(`
      query OrderByName($q: String!) {
        orders(first: 1, query: $q) {
          nodes {
            ${ORDER_FIELDS}
          }
        }
      }
    `, { q: `name:${orderName}` })

    order = data.orders.nodes[0]
    if (!order) {
      throw new OrderNotFoundError(`Order ${orderName} not found`)
    }
  }

  if (!order) {
    throw new OrderNotFoundError('Could not resolve order')
  }

  // Step 3: map to our flat return shape
  const status  = mapStatus(order)
  const tracking = extractTracking(order)

  return {
    orderName:      order.name,
    status,
    refundEligible: computeRefundEligible(order),
    cancelEligible: computeCancelEligible(order),
    ...tracking,
  }
}
