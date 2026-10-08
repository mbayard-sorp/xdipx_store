/**
 * The admin P&L, the server half: reads every input the statement needs and
 * hands pnl-core.ts plain arrays. Each source fails soft into `gaps` so one
 * broken read shows as a named gap on the dashboard, never as a silent $0.
 *
 *   Shopify orders       revenue, discounts, refunds, shipping, tax, fees, units
 *   order metafields /   COGS (same precedence as profit.server.ts)
 *     inventory cost
 *   order_attribution    marketing source per order
 *   ad_creative_daily_   ad spend, impressions, clicks, platform-attributed orders
 *     metrics
 *   api_token_log        metered AI spend
 *   fixed_monthly_costs  software and subscriptions, spread per day
 *   pnl_expenses         one-off expenses (migration 119)
 *   pipeline_settings    pnl_handling_fee_cents, an optional per-order handling fee
 *
 * Shipping cost needs no input: each order is charged Nalpac's rate for its
 * shipping method and destination (NALPAC_SHIPPING_RATES in pnl-core.ts).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  adCreativeDailyMetrics, fixedMonthlyCosts, orderAttribution, pipelineSettings, pnlExpenses,
} from '../../db/schema'
import { costLineItem, costsFromOrderMetafields } from '~/lib/profit.server'
import { setPipelineSettingAudited, type SettingsActor } from '~/lib/settings.server'
import {
  COUNTED_FINANCIAL_STATUSES, PNL_EPOCH, addDays, dayInTz, isExpenseCategory, isIsoDay, orderToFact, round2,
  type AdSpendRow, type DailyAmount, type ExpenseRow, type FixedCostRow, type PnlInputs, type PnlOrderFact,
  type ShopifyPnlOrder,
} from '~/lib/pnl-core'

export const HANDLING_SETTING_KEY = 'pnl_handling_fee_cents'
const SOURCE = 'admin.pnl'
const FALLBACK_TZ = 'America/Phoenix'
const ORDERS_PAGE = 50
const CACHE_MS = 90_000

export class PnlInputError extends Error {}

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

const PNL_ORDERS_QUERY = `
  query PnlOrders($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        cancelledAt
        app { name }
        customer { id }
        customerJourneySummary { customerOrderIndex }
        totalPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        currentTotalTaxSet { shopMoney { amount } }
        currentSubtotalPriceSet { shopMoney { amount } }
        shippingAddress { countryCodeV2 provinceCode }
        shippingLines(first: 3) { nodes { title } }
        metafields(first: 25, namespace: "xdipx") { nodes { key value } }
        lineItems(first: 30) {
          nodes {
            title
            sku
            quantity
            currentQuantity
            originalTotalSet { shopMoney { amount } }
            product { handle productType }
            variant { inventoryItem { unitCost { amount } } }
          }
        }
        transactions(first: 10) {
          kind
          status
          gateway
          amountSet { shopMoney { amount } }
          fees { amount { amount } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

interface PnlOrdersPage {
  orders: { nodes: ShopifyPnlOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
}

let tzCache: string | null = null

/** The shop's timezone, read once per process. Days on the P&L are the store's days. */
export async function getStoreTimezone(): Promise<string> {
  if (tzCache) return tzCache
  try {
    const { adminGraphQL } = await import('~/lib/shopify.server')
    const r = await adminGraphQL<{ shop: { ianaTimezone: string | null } }>('query PnlShopTz { shop { ianaTimezone } }', {})
    tzCache = r.shop?.ianaTimezone || FALLBACK_TZ
  } catch (err) {
    console.error('[pnl] shop timezone read failed, using fallback', err)
    return FALLBACK_TZ
  }
  return tzCache
}

const orderCache = new Map<string, { at: number; facts: PnlOrderFact[] }>()

/**
 * Every counted order whose local day is in [from, to]. The Shopify search is
 * padded a day each side in UTC and then filtered by local day, so the
 * timezone offset can never drop an evening order. Test orders are excluded
 * at the source.
 */
