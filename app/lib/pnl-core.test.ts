// The P&L engine's pure layer. Fixtures mirror real orders' shapes (#1002's
// edit, #1012's free shipping, #1017's full refund, #1011's failed charge), so
// the statement is proven to foot against what Shopify actually sends.
import { describe, expect, it } from 'vitest'
import {
  PNL_EPOCH, adPlatformRows, bucketOf, dayInTz, fixedCostForDay, goalStatus, monthlyColumns, orderBreakdown,
  orderToFact, ordersCsv, productBreakdown, ratiosFor, resolveRange, seriesFor, statementCsv, statementRows,
  totalsFor, waterfallSteps, type CostLineFn, type PnlInputs, type ShopifyPnlOrder,
} from '~/lib/pnl-core'

const TZ = 'America/Phoenix'
const m = (n: number | string) => ({ shopMoney: { amount: String(n) } })

/** Cost from the inventory item only; good enough to test the plumbing. */
const costLine: CostLineFn = (line) => {
  const unit = Number(line.variant?.inventoryItem?.unitCost?.amount)
  return Number.isFinite(unit) && unit > 0 ? { cost: unit * line.quantity } : { cost: null }
}

function order(p: Partial<ShopifyPnlOrder> & { name: string }): ShopifyPnlOrder {
  return {
    id: `gid://shopify/Order/${p.name.replace('#', '')}`,
    createdAt: '2026-10-04T18:00:00Z',
    displayFinancialStatus: 'PAID',
    cancelledAt: null,
    app: { name: 'Storefront Admin' },
    customer: { id: 'gid://shopify/Customer/1' },
    customerJourneySummary: { customerOrderIndex: 1 },
    totalPriceSet: m(0), totalTaxSet: m(0), totalShippingPriceSet: m(0), totalDiscountsSet: m(0),
    currentTotalPriceSet: m(0), currentTotalTaxSet: m(0), currentSubtotalPriceSet: m(0),
    metafields: { nodes: [] },
    lineItems: { nodes: [] },
    transactions: [],
    ...p,
  }
}

const line = (title: string, qty: number, total: number, unitCost: number | null, cur = qty, type = 'Vibrator') => ({
  title, sku: title.slice(0, 5), quantity: qty, currentQuantity: cur, originalTotalSet: m(total),
  product: { handle: title.toLowerCase().replace(/\s+/g, '-'), productType: type },
  variant: { inventoryItem: { unitCost: unitCost == null ? null : { amount: String(unitCost) } } },
})

// #1012: $204.95 of product, shipping $14.99 discounted to zero.
const o1012 = order({
  name: '#1012', createdAt: '2026-10-04T14:31:00Z',
  totalPriceSet: m(204.95), totalTaxSet: m(0), totalShippingPriceSet: m(14.99), totalDiscountsSet: m(14.99),
  currentTotalPriceSet: m(204.95), currentTotalTaxSet: m(0), currentSubtotalPriceSet: m(204.95),
  lineItems: { nodes: [line('Gush', 1, 105.99, 58.5), line('Blanket', 1, 98.96, 34.5, 1, 'Adult Game')] },
  transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(204.95), fees: [{ amount: { amount: '7.47' } }] }],
})

// #1002: big discount, then one $9.99 line removed by an order edit.
const o1002 = order({
  name: '#1002', createdAt: '2026-07-23T21:10:00Z',
  totalPriceSet: m(29.18), totalTaxSet: m(1.44), totalShippingPriceSet: m(9.99), totalDiscountsSet: m(53.22),
  currentTotalPriceSet: m(26.47), currentTotalTaxSet: m(1.23), currentSubtotalPriceSet: m(15.25),
  lineItems: { nodes: [line('Ring', 1, 47.99, 26.95), line('Lube A', 1, 9.99, 6.6, 0), line('Lube B', 1, 12.99, 8.86)] },
  transactions: [
    { kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(25.67), fees: [{ amount: { amount: '1.04' } }] },
    { kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(0.8), fees: [{ amount: { amount: '0.32' } }] },
  ],
})

