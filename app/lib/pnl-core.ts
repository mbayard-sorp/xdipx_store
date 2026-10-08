/**
 * The P&L engine, the pure half. Client-safe: no database, no Shopify, no
 * server-only imports, so the dashboard and the tests share one definition of
 * every number.
 *
 * WHERE THE NUMBERS COME FROM
 *
 *  - Revenue, discounts, refunds, shipping, tax, payment fees and units come
 *    from the Shopify order itself (Shopify is the source of truth). Nothing is
 *    read from daily_profit_summary: that table carries only revenue and COGS,
 *    buckets by UTC day, and counts only `financial_status:paid`, so a refunded
 *    order and the stock it gave away vanish from it.
 *  - COGS uses the same precedence as profit.server.ts (order metafield first,
 *    then the variant's inventory unit cost). The caller injects it so this
 *    module stays pure. Units nobody can cost are counted, never priced at $0.
 *  - Shipping cost is Nalpac's average rate for the method the customer chose
 *    and where it went (NALPAC_SHIPPING_RATES), charged whether or not the
 *    customer paid for shipping.
 *  - Ad spend, AI spend, fixed costs and one-off expenses are joined by day.
 *
 * ACCOUNTING BASIS. Order-date: a refund issued next week lands on the day the
 * order was placed, which is how Shopify's own "net sales" by order date reads.
 * Days are the store's local days (Shopify's shop timezone), not UTC days.
 */

/** The first real sale (order #1002, 2026-07-23). Nothing before it is in the P&L. */
export const PNL_EPOCH = '2026-07-23'

/** Matches owner-queue.server.ts MONTHLY_PROFIT_GOAL_USD and CLAUDE.md's live goal. */
export const MONTHLY_PROFIT_GOAL_USD = 2000

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** YYYY-MM-DD of an instant in `tz`. */
export function dayInTz(iso: string | number | Date, tz: string): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive day count from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

export function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && ISO_DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export const RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'mtd', label: 'Month to date' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'qtd', label: 'Quarter to date' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'Since first sale' },
] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]['id'] | 'custom'
export type Granularity = 'day' | 'week' | 'month'

export interface ResolvedRange {
  preset: RangePreset
  label: string
  from: string
  to: string
  days: number
  /** The equal-length window just before, or null when it would sit wholly before the first sale. */
  prev: { from: string; to: string; partial: boolean } | null
  granularity: Granularity
}

export function granularityFor(days: number): Granularity {
  if (days <= 45) return 'day'
  if (days <= 210) return 'week'
  return 'month'
}

/**
 * Turn the URL's `range` / `from` / `to` into concrete local days. Every range
 * is clamped to start no earlier than the first sale and end no later than
 * today: the P&L has no pre-sales history by design.
 */
export function resolveRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  today: string,
  epoch: string = PNL_EPOCH,
): ResolvedRange {
  let preset = (input.range ?? '30d') as RangePreset
  let from: string
  let to = today
  switch (preset) {
    case 'today': from = today; break
    case '7d': from = addDays(today, -6); break
    case '90d': from = addDays(today, -89); break
    case 'mtd': from = monthStart(today); break
    case 'lastmonth': {
      to = addDays(monthStart(today), -1)
      from = monthStart(to)
      break
    }
    case 'qtd': {
      const [y, m] = today.split('-').map(Number) as [number, number]
      const qm = Math.floor((m - 1) / 3) * 3 + 1
      from = `${y}-${String(qm).padStart(2, '0')}-01`
      break
    }
    case 'ytd': from = `${today.slice(0, 4)}-01-01`; break
    case 'all': from = epoch; break
    case 'custom': {
      if (isIsoDay(input.from) && isIsoDay(input.to)) {
        from = input.from <= input.to ? input.from : input.to
        to = input.from <= input.to ? input.to : input.from
      } else {
        preset = '30d'
        from = addDays(today, -29)
      }
      break
    }
    default:
      preset = '30d'
      from = addDays(today, -29)
  }
  if (to > today) to = today
  if (from < epoch) from = epoch
  if (to < from) to = from

  const days = daysBetween(from, to)
  // Calendar presets compare month over month (September against all of
  // August, the first eight days of October against the first eight of
  // September). Everything else compares with the equal window just before.
  let rawPrevFrom = addDays(from, -days)
  let prevTo = addDays(from, -1)
  if ((preset === 'lastmonth' || preset === 'mtd') && from === monthStart(from)) {
    rawPrevFrom = monthStart(prevTo)
    if (preset === 'mtd') {
      const end = addDays(rawPrevFrom, days - 1)
      if (end < prevTo) prevTo = end
    }
  }
  let prev: ResolvedRange['prev'] = null
  if (prevTo >= epoch) {
    prev = { from: rawPrevFrom < epoch ? epoch : rawPrevFrom, to: prevTo, partial: rawPrevFrom < epoch }
  }
  const label = preset === 'custom'
    ? `${from} to ${to}`
    : RANGE_PRESETS.find(p => p.id === preset)?.label ?? preset
  return { preset, label, from, to, days, prev, granularity: granularityFor(days) }
}