export async function fetchOrderFacts(from: string, to: string, tz: string, opts: { fresh?: boolean } = {}): Promise<PnlOrderFact[]> {
  const key = `${tz}|${from}|${to}`
  const hit = orderCache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.facts

  const { adminGraphQL } = await import('~/lib/shopify.server')
  const search = `created_at:>='${addDays(from, -1)}T00:00:00Z' created_at:<'${addDays(to, 2)}T00:00:00Z' status:any test:false`
  const facts: PnlOrderFact[] = []
  let cursor: string | null = null
  do {
    const page: PnlOrdersPage = await adminGraphQL<PnlOrdersPage>(PNL_ORDERS_QUERY, { query: search, first: ORDERS_PAGE, after: cursor })
    for (const o of page.orders.nodes ?? []) {
      if (!COUNTED_FINANCIAL_STATUSES.has(o.displayFinancialStatus ?? '')) continue
      const day = dayInTz(o.createdAt, tz)
      if (day < from || day > to || day < PNL_EPOCH) continue
      facts.push(orderToFact(o, tz, costLineItem, costsFromOrderMetafields(o.metafields?.nodes ?? [])))
    }
    cursor = page.orders.pageInfo?.hasNextPage ? (page.orders.pageInfo.endCursor ?? null) : null
  } while (cursor !== null)

  orderCache.set(key, { at: Date.now(), facts })
  if (orderCache.size > 24) orderCache.delete(orderCache.keys().next().value!)
  return facts
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  direct: 'Direct', organic: 'Organic search', 'organic-search': 'Organic search', paid: 'Paid ads',
  'paid-search': 'Paid search', 'paid-social': 'Paid social', social: 'Organic social', email: 'Email',
  sms: 'SMS', referral: 'Referral', 'ai-assistant': 'AI assistants', affiliate: 'Affiliate', other: 'Other',
}

export function sourceLabel(row: { channelGroup: string; utmSource: string | null; referringSite: string | null }): string {
  const group = GROUP_LABELS[row.channelGroup] ?? row.channelGroup
  if (row.channelGroup === 'other' && row.referringSite) {
    try {
      const host = new URL(row.referringSite).hostname.replace(/^www\./, '')
      if (host === 'shop.com' || host === 'shop.app') return 'Shop app'
      if (host && host !== 'xdipx.com') return host
    } catch { /* fall through */ }
  }
  if (row.channelGroup === 'other' && row.utmSource) return row.utmSource
  return group
}

async function attachSources(facts: PnlOrderFact[], gaps: string[]): Promise<void> {
  if (facts.length === 0) return
  const ids = facts.map(f => f.id.split('/').pop() ?? f.id)
  try {
    const rows = await db
      .select({
        id: orderAttribution.shopifyOrderId, channelGroup: orderAttribution.channelGroup,
        utmSource: orderAttribution.utmSource, referringSite: orderAttribution.referringSite,
      })
      .from(orderAttribution)
      .where(inArray(orderAttribution.shopifyOrderId, ids))
    const byId = new Map(rows.map(r => [r.id, sourceLabel(r)]))
    for (const f of facts) f.source = byId.get(f.id.split('/').pop() ?? f.id) ?? 'Unattributed'
  } catch (err) {
    gaps.push('Marketing source (order_attribution) could not be read.')
    console.error('[pnl] attribution read failed', err)
  }
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

async function readAds(from: string, to: string): Promise<AdSpendRow[]> {
  const rows = await db
    .select({
      day: adCreativeDailyMetrics.day,
      platform: adCreativeDailyMetrics.platform,
      spend: sql<number>`coalesce(sum(${adCreativeDailyMetrics.spendCents}), 0)::int`,
      impressions: sql<number>`coalesce(sum(${adCreativeDailyMetrics.impressions}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${adCreativeDailyMetrics.clicks}), 0)::int`,
      orders: sql<number>`coalesce(sum(${adCreativeDailyMetrics.orders}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${adCreativeDailyMetrics.netRevenueCents}), 0)::int`,
    })
    .from(adCreativeDailyMetrics)
    .where(and(gte(adCreativeDailyMetrics.day, from), lte(adCreativeDailyMetrics.day, to)))
    .groupBy(adCreativeDailyMetrics.day, adCreativeDailyMetrics.platform)
  // 'shopify' rows are Shopify-side outcome rows with no spend; they are not a platform.
  return rows
    .filter(r => r.platform !== 'shopify')
    .map(r => ({
      day: r.day, platform: r.platform, spend: Number(r.spend) / 100, impressions: Number(r.impressions),
      clicks: Number(r.clicks), orders: Number(r.orders), attributedRevenue: Number(r.revenue) / 100,
    }))
}

async function readAi(from: string, to: string, tz: string): Promise<DailyAmount[]> {
  // api_token_log.ts is a UTC timestamp without zone; shift it into the store's day.
  const r = await db.execute(sql`
    SELECT ((ts AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date::text AS day,
           COALESCE(SUM(est_cost_usd), 0)::float8 AS usd
      FROM api_token_log
     WHERE ts >= (${from}::date - INTERVAL '1 day') AND ts < (${to}::date + INTERVAL '2 day')
     GROUP BY 1`)
  return ((r.rows ?? []) as Array<Record<string, unknown>>)
    .map(x => ({ day: String(x['day']), amount: Number(x['usd'] ?? 0) }))
    .filter(x => x.day >= from && x.day <= to && x.amount > 0)
}

export async function listFixedCosts(): Promise<FixedCostRow[]> {
  const rows = await db.select().from(fixedMonthlyCosts).orderBy(asc(fixedMonthlyCosts.vendor), desc(fixedMonthlyCosts.effectiveFrom))
  return rows.map(r => ({
    id: r.id, vendor: r.vendor, note: r.note, monthlyUsd: Number(r.monthlyUsd),
    effectiveFrom: String(r.effectiveFrom), effectiveTo: r.effectiveTo ? String(r.effectiveTo) : null,
  }))
}

export async function listExpenses(from?: string, to?: string): Promise<ExpenseRow[]> {
  const where = from && to ? and(gte(pnlExpenses.expenseDate, from), lte(pnlExpenses.expenseDate, to)) : undefined
  const rows = await db.select().from(pnlExpenses).where(where).orderBy(desc(pnlExpenses.expenseDate), desc(pnlExpenses.id))
  return rows.map(r => ({
    id: r.id, day: String(r.expenseDate), category: r.category, vendor: r.vendor, amount: Number(r.amountUsd), note: r.note,
  }))
}

export async function getHandlingFeePerOrder(): Promise<number | null> {
  const [row] = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq(pipelineSettings.key, HANDLING_SETTING_KEY))
  if (!row) return null
  const cents = Number(row.value)
  return Number.isFinite(cents) && cents >= 0 ? cents / 100 : null
}

