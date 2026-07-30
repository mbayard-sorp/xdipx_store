/**
 * The daily profit summary: the one number the whole agent fleet steers by.
 *
 * WHY THIS WAS REWRITTEN. The original was written for the daily-deal model and
 * reported $0 revenue on real paid orders for a month. Three independent bugs:
 *
 *  1. It queried REST `/orders.json?status=paid`. `paid` is not a valid value
 *     for `status` (that field takes open/closed/any) — it is a
 *     `financial_status` — so Shopify silently applied the default and every
 *     closed or fulfilled order disappeared from the count.
 *  2. It ran at 00:05 UTC but computed "today" from the wall clock, so the
 *     window it summarized was the five minutes of the day that had just
 *     started, not the day that had just ended.
 *  3. It returned early unless a `deal_history` row existed for that date, and
 *     charged every line item the day's featured deal's wholesale cost
 *     regardless of what was actually bought.
 *
 * Order #1002 ($29.18, paid and fulfilled on 2026-07-23) was recorded as zero
 * orders and zero revenue, and every weekly retro since launch reasoned from
 * that. store-strategist names this table as its primary outcome source, so a
 * quiet wrong number here is worse than no number: it looks like an answer.
 *
 * HOW COGS IS RESOLVED. Three sources, in descending order of how much they
 * deserve to be believed, and when all three miss the units are counted in
 * `cogs_missing_units` rather than costed at zero. A zero would silently
 * inflate margin, which is the same class of lie this rewrite exists to remove.
 */

import { and, eq, gte, like, lt, sql } from 'drizzle-orm'
import { db } from './db.server'
import { dailyProfitSummary } from '../../db/schema'

/** Orders per GraphQL page. Well inside the Admin API cost budget. */
const ORDERS_PAGE = 50

/**
 * Paid orders in a date window, with everything needed to cost them.
 *
 * `financial_status:paid status:any` is the correction to bug 1: `status:any`
 * stops closed and fulfilled orders being filtered out, and the paid filter
 * moves to the field that actually carries it.
 */
