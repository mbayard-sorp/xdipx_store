/**
 * Classifies and totals orders that came from an AI assistant (ticket
 * #12685, owner all-hands 2026-09-30). Order #1008 (Dame Eva II,
 * 2026-09-30) carries `_utm_source=chatgpt.com` on its cart attributes — a
 * ChatGPT answer cited an xdipx.com page and the customer bought on-site —
 * and nothing stored or reported that until now.
 *
 * Deliberately separate from `order_attribution` (ticket #12669, which
 * persists one row per order at orders/create time for the owner digest's
 * trailing-30-day line): this module answers an ad-hoc "last N days" query
 * live against Shopify, for any team that wants a number right now without
 * waiting on the persisted table to backfill.
 */
import { adminGraphQL } from './shopify.server'

/** Per-page order count. Well inside the Admin API cost budget. */
const ORDERS_PAGE = 50

const ORDERS_QUERY = `
  query AiSourceOrders($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      nodes {
        name
        totalPriceSet { shopMoney { amount } }
        customAttributes { key value }
        customerJourneySummary {
          firstVisit { referrerUrl source }
          lastVisit { referrerUrl source }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export interface AiSourceOrderNode {
  name: string
  totalPriceSet: { shopMoney: { amount: string } } | null
  customAttributes: { key: string; value: string }[]
  customerJourneySummary: {
    firstVisit: { referrerUrl: string | null; source: string } | null
    lastVisit: { referrerUrl: string | null; source: string } | null
  } | null
}

interface OrdersPage {
  orders: {
    nodes: AiSourceOrderNode[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

/** Known AI-assistant hosts, mapped to the label the response reports. */
const AI_SOURCES: readonly { host: string; source: string }[] = [
  { host: 'chatgpt.com', source: 'chatgpt' },
  { host: 'openai.com', source: 'openai' },
  { host: 'perplexity.ai', source: 'perplexity' },
  { host: 'copilot.microsoft.com', source: 'copilot' },
  { host: 'bing.com', source: 'bing' },
  { host: 'gemini.google.com', source: 'gemini' },
  { host: 'claude.ai', source: 'claude' },
]

function matchHost(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.toLowerCase()
  for (const { host, source } of AI_SOURCES) {
    if (v.includes(host)) return source
  }
  return null
}

/**
 * Classifies one order's AI-assistant source, or null when it did not come
 * from one. Checked in order: the `_utm_source` cart attribute (the
 * reliable signal — order #1008's shape), then the customer journey's last
 * and first visit referrer/source fields, which Shopify fills in only when
 * it could attribute the session.
 *
 * Pure and exported so the classification is unit-tested without a live
 * Shopify call.
 */
export function classifyAiOrderSource(order: Pick<AiSourceOrderNode, 'customAttributes' | 'customerJourneySummary'>): string | null {
  const utmSource = order.customAttributes.find(a => a.key === '_utm_source')?.value ?? null
  const fromUtm = matchHost(utmSource)
  if (fromUtm) return fromUtm

  const journey = order.customerJourneySummary
  const candidates = [
    journey?.lastVisit?.referrerUrl,
    journey?.lastVisit?.source,
    journey?.firstVisit?.referrerUrl,
    journey?.firstVisit?.source,
  ]
  for (const candidate of candidates) {
    const matched = matchHost(candidate)
    if (matched) return matched
  }
  return null
}

export interface AiSourceOrdersResult {
  windowDays: number
  totals: { orders: number; revenue: number }
  bySource: { source: string; orders: number; revenue: number; orderNames: string[] }[]
}

/**
 * Totals every order in the trailing `windowDays` by AI-assistant source.
 * Orders with no AI-assistant source are counted in `totals` but omitted
 * from `bySource` — this endpoint reports attribution, not an order list.
 */
export async function getAiSourceOrders(windowDays: number): Promise<AiSourceOrdersResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const search = `created_at:>='${since}' financial_status:paid status:any`

  const bySource = new Map<string, { orders: number; revenue: number; orderNames: string[] }>()
  let totalOrders = 0
  let totalRevenue = 0
  let cursor: string | null = null

  do {
    const page: OrdersPage = await adminGraphQL<OrdersPage>(ORDERS_QUERY, {
      query: search,
      first: ORDERS_PAGE,
      after: cursor,
    })
    for (const order of page.orders.nodes ?? []) {
      const revenue = Number(order.totalPriceSet?.shopMoney.amount ?? 0)
      totalOrders += 1
      totalRevenue += revenue

      const source = classifyAiOrderSource(order)
      if (!source) continue
      const bucket = bySource.get(source) ?? { orders: 0, revenue: 0, orderNames: [] }
      bucket.orders += 1
      bucket.revenue += revenue
      bucket.orderNames.push(order.name)
      bySource.set(source, bucket)
    }
    cursor = page.orders.pageInfo?.hasNextPage ? (page.orders.pageInfo.endCursor ?? null) : null
  } while (cursor !== null)

  return {
    windowDays,
    totals: { orders: totalOrders, revenue: totalRevenue },
    bySource: Array.from(bySource.entries()).map(([source, v]) => ({ source, ...v })),
  }
}