// ---------------------------------------------------------------------------
// The whole input set
// ---------------------------------------------------------------------------

export interface PnlData {
  tz: string
  today: string
  inputs: PnlInputs
  fixedAll: FixedCostRow[]
  expensesRecent: ExpenseRow[]
  /** Human sentences, one per source that could not be read. */
  gaps: string[]
  /** False until migration 119 has been applied. */
  expensesReady: boolean
}

export async function loadPnlData(window: { from: string; to: string }, opts: { fresh?: boolean } = {}): Promise<PnlData> {
  const tz = await getStoreTimezone()
  const today = dayInTz(Date.now(), tz)
  const from = window.from < PNL_EPOCH ? PNL_EPOCH : window.from
  const to = window.to
  const gaps: string[] = []

  const [orders, ads, ai, fixedAll, expenses, handlingFeePerOrder] = await Promise.all([
    fetchOrderFacts(from, to, tz, opts),
    readAds(from, to).catch((err): AdSpendRow[] => { gaps.push('Ad spend could not be read.'); console.error('[pnl] ads', err); return [] }),
    readAi(from, to, tz).catch((err): DailyAmount[] => { gaps.push('AI spend could not be read.'); console.error('[pnl] ai', err); return [] }),
    listFixedCosts().catch((err): FixedCostRow[] => { gaps.push('Fixed monthly costs could not be read.'); console.error('[pnl] fixed', err); return [] }),
    listExpenses(from, to).then(rows => ({ ok: true as const, rows })).catch((err: unknown) => {
      console.error('[pnl] expenses', err)
      return { ok: false as const, rows: [] as ExpenseRow[] }
    }),
    getHandlingFeePerOrder().catch((): null => { gaps.push('Handling fee setting could not be read.'); return null }),
  ])
  await attachSources(orders, gaps)

  let expensesRecent: ExpenseRow[] = []
  if (expenses.ok) {
    expensesRecent = await listExpenses().catch((): ExpenseRow[] => []).then(r => r.slice(0, 200))
  } else {
    gaps.push('One-off expenses are not available yet (migration 119 applies on the next production deploy).')
  }

  return {
    tz, today, fixedAll, expensesRecent, gaps, expensesReady: expenses.ok,
    inputs: { orders, ads, ai, fixed: fixedAll, expenses: expenses.rows, handlingFeePerOrder },
  }
}