/** The bucket a day falls in at a granularity. Weeks start Monday. */
export function bucketOf(day: string, g: Granularity): string {
  if (g === 'day') return day
  if (g === 'month') return day.slice(0, 7)
  const d = new Date(`${day}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  return addDays(day, -dow)
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

type Money = { shopMoney: { amount: string } } | null | undefined

export interface ShopifyPnlLine {
  title: string
  sku: string | null
  quantity: number
  currentQuantity: number
  originalTotalSet: Money
  product: { handle: string; productType: string | null } | null
  variant: { inventoryItem: { unitCost: { amount: string } | null } | null } | null
}

export interface ShopifyPnlOrder {
  id: string
  name: string
  createdAt: string
  displayFinancialStatus: string | null
  cancelledAt: string | null
  app: { name: string } | null
  customer: { id: string } | null
  customerJourneySummary: { customerOrderIndex: number | null } | null
  totalPriceSet: Money
  totalTaxSet: Money
  totalShippingPriceSet: Money
  totalDiscountsSet: Money
  currentTotalPriceSet: Money
  currentTotalTaxSet: Money
  currentSubtotalPriceSet: Money
  shippingAddress: { countryCodeV2: string | null; provinceCode: string | null } | null
  shippingLines: { nodes: Array<{ title: string | null }> }
  metafields: { nodes: Array<{ key: string; value: string }> }
  lineItems: { nodes: ShopifyPnlLine[] }
  transactions: Array<{ kind: string; status: string; gateway: string | null; amountSet?: Money; fees: Array<{ amount: { amount: string } }> }>
}

/** Financial statuses where money actually moved. Pending, authorized-only, voided and expired orders are not sales. */
export const COUNTED_FINANCIAL_STATUSES = new Set(['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'])

/**
 * What Nalpac charges us to ship one drop-ship order, by the Shopify rate the
 * customer picked. Nalpac's average rates, from the owner's rate table
 * (2026-10-08). Update here when Nalpac's rates change.
 */
export const NALPAC_SHIPPING_RATES = {
  'standard-us': { label: 'Standard US', nalpac: 'Best Rate Standard', cost: 6.5 },
  'standard-remote': { label: 'Standard HI, AK, PR', nalpac: 'Best Rate Standard', cost: 11.53 },
  expedited: { label: 'Expedited US', nalpac: 'FedEx One Rate', cost: 12.5 },
  canada: { label: 'Standard Canada', nalpac: 'Best Rate International', cost: 23.8 },
  international: { label: 'International', nalpac: 'Best Rate International', cost: 44.7 },
} as const
export type ShippingTier = keyof typeof NALPAC_SHIPPING_RATES

const REMOTE_US = new Set(['HI', 'AK', 'PR'])

/**
 * Which Nalpac rate an order ships on. Expedited is chosen by the rate name;
 * everything else by destination, so a free-shipping promo on a Hawaii order
 * still costs the Hawaii rate. No address (a rare draft order) is treated as
 * Standard US, the method nearly every order uses.
 */
export function shippingTierFor(title: string | null | undefined, country: string | null | undefined, province: string | null | undefined): ShippingTier {
  const t = (title ?? '').toLowerCase()
  const c = (country ?? 'US').toUpperCase()
  if (c === 'CA') return 'canada'
  if (c !== 'US' && c !== 'PR') return 'international'
  if (/expedit|express|fedex|overnight|priority|2[- ]?day/.test(t)) return 'expedited'
  if (c === 'PR' || REMOTE_US.has((province ?? '').toUpperCase())) return 'standard-remote'
  return 'standard-us'
}

export interface PnlLine {
  title: string
  handle: string | null
  sku: string | null
  productType: string
  units: number
  /** Net product revenue allocated to this line (after discounts and returns, before shipping and tax). */
  revenue: number
  /** Null when no source could cost it. */
  cogs: number | null
}

export interface PnlOrderFact {
  id: string
  name: string
  createdAt: string
  day: string
  status: string
  channel: string
  /** Marketing source from order_attribution (UTM / referrer), filled in by the server. */
  source: string
  customerType: 'new' | 'returning' | 'unknown'
  units: number
  grossSales: number
  discounts: number
  returns: number
  shipping: number
  tax: number
  netRevenue: number
  cogs: number
  cogsMissingUnits: number
  paymentFees: number
  shippingTier: ShippingTier
  /** Nalpac's charge to ship this order. Zero when nothing shipped. */
  shippingCost: number
  /** Amount paid with Shop Cash. A tender, not a cost; shown as a memo. */
  shopCash: number
  lines: PnlLine[]
}

export type CostLineFn = (
  line: { sku: string | null; quantity: number; variant: ShopifyPnlLine['variant'] },
  orderCosts: Map<string, number>,
) => { cost: number | null }

const num = (m: Money): number => {
  const n = Number(m?.shopMoney?.amount ?? 0)
  return Number.isFinite(n) ? n : 0
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

/** Shopify's app name, in the words the owner uses. */
export function channelLabel(appName: string | null | undefined): string {
  const n = (appName ?? '').trim()
  if (!n) return 'Other'
  if (n === 'Storefront Admin' || /headless|hydrogen/i.test(n)) return 'xdipx.com'
  if (n === 'Shop') return 'Shop app'
  return n
}

/**
 * One Shopify order to one P&L fact.
 *
 * The revenue identity holds by construction:
 *   grossSales - discounts - returns + shipping = netRevenue
 * gross is derived from the order totals rather than summed from lines, so a
 * shipping discount or an order edit can never make the statement not foot.
 */
export function orderToFact(
  o: ShopifyPnlOrder,
  tz: string,
  costLine: CostLineFn,
  orderCosts: Map<string, number>,
): PnlOrderFact {
  const totalPrice = num(o.totalPriceSet)
  const totalTax = num(o.totalTaxSet)
  const shipping = num(o.totalShippingPriceSet)
  const discounts = num(o.totalDiscountsSet)
  const currentTotal = num(o.currentTotalPriceSet)
  const currentTax = num(o.currentTotalTaxSet)
  const currentSubtotal = num(o.currentSubtotalPriceSet)

  const originalNet = totalPrice - totalTax
  const netRevenue = Math.max(0, currentTotal - currentTax)
  const returns = Math.max(0, originalNet - netRevenue)
  const grossSales = originalNet - shipping + discounts

  // Allocate the current product subtotal across lines by their current list value.
  const lines = o.lineItems?.nodes ?? []
  const listValue = lines.map(l => {
    const qty = Math.max(0, l.quantity)
    const unit = qty > 0 ? num(l.originalTotalSet) / qty : 0
    return unit * Math.max(0, l.currentQuantity)
  })
  const listTotal = listValue.reduce((s, v) => s + v, 0)

  let cogs = 0
  let cogsMissingUnits = 0
  let units = 0
  const outLines: PnlLine[] = lines.map((l, i) => {
    const q = Math.max(0, l.currentQuantity)
    units += q
    const { cost } = q > 0 ? costLine({ sku: l.sku, quantity: q, variant: l.variant }, orderCosts) : { cost: 0 }
    if (cost === null) cogsMissingUnits += q
    else cogs += cost
    return {
      title: l.title,
      handle: l.product?.handle ?? null,
      sku: l.sku,
      productType: l.product?.productType?.trim() || 'Uncategorized',
      units: q,
      revenue: listTotal > 0 ? round2(currentSubtotal * (listValue[i]! / listTotal)) : 0,
      cogs: cost === null ? null : round2(cost),
    }
  })

  let paymentFees = 0
  let shopCash = 0
  for (const t of o.transactions ?? []) {
    if (t.status !== 'SUCCESS') continue
    if (t.kind === 'SALE' || t.kind === 'CAPTURE') {
      for (const f of t.fees ?? []) {
        const v = Number(f.amount?.amount ?? 0)
        if (Number.isFinite(v)) paymentFees += v
      }
      if (t.gateway === 'shop_cash') shopCash += num(t.amountSet)
    }
  }

  const shippingTier = shippingTierFor(
    o.shippingLines?.nodes?.[0]?.title, o.shippingAddress?.countryCodeV2, o.shippingAddress?.provinceCode,
  )
  const shippingCost = units > 0 ? NALPAC_SHIPPING_RATES[shippingTier].cost : 0

  const idx = o.customerJourneySummary?.customerOrderIndex
  const customerType: PnlOrderFact['customerType'] = idx == null ? 'unknown' : idx <= 1 ? 'new' : 'returning'

  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    day: dayInTz(o.createdAt, tz),
    status: o.displayFinancialStatus ?? 'UNKNOWN',
    channel: channelLabel(o.app?.name),
    source: 'Unattributed',
    customerType,
    units,
    grossSales: round2(grossSales),
    discounts: round2(discounts),
    returns: round2(returns),
    shipping: round2(shipping),
    tax: round2(currentTax),
    netRevenue: round2(netRevenue),
    cogs: round2(cogs),
    cogsMissingUnits,
    paymentFees: round2(paymentFees),
    shippingTier,
    shippingCost,
    shopCash: round2(shopCash),
    lines: outLines,
  }
}

// ---------------------------------------------------------------------------
// Costs outside the order
// ---------------------------------------------------------------------------

export interface AdSpendRow {
  day: string
  platform: string
  spend: number
  impressions: number
  clicks: number
  /** Platform-attributed orders and revenue: what the platform claims, not what Shopify booked. */
  orders: number
  attributedRevenue: number
}

export interface DailyAmount { day: string; amount: number }

/** A hand-entered platform total for a period, spread evenly over its days. */
export interface ManualAdSpendRow {
  id: number
  platform: string
  from: string
  to: string
  amount: number
  note: string | null
}

/** Platforms offered when typing a manual entry. Any other name is accepted. */
export const AD_PLATFORM_SUGGESTIONS = [
  'Google Ads', 'Microsoft Ads', 'Meta', 'Reddit', 'Snapchat', 'TikTok', 'X', 'Shop Campaigns',
  'TrafficJunky', 'ExoClick', 'Newsletter sponsorship',
] as const

/** The part of a manual entry that falls inside [from, to]. */
export function manualAdShare(row: ManualAdSpendRow, from: string, to: string): number {
  const lo = row.from > from ? row.from : from
  const hi = row.to < to ? row.to : to
  if (lo > hi) return 0
  return (row.amount * daysBetween(lo, hi)) / daysBetween(row.from, row.to)
}

/**
 * The period a month's entry covers: the whole month when it is over, the 1st
 * through `today` while it is still running (so month-to-date spend is not
 * smeared over days that have not happened).
 */
export function manualAdPeriod(month: string, today: string): { from: string; to: string } {
  const from = `${month}-01`
  const end = addDays(from, daysInMonth(from) - 1)
  return { from, to: end > today ? today : end }
}

/**
 * Platforms with both a manual entry and imported spend on the same days.
 * Both are counted, so each one here is a likely double count.
 */
export function manualAdOverlaps(manual: readonly ManualAdSpendRow[], ads: readonly AdSpendRow[]): string[] {
  const out = new Set<string>()
  for (const m of manual) {
    const label = platformLabel(m.platform)
    if (ads.some(a => a.spend > 0 && platformLabel(a.platform) === label && a.day >= m.from && a.day <= m.to)) {
      out.add(`${label} ${m.from.slice(0, 7)}`)
    }
  }
  return [...out]
}

export interface FixedCostRow {
  id: number
  vendor: string
  note: string | null
  monthlyUsd: number
  effectiveFrom: string
  effectiveTo: string | null
}

export const EXPENSE_CATEGORIES = [
  { id: 'advertising', label: 'Advertising' },
  { id: 'software', label: 'Software & tools' },
  { id: 'fulfillment', label: 'Shipping & fulfillment' },
  { id: 'contractors', label: 'Contractors & services' },
  { id: 'inventory', label: 'Samples & inventory' },
  { id: 'legal', label: 'Legal, banking & admin' },
  { id: 'other', label: 'Other' },
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['id']

export function isExpenseCategory(s: unknown): s is ExpenseCategory {
  return EXPENSE_CATEGORIES.some(c => c.id === s)
}

export function expenseCategoryLabel(id: string): string {
  return EXPENSE_CATEGORIES.find(c => c.id === id)?.label ?? id
}

export interface ExpenseRow {
  id: number
  day: string
  category: string
  vendor: string
  amount: number
  note: string | null
}

export function platformLabel(p: string): string {
  const k = p.toLowerCase()
  const known: Record<string, string> = {
    google: 'Google Ads', microsoft: 'Microsoft Ads', bing: 'Microsoft Ads', meta: 'Meta', facebook: 'Meta',
    instagram: 'Meta', shop: 'Shop Campaigns', snapchat: 'Snapchat', snap: 'Snapchat', reddit: 'Reddit',
    tiktok: 'TikTok', x: 'X', twitter: 'X', trafficjunky: 'TrafficJunky', exoclick: 'ExoClick',
  }
  return known[k] ?? p
}

/**
 * A fixed monthly cost spread over the days it was in force: each day carries
 * monthly / days-in-that-month, so a full calendar month sums to exactly the
 * monthly figure and a vendor added mid-month is only charged from that day.
 */
export function fixedCostForDay(row: FixedCostRow, day: string): number {
  if (day < row.effectiveFrom) return 0
  if (row.effectiveTo && day >= row.effectiveTo) return 0
  return row.monthlyUsd / daysInMonth(day)
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface PnlTotals {
  orders: number
  units: number
  newCustomers: number
  returningCustomers: number
  grossSales: number
  discounts: number
  returns: number
  shipping: number
  netRevenue: number
  tax: number
  shopCash: number
  productCost: number
  cogsMissingUnits: number
  /** Nalpac shipping at table rates. */
  shippingCost: number
  /** Optional per-order handling fee plus logged shipping & fulfillment expenses. */
  handling: number
  /** shippingCost + handling. */
  fulfillment: number
  paymentFees: number
  grossProfit: number
  adSpend: number
  adByPlatform: Record<string, number>
  contribution: number
  aiSpend: number
  fixedCosts: number
  fixedByVendor: Record<string, number>
  otherExpenses: number
  otherByCategory: Record<string, number>
  operatingExpenses: number
  netProfit: number
}

export interface PnlInputs {
  orders: readonly PnlOrderFact[]
  ads: readonly AdSpendRow[]
  /** Hand-entered monthly platform totals (migration 120). */
  manualAds: readonly ManualAdSpendRow[]
  ai: readonly DailyAmount[]
  fixed: readonly FixedCostRow[]
  expenses: readonly ExpenseRow[]
  /** Optional extra per-order fee on top of Nalpac shipping (a drop-ship or packaging fee), or null for none. */
  handlingFeePerOrder: number | null
}

const inWindow = (day: string, from: string, to: string) => day >= from && day <= to
const bump = (rec: Record<string, number>, k: string, v: number) => { rec[k] = (rec[k] ?? 0) + v }

export function emptyTotals(): PnlTotals {
  return {
    orders: 0, units: 0, newCustomers: 0, returningCustomers: 0,
    grossSales: 0, discounts: 0, returns: 0, shipping: 0, netRevenue: 0, tax: 0, shopCash: 0,
    productCost: 0, cogsMissingUnits: 0, shippingCost: 0, handling: 0, fulfillment: 0, paymentFees: 0, grossProfit: 0,
    adSpend: 0, adByPlatform: {}, contribution: 0,
    aiSpend: 0, fixedCosts: 0, fixedByVendor: {}, otherExpenses: 0, otherByCategory: {},
    operatingExpenses: 0, netProfit: 0,
  }
}

/** Handling fee, charged per order that shipped something. */
export function handlingFor(o: PnlOrderFact, perOrder: number | null): number {
  return perOrder != null && o.units > 0 ? perOrder : 0
}

/** Everything it cost to get one order out the door: Nalpac shipping plus any handling fee. */
export function fulfillmentFor(o: PnlOrderFact, handlingPerOrder: number | null): number {
  return o.shippingCost + handlingFor(o, handlingPerOrder)
}

/** Every number on the statement, for one window. */
export function totalsFor(input: PnlInputs, from: string, to: string): PnlTotals {
  const t = emptyTotals()
  for (const o of input.orders) {
    if (!inWindow(o.day, from, to)) continue
    t.orders += 1
    t.units += o.units
    if (o.customerType === 'new') t.newCustomers += 1
    if (o.customerType === 'returning') t.returningCustomers += 1
    t.grossSales += o.grossSales
    t.discounts += o.discounts
    t.returns += o.returns
    t.shipping += o.shipping
    t.netRevenue += o.netRevenue
    t.tax += o.tax
    t.shopCash += o.shopCash
    t.productCost += o.cogs
    t.cogsMissingUnits += o.cogsMissingUnits
    t.paymentFees += o.paymentFees
    t.shippingCost += o.shippingCost
    t.handling += handlingFor(o, input.handlingFeePerOrder)
  }
  for (const a of input.ads) {
    if (!inWindow(a.day, from, to) || a.spend === 0) continue
    t.adSpend += a.spend
    bump(t.adByPlatform, platformLabel(a.platform), a.spend)
  }
  for (const m of input.manualAds) {
    const v = manualAdShare(m, from, to)
    if (v > 0) { t.adSpend += v; bump(t.adByPlatform, platformLabel(m.platform), v) }
  }
  for (const a of input.ai) {
    if (inWindow(a.day, from, to)) t.aiSpend += a.amount
  }
  for (const f of input.fixed) {
    let v = 0
    for (let d = from; d <= to; d = addDays(d, 1)) v += fixedCostForDay(f, d)
    if (v > 0) { t.fixedCosts += v; bump(t.fixedByVendor, f.vendor, v) }
  }
  for (const e of input.expenses) {
    if (!inWindow(e.day, from, to)) continue
    if (e.category === 'advertising') {
      t.adSpend += e.amount
      bump(t.adByPlatform, e.vendor || 'Other advertising', e.amount)
    } else if (e.category === 'fulfillment') {
      t.handling += e.amount
    } else {
      t.otherExpenses += e.amount
      bump(t.otherByCategory, expenseCategoryLabel(e.category), e.amount)
    }
  }
  t.fulfillment = t.shippingCost + t.handling
  t.grossProfit = t.netRevenue - t.productCost - t.fulfillment - t.paymentFees
  t.contribution = t.grossProfit - t.adSpend
  t.operatingExpenses = t.aiSpend + t.fixedCosts + t.otherExpenses
  t.netProfit = t.contribution - t.operatingExpenses
  return roundTotals(t)
}

function roundTotals(t: PnlTotals): PnlTotals {
  const out = { ...t } as Record<string, unknown>
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === 'number') out[k] = round2(v)
    else if (v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, number>).map(([kk, vv]) => [kk, round2(vv)]))
  }
  return out as unknown as PnlTotals
}

// ---------------------------------------------------------------------------
// Derived ratios
// ---------------------------------------------------------------------------

export interface PnlRatios {
  aov: number | null
  grossMarginPct: number | null
  contributionMarginPct: number | null
  netMarginPct: number | null
  /** Marketing efficiency ratio: net revenue per ad dollar. */
  mer: number | null
  /** Blended customer acquisition cost: ad spend per new customer. */
  cac: number | null
  discountRatePct: number | null
  refundRatePct: number | null
  /** Shipping charged to customers less what Nalpac charged to ship. Negative means shipping is subsidized. */
  shippingMargin: number
  /** Contribution per order before ads: what one order can afford to pay for itself. */
  breakevenCpa: number | null
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const pct = (a: number, b: number): number | null => (b > 0 ? round2((a / b) * 100) : null)

export function ratiosFor(t: PnlTotals): PnlRatios {
  return {
    aov: t.orders > 0 ? round2(t.netRevenue / t.orders) : null,
    grossMarginPct: pct(t.grossProfit, t.netRevenue),
    contributionMarginPct: pct(t.contribution, t.netRevenue),
    netMarginPct: pct(t.netProfit, t.netRevenue),
    mer: t.adSpend > 0 ? round2(t.netRevenue / t.adSpend) : null,
    cac: t.adSpend > 0 && t.newCustomers > 0 ? round2(t.adSpend / t.newCustomers) : null,
    discountRatePct: pct(t.discounts, t.grossSales),
    refundRatePct: pct(t.returns, t.grossSales),
    shippingMargin: round2(t.shipping - t.shippingCost),
    breakevenCpa: t.orders > 0 ? round2(ratio(t.grossProfit, t.orders) ?? 0) : null,
  }
}

/** Percent change, or null when there is no meaningful base. */
export function deltaPct(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null
  return round2(((cur - prev) / Math.abs(prev)) * 100)
}

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------

export interface StatementRow {
  key: string
  label: string
  kind: 'line' | 'subtotal' | 'total' | 'memo' | 'header'
  indent: 0 | 1 | 2
  /** Costs are stored positive and flagged; the UI shows them as negatives. */
  isCost: boolean
  value: number | null
  hint?: string | undefined
}

/**
 * The P&L statement rows for one window, top to bottom. Dynamic rows (one per
 * ad platform, per software vendor, per expense category) appear only when they
 * carry money so the statement stays as short as the business is.
 */
export function statementRows(t: PnlTotals): StatementRow[] {
  const rows: StatementRow[] = []
  const push = (r: StatementRow) => rows.push(r)

  push({ key: 'h-rev', label: 'Revenue', kind: 'header', indent: 0, isCost: false, value: null })
  push({ key: 'grossSales', label: 'Gross sales', kind: 'line', indent: 1, isCost: false, value: t.grossSales })
  push({ key: 'discounts', label: 'Discounts', kind: 'line', indent: 1, isCost: true, value: t.discounts })
  push({ key: 'returns', label: 'Returns & refunds', kind: 'line', indent: 1, isCost: true, value: t.returns })
  push({ key: 'shipping', label: 'Shipping charged', kind: 'line', indent: 1, isCost: false, value: t.shipping })
  push({ key: 'netRevenue', label: 'Net revenue', kind: 'subtotal', indent: 0, isCost: false, value: t.netRevenue })

  push({ key: 'h-cogs', label: 'Cost of sales', kind: 'header', indent: 0, isCost: false, value: null })
  push({
    key: 'productCost', label: 'Product cost (wholesale)', kind: 'line', indent: 1, isCost: true, value: t.productCost,
    hint: t.cogsMissingUnits > 0 ? `${t.cogsMissingUnits} unit${t.cogsMissingUnits === 1 ? '' : 's'} had no cost on file and are not included` : undefined,
  })
  push({
    key: 'shippingCost', label: 'Shipping (Nalpac)', kind: 'line', indent: 1, isCost: true, value: t.shippingCost,
    hint: 'Nalpac average rate for each order\'s shipping method',
  })
  if (t.handling > 0) {
    push({ key: 'handling', label: 'Handling & other fulfillment', kind: 'line', indent: 1, isCost: true, value: t.handling })
  }
  push({ key: 'paymentFees', label: 'Payment processing', kind: 'line', indent: 1, isCost: true, value: t.paymentFees, hint: 'Actual Shopify Payments fees' })
  push({ key: 'grossProfit', label: 'Gross profit', kind: 'subtotal', indent: 0, isCost: false, value: t.grossProfit })

  push({ key: 'h-mkt', label: 'Marketing', kind: 'header', indent: 0, isCost: false, value: null })
  const platforms = Object.entries(t.adByPlatform).sort((a, b) => b[1] - a[1])
  if (platforms.length === 0) {
    push({ key: 'ads-none', label: 'Ad spend', kind: 'line', indent: 1, isCost: true, value: 0, hint: 'No ad spend recorded in this window' })
  }
  for (const [p, v] of platforms) push({ key: `ads-${p}`, label: p, kind: 'line', indent: 1, isCost: true, value: v })
  push({ key: 'contribution', label: 'Contribution after marketing', kind: 'subtotal', indent: 0, isCost: false, value: t.contribution })

  push({ key: 'h-opex', label: 'Operating expenses', kind: 'header', indent: 0, isCost: false, value: null })
  push({ key: 'aiSpend', label: 'AI & API usage (metered)', kind: 'line', indent: 1, isCost: true, value: t.aiSpend, hint: 'Anthropic API-key spend from the token log. Max-subscription usage is a fixed cost.' })
  const vendors = Object.entries(t.fixedByVendor).sort((a, b) => b[1] - a[1])
  if (vendors.length === 0) {
    push({ key: 'fixed-none', label: 'Software & subscriptions', kind: 'line', indent: 1, isCost: true, value: null, hint: 'No fixed monthly costs entered yet. Add them under Costs.' })
  }
  for (const [v, amt] of vendors) push({ key: `fixed-${v}`, label: v, kind: 'line', indent: 1, isCost: true, value: amt })
  for (const [c, amt] of Object.entries(t.otherByCategory).sort((a, b) => b[1] - a[1])) {
    push({ key: `exp-${c}`, label: c, kind: 'line', indent: 1, isCost: true, value: amt })
  }
  push({ key: 'operatingExpenses', label: 'Total operating expenses', kind: 'subtotal', indent: 0, isCost: true, value: t.operatingExpenses })

  push({ key: 'netProfit', label: 'Net profit', kind: 'total', indent: 0, isCost: false, value: t.netProfit })
  push({ key: 'tax', label: 'Sales tax collected (passed through, not revenue)', kind: 'memo', indent: 0, isCost: false, value: t.tax })
  if (t.shopCash > 0) {
    push({ key: 'shopCash', label: 'Paid with Shop Cash (included in revenue)', kind: 'memo', indent: 0, isCost: false, value: t.shopCash })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Series and breakdowns
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  bucket: string
  from: string
  to: string
  orders: number
  netRevenue: number
  grossProfit: number
  adSpend: number
  netProfit: number
}

export function seriesFor(input: PnlInputs, from: string, to: string, g: Granularity): SeriesPoint[] {
  const buckets = new Map<string, { from: string; to: string }>()
  for (const d of eachDay(from, to)) {
    const b = bucketOf(d, g)
    const cur = buckets.get(b)
    if (!cur) buckets.set(b, { from: d, to: d })
    else cur.to = d
  }
  return [...buckets.entries()].map(([bucket, w]) => {
    const t = totalsFor(input, w.from, w.to)
    return {
      bucket, from: w.from, to: w.to, orders: t.orders,
      netRevenue: t.netRevenue, grossProfit: t.grossProfit, adSpend: t.adSpend, netProfit: t.netProfit,
    }
  })
}

export interface MonthColumn { month: string; from: string; to: string; partial: boolean; totals: PnlTotals }

/** Calendar-month columns covering the window, each clamped to it. */
export function monthlyColumns(input: PnlInputs, from: string, to: string): MonthColumn[] {
  const cols: MonthColumn[] = []
  for (let m = monthStart(from); m <= to; m = addDays(m, daysInMonth(m))) {
    const end = addDays(m, daysInMonth(m) - 1)
    const f = m < from ? from : m
    const tt = end > to ? to : end
    cols.push({ month: m.slice(0, 7), from: f, to: tt, partial: f !== m || tt !== end, totals: totalsFor(input, f, tt) })
  }
  return cols
}

export interface BreakdownRow {
  key: string
  label: string
  orders: number
  units: number
  revenue: number
  cogs: number
  grossProfit: number
  marginPct: number | null
  sharePct: number | null
}

function finishBreakdown(map: Map<string, BreakdownRow>, totalRevenue: number): BreakdownRow[] {
  return [...map.values()]
    .map(r => ({
      ...r,
      revenue: round2(r.revenue), cogs: round2(r.cogs), grossProfit: round2(r.revenue - r.cogs),
      marginPct: pct(r.revenue - r.cogs, r.revenue),
      sharePct: pct(r.revenue, totalRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label))
}

/**
 * Product and category rows. Revenue is net product revenue (shipping and tax
 * excluded), so these margins are product margins: payment fees and
 * fulfillment are order-level and live on the statement.
 */
export function productBreakdown(orders: readonly PnlOrderFact[], from: string, to: string, by: 'product' | 'category'): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>()
  let total = 0
  for (const o of orders) {
    if (!inWindow(o.day, from, to)) continue
    const seen = new Set<string>()
    for (const l of o.lines) {
      if (l.units === 0 && l.revenue === 0) continue
      const key = by === 'product' ? (l.handle ?? l.sku ?? l.title) : l.productType
      const label = by === 'product' ? l.title : l.productType
      let r = map.get(key)
      if (!r) { r = { key, label, orders: 0, units: 0, revenue: 0, cogs: 0, grossProfit: 0, marginPct: null, sharePct: null }; map.set(key, r) }
      if (!seen.has(key)) { r.orders += 1; seen.add(key) }
      r.units += l.units
      r.revenue += l.revenue
      r.cogs += l.cogs ?? 0
      total += l.revenue
    }
  }
  return finishBreakdown(map, total)
}

/** Order-level rows grouped by a label (sales channel, marketing source, customer type). */
export function orderBreakdown(
  orders: readonly PnlOrderFact[],
  from: string,
  to: string,
  keyOf: (o: PnlOrderFact) => string,
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>()
  let total = 0
  for (const o of orders) {
    if (!inWindow(o.day, from, to)) continue
    const key = keyOf(o)
    let r = map.get(key)
    if (!r) { r = { key, label: key, orders: 0, units: 0, revenue: 0, cogs: 0, grossProfit: 0, marginPct: null, sharePct: null }; map.set(key, r) }
    r.orders += 1
    r.units += o.units
    r.revenue += o.netRevenue
    r.cogs += o.cogs + o.paymentFees
    total += o.netRevenue
  }
  return finishBreakdown(map, total)
}

export interface AdPlatformRow {
  platform: string
  spend: number
  impressions: number
  clicks: number
  ctrPct: number | null
  cpc: number | null
  orders: number
  attributedRevenue: number
  roas: number | null
  /** Where the spend came from: platform import, hand-entered monthly totals, logged expenses. */
  sources: Array<'imported' | 'monthly' | 'expense'>
}

export function adPlatformRows(
  ads: readonly AdSpendRow[],
  expenses: readonly ExpenseRow[],
  from: string,
  to: string,
  manualAds: readonly ManualAdSpendRow[] = [],
): AdPlatformRow[] {
  const map = new Map<string, AdPlatformRow>()
  const get = (p: string) => {
    let r = map.get(p)
    if (!r) { r = { platform: p, spend: 0, impressions: 0, clicks: 0, ctrPct: null, cpc: null, orders: 0, attributedRevenue: 0, roas: null, sources: [] }; map.set(p, r) }
    return r
  }
  const tag = (r: AdPlatformRow, s: AdPlatformRow['sources'][number]) => { if (!r.sources.includes(s)) r.sources.push(s) }
  for (const a of ads) {
    if (!inWindow(a.day, from, to)) continue
    if (a.spend === 0 && a.impressions === 0 && a.clicks === 0) continue
    const r = get(platformLabel(a.platform))
    r.spend += a.spend; r.impressions += a.impressions; r.clicks += a.clicks
    r.orders += a.orders; r.attributedRevenue += a.attributedRevenue
    tag(r, 'imported')
  }
  for (const m of manualAds) {
    const v = manualAdShare(m, from, to)
    if (v <= 0) continue
    const r = get(platformLabel(m.platform))
    r.spend += v
    tag(r, 'monthly')
  }
  for (const e of expenses) {
    if (e.category !== 'advertising' || !inWindow(e.day, from, to)) continue
    const r = get(e.vendor || 'Other advertising')
    r.spend += e.amount
    tag(r, 'expense')
  }
  return [...map.values()].map(r => ({
    ...r,
    spend: round2(r.spend),
    attributedRevenue: round2(r.attributedRevenue),
    ctrPct: pct(r.clicks, r.impressions),
    cpc: r.clicks > 0 ? round2(r.spend / r.clicks) : null,
    roas: r.spend > 0 ? round2(r.attributedRevenue / r.spend) : null,
  })).sort((a, b) => b.spend - a.spend)
}

// ---------------------------------------------------------------------------
// Waterfall and goal
// ---------------------------------------------------------------------------

export interface WaterfallStep { key: string; label: string; amount: number; kind: 'start' | 'cost' | 'end' }

/** Where each dollar of net revenue went, in statement order. Zero steps are dropped. */
export function waterfallSteps(t: PnlTotals): WaterfallStep[] {
  const steps: WaterfallStep[] = [{ key: 'netRevenue', label: 'Net revenue', amount: t.netRevenue, kind: 'start' }]
  const costs: Array<[string, string, number]> = [
    ['productCost', 'Product cost', t.productCost],
    ['fulfillment', 'Shipping', t.fulfillment],
    ['paymentFees', 'Payment fees', t.paymentFees],
    ['adSpend', 'Ad spend', t.adSpend],
    ['aiSpend', 'AI & API', t.aiSpend],
    ['fixedCosts', 'Software', t.fixedCosts],
    ['otherExpenses', 'Other expenses', t.otherExpenses],
  ]
  for (const [key, label, amount] of costs) if (amount > 0) steps.push({ key, label, amount, kind: 'cost' })
  steps.push({ key: 'netProfit', label: 'Net profit', amount: t.netProfit, kind: 'end' })
  return steps
}

export interface GoalStatus {
  month: string
  daysElapsed: number
  daysInMonth: number
  netProfitMtd: number
  projected: number
  goal: number
  /** 0..1 of goal reached so far. */
  progress: number
}

export function goalStatus(input: PnlInputs, today: string, goal = MONTHLY_PROFIT_GOAL_USD): GoalStatus {
  const ms = monthStart(today)
  const from = ms < PNL_EPOCH ? PNL_EPOCH : ms
  const t = totalsFor(input, from, today)
  const elapsed = daysBetween(from, today)
  const dim = daysInMonth(today)
  const span = daysBetween(from, addDays(ms, dim - 1))
  const projected = round2((t.netProfit / elapsed) * span)
  return {
    month: today.slice(0, 7), daysElapsed: elapsed, daysInMonth: dim,
    netProfitMtd: t.netProfit, projected, goal,
    progress: goal > 0 ? Math.max(0, Math.min(1, t.netProfit / goal)) : 0,
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  // Neutralize spreadsheet formula injection from product titles.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function ordersCsv(orders: readonly PnlOrderFact[], handlingPerOrder: number | null): string {
  return toCsv(
    ['order', 'date', 'channel', 'source', 'customer', 'status', 'units', 'gross_sales', 'discounts', 'returns', 'shipping', 'net_revenue', 'tax', 'product_cost', 'cogs_missing_units', 'payment_fees', 'shipping_method', 'shipping_cost', 'handling', 'gross_profit'],
    orders.map(o => {
      const handling = handlingFor(o, handlingPerOrder)
      return [o.name, o.day, o.channel, o.source, o.customerType, o.status, o.units, o.grossSales, o.discounts, o.returns, o.shipping,
        o.netRevenue, o.tax, o.cogs, o.cogsMissingUnits, o.paymentFees, NALPAC_SHIPPING_RATES[o.shippingTier].label, o.shippingCost, handling,
        round2(o.netRevenue - o.cogs - o.paymentFees - o.shippingCost - handling)]
    }),
  )
}

export function statementCsv(columns: ReadonlyArray<{ label: string; totals: PnlTotals }>): string {
  // One row per statement line, one column per window. Row keys come from the union across columns.
  const perCol = columns.map(c => statementRows(c.totals))
  const order: Array<{ key: string; label: string; isCost: boolean }> = []
  const seen = new Set<string>()
  for (const rows of perCol) for (const r of rows) {
    if (r.kind === 'header' || seen.has(r.key)) continue
    seen.add(r.key); order.push({ key: r.key, label: r.label, isCost: r.isCost })
  }
  return toCsv(
    ['line', ...columns.map(c => c.label)],
    order.map(o => [o.label, ...perCol.map(rows => {
      const r = rows.find(x => x.key === o.key)
      if (!r || r.value == null) return ''
      return o.isCost ? -r.value : r.value
    })]),
  )
}
