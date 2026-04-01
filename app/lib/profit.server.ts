import { db } from './db.server'
import { dailyProfitSummary, dealHistory } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'

export async function writeProfitSummary(): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!

  // Aggregate today's deal data from deal_history
  const [todayDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.dealDate, today))
    .limit(1)

  if (!todayDeal) return

  // Pull order totals from Shopify Admin API
  const { shopifyAdmin } = await import('./shopify.server')
  const ordersData = await shopifyAdmin<{
    orders: { total_price: string; line_items: { sku: string; quantity: number; price: string }[] }[]
  }>(`/orders.json?status=paid&created_at_min=${today}T00:00:00-00:00`)

  let totalOrders  = 0
  let totalRevenue = 0
  let totalCogs    = 0

  for (const order of ordersData.orders) {
    totalOrders++
    totalRevenue += parseFloat(order.total_price)
    for (const item of order.line_items) {
      const cost = parseFloat(todayDeal.wholesaleCost ?? '0')
      totalCogs += cost * item.quantity
    }
  }

  const totalProfit  = totalRevenue - totalCogs
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

  await db
    .insert(dailyProfitSummary)
    .values({
      summaryDate:    today,
      totalOrders,
      totalRevenue:   totalRevenue.toFixed(2),
      totalCogs:      totalCogs.toFixed(2),
      totalProfit:    totalProfit.toFixed(2),
      avgOrderValue:  avgOrderValue.toFixed(2),
      featuredSku:    todayDeal.sku,
    })
    .onConflictDoUpdate({
      target: dailyProfitSummary.summaryDate,
      set: {
        totalOrders:   sql`excluded.total_orders`,
        totalRevenue:  sql`excluded.total_revenue`,
        totalCogs:     sql`excluded.total_cogs`,
        totalProfit:   sql`excluded.total_profit`,
        avgOrderValue: sql`excluded.avg_order_value`,
      },
    })

  // Update deal_history with final units sold + revenue
  await db
    .update(dealHistory)
    .set({
      unitsSold:    totalOrders,
      totalRevenue: totalRevenue.toFixed(2),
      totalProfit:  totalProfit.toFixed(2),
    })
    .where(eq(dealHistory.dealDate, today))
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