const ORDERS_QUERY = `
  query ProfitOrders($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query) {
      nodes {
        id
        name
        createdAt
        totalPriceSet { shopMoney { amount } }
        metafields(first: 25, namespace: "xdipx") { nodes { key value } }
        lineItems(first: 50) {
          nodes {
            sku
            quantity
            variant { id inventoryItem { unitCost { amount } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

interface OrdersPage {
  orders: {
    nodes: Array<{
      id: string
      name: string
      createdAt: string
      totalPriceSet: { shopMoney: { amount: string } } | null
      metafields: { nodes: Array<{ key: string; value: string }> }
      lineItems: {
        nodes: Array<{
          sku: string | null
          quantity: number
          variant: { id: string; inventoryItem: { unitCost: { amount: string } | null } | null } | null
        }>
      }
    }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

/** The UTC date one day before `now`. The default reporting window. */
export function yesterdayUtc(now: number = Date.now()): string {
  return new Date(now - 86_400_000).toISOString().slice(0, 10)
}

/** The UTC date after `date`, used as the exclusive upper bound. */
export function nextUtcDate(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/**
 * The Shopify search string for one UTC day of paid orders. Half-open on
 * purpose: `>=` the day, `<` the next day, so a run for a given date always
 * covers exactly that date no matter when it executes.
 */
export function ordersSearchQuery(date: string): string {
  return `created_at:>='${date}T00:00:00Z' created_at:<'${nextUtcDate(date)}T00:00:00Z' financial_status:paid status:any`
}

/**
 * Per-SKU wholesale cost carried on the order itself.
 *
 * The order-created webhook writes one `xdipx.profit_<sku>` metafield per line
 * item at the moment of sale. That is the most trustworthy source available:
 * it is the cost as it stood when the customer paid, so a later price change
 * cannot retroactively rewrite a historical margin.
 */
export function costsFromOrderMetafields(
  metafields: ReadonlyArray<{ key: string; value: string }>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const mf of metafields) {
    if (!mf.key.startsWith('profit_')) continue
    const sku = mf.key.slice('profit_'.length)
    if (!sku) continue
    try {
      const parsed = JSON.parse(mf.value) as { wholesale_cost?: unknown }
      const cost = Number(parsed.wholesale_cost)
      if (Number.isFinite(cost) && cost > 0) out.set(sku, cost)
    } catch {
      // A malformed metafield is a miss, not a zero.
    }
  }
  return out
}

export interface LineItemForCosting {
  sku: string | null
  quantity: number
  variant: { inventoryItem: { unitCost: { amount: string } | null } | null } | null
}

export interface LineCost {
  /** Total cost for the line, or null when no source could price it. */
  cost: number | null
  source: 'order-metafield' | 'inventory-item' | 'none'
}

/**
 * Cost one line item. Pure, so the precedence is testable without Shopify.
 *
 * Note what is deliberately absent: there is no "assume zero" branch and no
 * fallback to the featured deal's cost. An unknown cost stays unknown.
 */
export function costLineItem(
  line: LineItemForCosting,
  orderCosts: Map<string, number>,
): LineCost {
  const qty = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0
  if (qty === 0) return { cost: 0, source: 'none' }

  const fromOrder = line.sku ? orderCosts.get(line.sku) : undefined
  if (fromOrder !== undefined && fromOrder > 0) {
    return { cost: fromOrder * qty, source: 'order-metafield' }
  }

  const unit = Number(line.variant?.inventoryItem?.unitCost?.amount)
  if (Number.isFinite(unit) && unit > 0) {
    return { cost: unit * qty, source: 'inventory-item' }
  }

  return { cost: null, source: 'none' }
}

export interface ProfitTotals {
  totalOrders: number
  totalRevenue: number
  totalCogs: number
  totalProfit: number
  avgOrderValue: number
  cogsMissingUnits: number
}

/**
 * Fold a page of orders into running totals. Pure and exported so the whole
 * aggregation can be tested against fixture orders.
 */
export function accumulateOrders(
  orders: OrdersPage['orders']['nodes'],
  into: ProfitTotals,
): ProfitTotals {
  const t = { ...into }
  for (const order of orders) {
    t.totalOrders += 1
    const revenue = Number(order.totalPriceSet?.shopMoney?.amount ?? '0')
    if (Number.isFinite(revenue)) t.totalRevenue += revenue

    const orderCosts = costsFromOrderMetafields(order.metafields?.nodes ?? [])
    for (const line of order.lineItems?.nodes ?? []) {
      const { cost } = costLineItem(line, orderCosts)
      if (cost === null) {
        t.cogsMissingUnits += Math.max(0, line.quantity)
      } else {
        t.totalCogs += cost
      }
    }
  }
  t.totalProfit = t.totalRevenue - t.totalCogs
  t.avgOrderValue = t.totalOrders > 0 ? t.totalRevenue / t.totalOrders : 0
  return t
}

const EMPTY_TOTALS: ProfitTotals = {
  totalOrders: 0,
  totalRevenue: 0,
  totalCogs: 0,
  totalProfit: 0,
  avgOrderValue: 0,
  cogsMissingUnits: 0,
}

/** Fetch and total every paid order for one UTC date. */
export async function computeProfitForDate(date: string): Promise<ProfitTotals> {
  const { adminGraphQL } = await import('./shopify.server')
  const search = ordersSearchQuery(date)

  let totals: ProfitTotals = { ...EMPTY_TOTALS }
  let cursor: string | null = null

  do {
    const page: OrdersPage = await adminGraphQL<OrdersPage>(ORDERS_QUERY, {
      query: search,
      first: ORDERS_PAGE,
      after: cursor,
    })
    totals = accumulateOrders(page.orders.nodes ?? [], totals)
    cursor = page.orders.pageInfo?.hasNextPage ? (page.orders.pageInfo.endCursor ?? null) : null
  } while (cursor !== null)

  return totals
}

/**
 * Write (or correct) one day's summary row.
 *
 * Defaults to yesterday UTC so the 00:05 UTC cron summarizes the day that just
 * ended. `ad_spend` is deliberately absent from the conflict-update: it is
 * written by the ads flow and must survive a summary recompute.
 */
export async function writeProfitSummary(targetDate?: string): Promise<ProfitTotals> {
  const date = targetDate ?? yesterdayUtc()
  const totals = await computeProfitForDate(date)

  await db
    .insert(dailyProfitSummary)
    .values({
      summaryDate: date,
      totalOrders: totals.totalOrders,
      totalRevenue: totals.totalRevenue.toFixed(2),
      totalCogs: totals.totalCogs.toFixed(2),
      totalProfit: totals.totalProfit.toFixed(2),
      avgOrderValue: totals.avgOrderValue.toFixed(2),
      cogsMissingUnits: totals.cogsMissingUnits,
    })
    .onConflictDoUpdate({
      target: dailyProfitSummary.summaryDate,
      set: {
        totalOrders: sql`excluded.total_orders`,
        totalRevenue: sql`excluded.total_revenue`,
        totalCogs: sql`excluded.total_cogs`,
        totalProfit: sql`excluded.total_profit`,
        avgOrderValue: sql`excluded.avg_order_value`,
        cogsMissingUnits: sql`excluded.cogs_missing_units`,
      },
    })

  return totals
}

export interface ProfitReconciliation {
  date: string
  /** Paid orders Shopify reports for the day. */
  shopifyPaidOrders: number
  /** Orders the summary row claims, or null when there is no row. */
  summaryOrders: number | null
  summaryExists: boolean
  match: boolean
  cogsMissingUnits: number
}

/**
 * Compare Shopify's own paid-order count against what the summary recorded.
 *
 * This exists because the failure mode being fixed here was invisible: the
 * table said zero, nothing said otherwise, and no agent or cron ever asked
 * Shopify whether that was true. The owner digest surfaces this daily so the
 * next such divergence is caught the following morning.
 */
export async function getProfitReconciliation(date?: string): Promise<ProfitReconciliation> {
  const day = date ?? yesterdayUtc()
  const { adminGraphQL } = await import('./shopify.server')

  const counted = await adminGraphQL<{ ordersCount: { count: number } | null }>(
    `query ProfitReconcile($query: String!) { ordersCount(query: $query, limit: 10000) { count } }`,
    { query: ordersSearchQuery(day) },
  )

  const [row] = await db
    .select({
      totalOrders: dailyProfitSummary.totalOrders,
      cogsMissingUnits: dailyProfitSummary.cogsMissingUnits,
    })
    .from(dailyProfitSummary)
    .where(eq(dailyProfitSummary.summaryDate, day))
    .limit(1)

  const shopifyPaidOrders = counted.ordersCount?.count ?? 0
  const summaryOrders = row ? (row.totalOrders ?? 0) : null

  return {
    date: day,
    shopifyPaidOrders,
    summaryOrders,
    summaryExists: !!row,
    match: !!row && summaryOrders === shopifyPaidOrders,
    cogsMissingUnits: row?.cogsMissingUnits ?? 0,
  }
}

/**
 * Delete the dev seed rows.
 *
 * db/seed.ts writes six rows dated 2026-03-26..31 with `featured_sku`
 * `SEED-001..006`, together 311 orders and $13,236.89 — which was, until this
 * change, one hundred percent of the lifetime totals on the admin dashboard.
 * Three weekly strategy briefs, a win-back campaign proposal, a referral
 * program proposal, and an anniversary-email proposal were all built on the
 * belief that this represented a real March launch with a real buyer cohort.
 * It never happened. The rows have to go, or every future retro benchmarks
 * real weeks against fiction.
 */
export async function deleteSeedProfitRows(): Promise<number> {
  const deleted = await db
    .delete(dailyProfitSummary)
    .where(like(dailyProfitSummary.featuredSku, 'SEED-%'))
    .returning({ date: dailyProfitSummary.summaryDate })
  return deleted.length
}

export async function getDashboardStats(days = 30) {
  const rows = await db
    .select()
    .from(dailyProfitSummary)
    .orderBy(sql`${dailyProfitSummary.summaryDate} DESC`)
    .limit(days)

  const total = rows.reduce((acc, r) => ({
    revenue: acc.revenue + parseFloat(r.totalRevenue ?? '0'),
    profit:  acc.profit  + parseFloat(r.totalProfit ?? '0'),
    orders:  acc.orders  + (r.totalOrders ?? 0),
  }), { revenue: 0, profit: 0, orders: 0 })

  return { rows, total }
}

/** Summary rows in a date range, oldest first. Used by the backfill reporter. */
export async function getProfitRows(fromDate: string, toDate: string) {
  return db
    .select()
    .from(dailyProfitSummary)
    .where(and(
      gte(dailyProfitSummary.summaryDate, fromDate),
      lt(dailyProfitSummary.summaryDate, nextUtcDate(toDate)),
    ))
    .orderBy(dailyProfitSummary.summaryDate)
}