// ---------------------------------------------------------------------------
// Writes (owner only; the route checks the role)
// ---------------------------------------------------------------------------

function parseMoney(raw: unknown, what: string, opts: { allowZero?: boolean } = {}): number {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new PnlInputError(`Enter ${what} in dollars, like 12.50.`)
  const n = Number(cleaned)
  if (!opts.allowZero && n <= 0) throw new PnlInputError(`${what[0]!.toUpperCase()}${what.slice(1)} has to be more than $0.`)
  if (n > 1_000_000) throw new PnlInputError(`That ${what} is over $1,000,000. Check the number.`)
  return round2(n)
}

function cleanText(raw: unknown, max: number): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export async function saveHandlingFeePerOrder(raw: unknown, actor: SettingsActor): Promise<string> {
  const s = String(raw ?? '').trim()
  // Blank means no fee. Stored as 0 rather than deleted so the audit log keeps the change.
  const usd = s === '' ? 0 : parseMoney(s, 'the per-order handling fee', { allowZero: true })
  await setPipelineSettingAudited(HANDLING_SETTING_KEY, String(Math.round(usd * 100)), actor, SOURCE)
  return usd === 0 ? 'Handling fee cleared.' : `Handling fee set to $${usd.toFixed(2)} per order.`
}

export async function addFixedCost(input: { vendor: unknown; monthly: unknown; from: unknown; note: unknown }): Promise<string> {
  const vendor = cleanText(input.vendor, 48)
  if (!vendor) throw new PnlInputError('Name the vendor.')
  const monthly = parseMoney(input.monthly, 'the monthly cost')
  const from = isIsoDay(input.from) ? input.from : null
  if (!from) throw new PnlInputError('Pick the date this cost started.')
  const note = cleanText(input.note, 200) || null
  // A new price for an existing vendor closes the current row the day the new one starts.
  await db.update(fixedMonthlyCosts)
    .set({ effectiveTo: from })
    .where(and(eq(fixedMonthlyCosts.vendor, vendor), isNull(fixedMonthlyCosts.effectiveTo), lte(fixedMonthlyCosts.effectiveFrom, from)))
  await db.insert(fixedMonthlyCosts).values({ vendor, monthlyUsd: monthly.toFixed(2), effectiveFrom: from, note })
  return `${vendor} added at $${monthly.toFixed(2)}/month from ${from}.`
}

export async function endFixedCost(id: number, endDate: unknown): Promise<string> {
  const end = isIsoDay(endDate) ? endDate : null
  if (!end) throw new PnlInputError('Pick the date the cost stopped.')
  const [row] = await db.select().from(fixedMonthlyCosts).where(eq(fixedMonthlyCosts.id, id))
  if (!row) throw new PnlInputError('That cost no longer exists.')
  if (end <= String(row.effectiveFrom)) {
    // Ended before it began: it never applied, so remove it rather than leave a zero-length row.
    await db.delete(fixedMonthlyCosts).where(eq(fixedMonthlyCosts.id, id))
    return `${row.vendor} removed.`
  }
  await db.update(fixedMonthlyCosts).set({ effectiveTo: end }).where(eq(fixedMonthlyCosts.id, id))
  return `${row.vendor} ends ${end}.`
}

export async function addExpense(input: { date: unknown; category: unknown; vendor: unknown; amount: unknown; note: unknown }, createdBy: string | null): Promise<string> {
  const date = isIsoDay(input.date) ? input.date : null
  if (!date) throw new PnlInputError('Pick the expense date.')
  if (!isExpenseCategory(input.category)) throw new PnlInputError('Pick a category.')
  const vendor = cleanText(input.vendor, 80)
  if (!vendor) throw new PnlInputError('Say who it was paid to.')
  const amount = parseMoney(input.amount, 'the amount')
  await db.insert(pnlExpenses).values({
    expenseDate: date, category: input.category, vendor, amountUsd: amount.toFixed(2),
    note: cleanText(input.note, 300) || null, createdBy,
  })
  return `$${amount.toFixed(2)} to ${vendor} logged on ${date}.`
}

export async function deleteExpense(id: number): Promise<string> {
  const rows = await db.delete(pnlExpenses).where(eq(pnlExpenses.id, id)).returning({ vendor: pnlExpenses.vendor })
  if (rows.length === 0) throw new PnlInputError('That expense no longer exists.')
  return `Expense to ${rows[0]!.vendor} deleted.`
}