// #1017: a draft-order replacement. Goods free, shipping charged then refunded.
const o1017 = order({
  name: '#1017', createdAt: '2026-10-06T04:56:00Z', displayFinancialStatus: 'REFUNDED', app: { name: 'Draft Orders' },
  totalPriceSet: m(9.99), totalTaxSet: m(0), totalShippingPriceSet: m(9.99), totalDiscountsSet: m(40.98),
  currentTotalPriceSet: m(0), currentTotalTaxSet: m(0), currentSubtotalPriceSet: m(0),
  lineItems: { nodes: [line('Basque', 1, 33.99, 18.95, 1, 'Lingerie Set'), line('Panty', 1, 6.99, 3.95, 1, 'Panty')] },
  transactions: [
    { kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(9.99), fees: [{ amount: { amount: '0.59' } }] },
    { kind: 'REFUND', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(9.99), fees: [] },
  ],
})

// #1011: first card charge failed, Shop Cash covered $4.
const o1011 = order({
  name: '#1011', createdAt: '2026-10-04T03:20:00Z', app: { name: 'Shop' },
  totalPriceSet: m(29.14), totalTaxSet: m(2.16), totalShippingPriceSet: m(9.99), totalDiscountsSet: m(0),
  currentTotalPriceSet: m(29.14), currentTotalTaxSet: m(2.16), currentSubtotalPriceSet: m(16.99),
  lineItems: { nodes: [line('Wand', 1, 16.99, 12)] },
  transactions: [
    { kind: 'AUTHORIZATION', status: 'SUCCESS', gateway: 'shop_cash', amountSet: m(4), fees: [] },
    { kind: 'SALE', status: 'FAILURE', gateway: 'shopify_payments', amountSet: m(25.14), fees: [{ amount: { amount: '1.03' } }] },
    { kind: 'VOID', status: 'SUCCESS', gateway: 'shop_cash', amountSet: m(4), fees: [] },
    { kind: 'AUTHORIZATION', status: 'SUCCESS', gateway: 'shop_cash', amountSet: m(4), fees: [] },
    { kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', amountSet: m(25.14), fees: [{ amount: { amount: '1.03' } }] },
    { kind: 'CAPTURE', status: 'SUCCESS', gateway: 'shop_cash', amountSet: m(4), fees: [] },
  ],
})

const fact = (o: ShopifyPnlOrder) => orderToFact(o, TZ, costLine, new Map())

describe('orderToFact', () => {
  it('foots: gross - discounts - returns + shipping = net revenue', () => {
    for (const o of [o1012, o1002, o1017, o1011]) {
      const f = fact(o)
      expect(f.grossSales - f.discounts - f.returns + f.shipping).toBeCloseTo(f.netRevenue, 2)
    }
  })

  it('treats a discounted shipping line as a discount, not lost revenue', () => {
    const f = fact(o1012)
    expect(f.grossSales).toBe(204.95)
    expect(f.discounts).toBe(14.99)
    expect(f.shipping).toBe(14.99)
    expect(f.netRevenue).toBe(204.95)
    expect(f.paymentFees).toBe(7.47)
    expect(f.cogs).toBe(93)
  })

  it('reads an order edit as a return and does not cost the removed line', () => {
    const f = fact(o1002)
    expect(f.netRevenue).toBe(25.24) // 26.47 current total less 1.23 current tax
    expect(f.returns).toBe(2.5)
    expect(f.units).toBe(2)
    expect(f.cogs).toBe(35.81) // 26.95 + 8.86, the edited-out lube is not charged
    expect(f.paymentFees).toBe(1.36) // both split-tender fees
    expect(f.day).toBe('2026-07-23')
  })

  it('keeps a fully refunded replacement order: zero revenue, real goods cost, real fee', () => {
    const f = fact(o1017)
    expect(f.netRevenue).toBe(0)
    expect(f.returns).toBe(9.99)
    expect(f.cogs).toBe(22.9)
    expect(f.paymentFees).toBe(0.59)
    expect(f.channel).toBe('Draft Orders')
  })

  it('charges only successful fees and records Shop Cash as a tender', () => {
    const f = fact(o1011)
    expect(f.paymentFees).toBe(1.03)
    expect(f.shopCash).toBe(4)
    expect(f.channel).toBe('Shop app')
    expect(f.tax).toBe(2.16)
  })

  it('allocates net product revenue across lines by list value', () => {
    const f = fact(o1012)
    const sum = f.lines.reduce((s, l) => s + l.revenue, 0)
    expect(sum).toBeCloseTo(204.95, 1)
    expect(f.lines[0]!.revenue).toBeGreaterThan(f.lines[1]!.revenue)
  })

  it('counts units with no cost instead of pricing them at zero', () => {
    const f = fact(order({
      name: '#2000', totalPriceSet: m(20), currentTotalPriceSet: m(20), currentSubtotalPriceSet: m(20),
      lineItems: { nodes: [line('Mystery', 2, 20, null)] },
    }))
    expect(f.cogs).toBe(0)
    expect(f.cogsMissingUnits).toBe(2)
    expect(f.lines[0]!.cogs).toBeNull()
  })

  it('buckets by the store day, not the UTC day', () => {
    // 03:20 UTC on Oct 4 is 20:20 on Oct 3 in Phoenix.
    expect(fact(o1011).day).toBe('2026-10-03')
    expect(dayInTz('2026-10-04T06:59:00Z', TZ)).toBe('2026-10-03')
    expect(dayInTz('2026-10-04T07:00:00Z', TZ)).toBe('2026-10-04')
  })

  it('labels returning customers from the journey index', () => {
    expect(fact(order({ name: '#1', customerJourneySummary: { customerOrderIndex: 3 } })).customerType).toBe('returning')
    expect(fact(order({ name: '#2', customerJourneySummary: null })).customerType).toBe('unknown')
  })
})

describe('resolveRange', () => {
  const today = '2026-10-08'

  it('never starts before the first sale', () => {
    const r = resolveRange({ range: 'ytd' }, today)
    expect(r.from).toBe(PNL_EPOCH)
    expect(r.prev).toBeNull()
    expect(resolveRange({ range: 'custom', from: '2026-01-01', to: '2026-08-01' }, today).from).toBe(PNL_EPOCH)
  })

  it('compares against the equal window just before, clamped and flagged when short', () => {
    const r = resolveRange({ range: '30d' }, today)
    expect(r.from).toBe('2026-09-09')
    expect(r.days).toBe(30)
    expect(r.prev).toEqual({ from: '2026-08-10', to: '2026-09-08', partial: false })
    const r90 = resolveRange({ range: '90d' }, today)
    expect(r90.from).toBe(PNL_EPOCH)
    expect(r90.prev).toBeNull()
    const lm = resolveRange({ range: 'lastmonth' }, today)
    expect([lm.from, lm.to]).toEqual(['2026-09-01', '2026-09-30'])
    expect(lm.prev).toEqual({ from: '2026-08-01', to: '2026-08-31', partial: false })
    expect(resolveRange({ range: 'mtd' }, today).prev).toEqual({ from: '2026-09-01', to: '2026-09-08', partial: false })
    expect(resolveRange({ range: 'mtd' }, '2026-10-31').prev).toEqual({ from: '2026-09-01', to: '2026-09-30', partial: false })
    // August's prior month is only the nine July days after the first sale.
    expect(resolveRange({ range: 'lastmonth' }, '2026-09-15').prev).toEqual({ from: PNL_EPOCH, to: '2026-07-31', partial: true })
  })

  it('handles the calendar presets, swapped custom dates and junk', () => {
    expect(resolveRange({ range: 'mtd' }, today).from).toBe('2026-10-01')
    expect(resolveRange({ range: 'qtd' }, today).from).toBe('2026-10-01')
    expect(resolveRange({ range: 'today' }, today)).toMatchObject({ from: today, to: today, days: 1, granularity: 'day' })
    expect(resolveRange({ range: 'custom', from: '2026-10-05', to: '2026-09-01' }, today)).toMatchObject({ from: '2026-09-01', to: '2026-10-05' })
    expect(resolveRange({ range: 'custom', from: 'nope', to: '2026-10-01' }, today).preset).toBe('30d')
    expect(resolveRange({ range: 'bogus' }, today).preset).toBe('30d')
    expect(resolveRange({ range: 'custom', from: '2026-09-01', to: '2027-01-01' }, today).to).toBe(today)
  })

  it('picks a granularity that keeps the chart readable', () => {
    expect(resolveRange({ range: '30d' }, today).granularity).toBe('day')
    expect(resolveRange({ range: 'all' }, '2026-12-31').granularity).toBe('week')
    expect(resolveRange({ range: 'all' }, '2027-06-30').granularity).toBe('month')
    expect(bucketOf('2026-10-08', 'week')).toBe('2026-10-05') // Monday
    expect(bucketOf('2026-10-08', 'month')).toBe('2026-10')
  })
})

describe('totals and the statement', () => {
  const orders = [o1012, o1002, o1017, o1011].map(fact)
  const base: PnlInputs = {
    orders,
    ads: [
      { day: '2026-10-04', platform: 'google', spend: 30, impressions: 1000, clicks: 40, orders: 1, attributedRevenue: 60 },
      { day: '2026-10-05', platform: 'shop', spend: 12.5, impressions: 0, clicks: 0, orders: 0, attributedRevenue: 0 },
    ],
    ai: [{ day: '2026-10-04', amount: 2.25 }],
    fixed: [{ id: 1, vendor: 'Vercel', note: null, monthlyUsd: 31, effectiveFrom: '2026-10-01', effectiveTo: null }],
    expenses: [
      { id: 1, day: '2026-10-05', category: 'advertising', vendor: 'Newsletter X', amount: 50, note: null },
      { id: 2, day: '2026-10-05', category: 'contractors', vendor: 'Editor', amount: 20, note: null },
      { id: 3, day: '2026-10-06', category: 'fulfillment', vendor: 'Nalpac', amount: 5, note: null },
      { id: 4, day: '2026-09-01', category: 'other', vendor: 'Outside window', amount: 999, note: null },
    ],
    fulfillmentPerOrder: 8,
  }

  it('builds every subtotal from the lines above it', () => {
    const t = totalsFor(base, '2026-10-01', '2026-10-08')
    expect(t.orders).toBe(3) // #1002 is in July
    expect(t.netRevenue).toBeCloseTo(204.95 + 0 + 26.98, 2)
    expect(t.fulfillment).toBe(8 * 3 + 5)
    expect(t.adSpend).toBe(30 + 12.5 + 50)
    expect(t.adByPlatform).toEqual({ 'Google Ads': 30, 'Shop Campaigns': 12.5, 'Newsletter X': 50 })
    expect(t.fixedCosts).toBeCloseTo(8, 2) // $31 over 31 days, 8 of them
    expect(t.otherByCategory).toEqual({ 'Contractors & services': 20 })
    expect(t.grossProfit).toBeCloseTo(t.netRevenue - t.productCost - t.fulfillment - t.paymentFees, 2)
    expect(t.contribution).toBeCloseTo(t.grossProfit - t.adSpend, 2)
    expect(t.netProfit).toBeCloseTo(t.contribution - t.aiSpend - t.fixedCosts - t.otherExpenses, 2)
  })

  it('leaves fulfillment out, not at zero, when the per-order cost is unknown', () => {
    const t = totalsFor({ ...base, fulfillmentPerOrder: null, expenses: [] }, '2026-10-01', '2026-10-08')
    expect(t.fulfillment).toBe(0)
    const row = statementRows(t, { fulfillmentSet: false }).find(r => r.key === 'fulfillment')!
    expect(row.value).toBeNull()
    expect(row.hint).toMatch(/not set/)
  })

  it('spreads a fixed cost so a whole month sums to the monthly figure', () => {
    const row = { id: 1, vendor: 'Neon', note: null, monthlyUsd: 19, effectiveFrom: '2026-09-15', effectiveTo: '2026-10-16' }
    let sept = 0
    for (let d = 1; d <= 30; d++) sept += fixedCostForDay(row, `2026-09-${String(d).padStart(2, '0')}`)
    expect(sept).toBeCloseTo(19 * 16 / 30, 6)
    expect(fixedCostForDay(row, '2026-10-16')).toBe(0)
    const full = monthlyColumns({ ...base, orders: [], ads: [], ai: [], expenses: [], fixed: [{ ...row, effectiveFrom: '2026-01-01', effectiveTo: null }] }, '2026-08-01', '2026-09-30')
    expect(full.map(c => c.totals.fixedCosts)).toEqual([19, 19])
  })

  it('orders the statement and drops empty dynamic lines', () => {
    const rows = statementRows(totalsFor(base, '2026-10-01', '2026-10-08'), { fulfillmentSet: true })
    const keys = rows.map(r => r.key)
    expect(keys.indexOf('netRevenue')).toBeLessThan(keys.indexOf('grossProfit'))
    expect(keys.indexOf('grossProfit')).toBeLessThan(keys.indexOf('contribution'))
    expect(keys.at(-2)).toBe('tax')
    expect(keys).toContain('netProfit')
    expect(keys).toContain('shopCash')
    expect(keys).not.toContain('ads-none')
  })

  it('computes ratios without dividing by zero', () => {
    const r = ratiosFor(totalsFor(base, '2026-10-01', '2026-10-08'))
    expect(r.mer).toBeCloseTo(231.93 / 92.5, 2)
    expect(r.cac).toBeCloseTo(92.5 / 3, 2)
    const empty = ratiosFor(totalsFor(base, '2026-08-01', '2026-08-02'))
    expect(empty).toMatchObject({ aov: null, mer: null, cac: null, netMarginPct: null })
  })

  it('series buckets sum back to the window total', () => {
    const s = seriesFor(base, '2026-10-01', '2026-10-08', 'day')
    expect(s).toHaveLength(8)
    const t = totalsFor(base, '2026-10-01', '2026-10-08')
    expect(s.reduce((a, p) => a + p.netProfit, 0)).toBeCloseTo(t.netProfit, 1)
    expect(s.reduce((a, p) => a + p.orders, 0)).toBe(t.orders)
  })

  it('waterfall starts at net revenue and ends at net profit', () => {
    const t = totalsFor(base, '2026-10-01', '2026-10-08')
    const w = waterfallSteps(t)
    expect(w[0]).toMatchObject({ kind: 'start', amount: t.netRevenue })
    expect(w.at(-1)).toMatchObject({ kind: 'end', amount: t.netProfit })
    const costs = w.filter(x => x.kind === 'cost').reduce((a, x) => a + x.amount, 0)
    expect(t.netRevenue - costs).toBeCloseTo(t.netProfit, 1)
  })

  it('breaks down by product, channel and ad platform', () => {
    const products = productBreakdown(base.orders, '2026-10-01', '2026-10-08', 'product')
    expect(products[0]!.label).toBe('Gush')
    expect(products.reduce((a, r) => a + (r.sharePct ?? 0), 0)).toBeCloseTo(100, 0)
    const channels = orderBreakdown(base.orders, '2026-10-01', '2026-10-08', o => o.channel)
    expect(channels.map(c => c.label)).toEqual(['xdipx.com', 'Shop app', 'Draft Orders'])
    const platforms = adPlatformRows(base.ads, base.expenses, '2026-10-01', '2026-10-08')
    expect(platforms[0]).toMatchObject({ platform: 'Newsletter X', spend: 50 })
    expect(platforms.find(p => p.platform === 'Google Ads')).toMatchObject({ ctrPct: 4, cpc: 0.75, roas: 2 })
  })

  it('projects the month from its pace', () => {
    const g = goalStatus(base, '2026-10-08')
    expect(g.daysElapsed).toBe(8)
    expect(g.projected).toBeCloseTo((g.netProfitMtd / 8) * 31, 1)
  })
})

describe('csv', () => {
  it('neutralizes formula injection and quotes commas', () => {
    const csv = ordersCsv([{ ...fact(o1012), name: '=HYPERLINK("x")', channel: 'a,b' }], 8)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"a,b"')
    expect(csv.split('\n')[0]).toMatch(/^order,date,channel,source/)
  })

  it('writes costs as negatives in the statement export', () => {
    const t = totalsFor({ orders: [fact(o1012)], ads: [], ai: [], fixed: [], expenses: [], fulfillmentPerOrder: null }, '2026-10-01', '2026-10-08')
    const csv = statementCsv([{ label: 'Oct', totals: t }], false)
    expect(csv).toMatch(/Payment processing,-7\.47/)
    expect(csv).toMatch(/Net revenue,204\.95/)
  })
})
