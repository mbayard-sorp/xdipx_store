// Nalpac invoice upload, the pure layer. The CSV rows are real lines from the
// owner's 2026-10-13 export (ship-to names replaced), and the fixtures mirror
// the orders they bill, so the split into product / fee / freight is proven
// against numbers Nalpac actually sent.
import { describe, expect, it } from 'vitest'
import {
  NALPAC_DROPSHIP_FEE, NalpacCsvError, applyNalpacInvoices, invoiceChanged, orderNameFromPo, parseCsv, parseNalpacInvoiceCsv,
} from '~/lib/nalpac-invoices'
import { orderToFact, ordersCsv, statementRows, totalsFor, type CostLineFn, type PnlInputs, type ShopifyPnlOrder } from '~/lib/pnl-core'

const HEADER = 'Invoice No,Order No,Ship Name,Pick Ticket No,Order Date,Due Date,Paid Date,Status,PO No,Freight Total,Invoice Total,Tracking Number,Carrier,Ship Date'
const R1030 = '"7350007","3368234","A Customer","2767337","10-11-2026","10-13-2026","10-12-2026",,"shopify-XDIP-oid-1030","7.54","14.18","9200190350833201230645","USPS Ground Advantage","10-12-2026"'
const R1012 = '"7347827","3365770","B Customer","2764955","10-06-2026","10-08-2026","10-07-2026",,"shopify-XDIP-oid-1012","27.75","157.78","878307930488","FedEx OneRate","10-07-2026"'
const R1022 = '"7349460","3367079","C Customer","2766578","10-08-2026","10-12-2026","10-12-2026",,"shopify-XDIP-oid-1022","7.21","15.17","9200190350833201228147","USPS Ground Advantage","10-11-2026"'
const csv = (...rows: string[]) => [HEADER, ...rows, ''].join('\r\n')

const TZ = 'America/Phoenix'
const m = (n: number | string) => ({ shopMoney: { amount: String(n) } })
const costLine: CostLineFn = (line) => {
  const unit = Number(line.variant?.inventoryItem?.unitCost?.amount)
  return Number.isFinite(unit) && unit > 0 ? { cost: unit * line.quantity } : { cost: null }
}
const line = (title: string, qty: number, total: number, unitCost: number | null, cur = qty) => ({
  title, sku: title.slice(0, 5), quantity: qty, currentQuantity: cur, originalTotalSet: m(total),
  product: { handle: title.toLowerCase(), productType: 'Vibrator' },
  variant: { inventoryItem: { unitCost: unitCost == null ? null : { amount: String(unitCost) } } },
})
function order(p: Partial<ShopifyPnlOrder> & { name: string }): ShopifyPnlOrder {
  return {
    id: `gid://shopify/Order/${p.name.replace('#', '')}`, createdAt: '2026-10-08T18:00:00Z', displayFinancialStatus: 'PAID',
    cancelledAt: null, app: { name: 'Storefront Admin' }, customer: null, customerJourneySummary: { customerOrderIndex: 1 },
    totalPriceSet: m(0), totalTaxSet: m(0), totalShippingPriceSet: m(0), totalDiscountsSet: m(0),
    currentTotalPriceSet: m(0), currentTotalTaxSet: m(0), currentSubtotalPriceSet: m(0),
    shippingAddress: { countryCodeV2: 'US', provinceCode: 'AZ' }, shippingLines: { nodes: [{ title: 'Standard' }] },
    metafields: { nodes: [] }, lineItems: { nodes: [] }, transactions: [], ...p,
  }
}
const fact = (o: ShopifyPnlOrder) => orderToFact(o, TZ, costLine, new Map())

// #1012: five items, $127.53 of Shopify unit cost, shipped FedEx.
const f1012 = fact(order({
  name: '#1012', totalPriceSet: m(204.95), currentTotalPriceSet: m(204.95), currentSubtotalPriceSet: m(204.95),
  lineItems: { nodes: [line('Gush', 1, 105.99, 58.5), line('Pump', 1, 12.99, 8.99), line('Plug', 1, 21.99, 14.99), line('Lube', 1, 14.99, 10.55), line('Blanket', 1, 48.99, 34.5)] },
}))
// #1022: refunded in full in Shopify (no units left), but Nalpac shipped one item and billed it.
const f1022 = fact(order({
  name: '#1022', displayFinancialStatus: 'REFUNDED', totalPriceSet: m(22.98),
  lineItems: { nodes: [line('Ring', 1, 9.99, 5.46, 0), line('Gel', 1, 12.99, 7.5, 0)] },
}))
// #1031: not invoiced yet.
const f1031 = fact(order({
  name: '#1031', totalPriceSet: m(19.99), currentTotalPriceSet: m(19.99), currentSubtotalPriceSet: m(19.99),
  lineItems: { nodes: [line('Wand', 1, 19.99, 9.5)] },
}))

describe('parseCsv', () => {
  it('reads quoted fields, empty fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b,c\r\n"1,2",,"say ""hi"""\r\n\r\n')).toEqual([['a', 'b', 'c'], ['1,2', '', 'say "hi"']])
  })
  it('strips a byte-order mark', () => {
    expect(parseCsv('﻿Invoice No\n1')[0]).toEqual(['Invoice No'])
  })
})

describe('orderNameFromPo', () => {
  it('maps the Shopify PO to the order name', () => {
    expect(orderNameFromPo('shopify-XDIP-oid-1030')).toBe('#1030')
    expect(orderNameFromPo('#1044')).toBe('#1044')
    expect(orderNameFromPo('SAMPLES-OCT')).toBeNull()
    expect(orderNameFromPo('')).toBeNull()
  })
})

describe('parseNalpacInvoiceCsv', () => {
  it('reads the real export', () => {
    const p = parseNalpacInvoiceCsv(csv(R1030, R1012))
    expect(p.skipped).toEqual([])
    expect(p.invoices).toHaveLength(2)
    expect(p.invoices[0]).toEqual({
      invoiceNo: '7350007', orderName: '#1030', poNo: 'shopify-XDIP-oid-1030', nalpacOrderNo: '3368234', pickTicketNo: '2767337',
      orderDate: '2026-10-11', dueDate: '2026-10-13', paidDate: '2026-10-12', shipDate: '2026-10-12', status: null,
      freight: 7.54, invoiceTotal: 14.18, carrier: 'USPS Ground Advantage', trackingNumber: '9200190350833201230645',
    })
  })

  it('never stores the ship-to name', () => {
    const p = parseNalpacInvoiceCsv(csv(R1030))
    expect(JSON.stringify(p)).not.toContain('A Customer')
  })

  it('keeps one copy of an invoice that appears twice and counts it', () => {
    const changed = R1030.replace('"10-12-2026",,', '"10-14-2026",,')
    const p = parseNalpacInvoiceCsv(csv(R1030, changed))
    expect(p.invoices).toHaveLength(1)
    expect(p.invoices[0]!.paidDate).toBe('2026-10-14')
    expect(p.duplicatesInFile).toBe(1)
  })

  it('skips rows it cannot use, with the reason', () => {
    const sample = R1030.replace('7350007', '7350008').replace('shopify-XDIP-oid-1030', 'SAMPLES')
    const badMoney = R1030.replace('7350007', '7350009').replace('"7.54"', '"n/a"')
    const badDate = R1030.replace('7350007', '7350010').replace('"10-11-2026"', '"2026-10-11"')
    const p = parseNalpacInvoiceCsv(csv(R1030, sample, badMoney, badDate))
    expect(p.invoices.map(i => i.invoiceNo)).toEqual(['7350007'])
    expect(p.skipped.map(s => [s.row, s.invoiceNo])).toEqual([[3, '7350008'], [4, '7350009'], [5, '7350010']])
    expect(p.skipped[0]!.reason).toContain('not a Shopify order')
  })

  it('finds columns by name, so a reordered export still reads', () => {
    const p = parseNalpacInvoiceCsv('Invoice Total,PO No,Invoice No,Freight Total\n"14.18","shopify-XDIP-oid-1030","7350007","7.54"\n')
    expect(p.invoices[0]).toMatchObject({ invoiceNo: '7350007', orderName: '#1030', freight: 7.54, invoiceTotal: 14.18, orderDate: null })
  })

  it('rejects a file that is not the Nalpac export', () => {
    expect(() => parseNalpacInvoiceCsv('order,date,total\n#1030,2026-10-11,14.18\n')).toThrow(NalpacCsvError)
    expect(() => parseNalpacInvoiceCsv('')).toThrow(NalpacCsvError)
  })
})

describe('invoiceChanged', () => {
  it('is false for the same row re-uploaded, true when Nalpac filled something in', () => {
    const [a] = parseNalpacInvoiceCsv(csv(R1030)).invoices
    const [b] = parseNalpacInvoiceCsv(csv(R1030)).invoices
    const [c] = parseNalpacInvoiceCsv(csv(R1030.replace('"7.54"', '"7.64"'))).invoices
    expect(invoiceChanged(a!, b!)).toBe(false)
    expect(invoiceChanged(a!, c!)).toBe(true)
  })
})

describe('applyNalpacInvoices', () => {
  const inv = (row: string) => parseNalpacInvoiceCsv(csv(row)).invoices

  it('splits the invoice into product cost, the drop-ship fee and freight', () => {
    const f = applyNalpacInvoices(f1012, inv(R1012))
    expect(f.shippingCost).toBe(27.75)
    expect(f.invoice?.handling).toBe(NALPAC_DROPSHIP_FEE)
    // 157.78 - 27.75 - 2.50: exactly Shopify's $127.53 unit cost, which is how the fee was found.
    expect(f.cogs).toBe(127.53)
    expect(f.cogs + f.shippingCost + f.invoice!.handling).toBeCloseTo(157.78, 2)
    expect(f.lines.reduce((s, l) => s + (l.cogs ?? 0), 0)).toBeCloseTo(127.53, 2)
  })

  it('costs a refunded order that still shipped, which estimates miss', () => {
    expect(f1022.cogs).toBe(0)
    expect(f1022.shippingCost).toBe(0)
    const f = applyNalpacInvoices(f1022, inv(R1022))
    expect(f.cogs).toBe(5.46)
    expect(f.shippingCost).toBe(7.21)
  })

  it('adds up a split shipment, one fee per invoice', () => {
    const [a] = inv(R1012)
    const b = { ...a!, invoiceNo: '7347999', freight: 6.5, invoiceTotal: 20 }
    const f = applyNalpacInvoices(f1012, [a!, b])
    expect(f.shippingCost).toBe(34.25)
    expect(f.invoice?.handling).toBe(5)
    expect(f.cogs).toBe(round(157.78 + 20 - 34.25 - 5))
  })

  it('leaves an order with no invoice as it was', () => {
    expect(applyNalpacInvoices(f1031, [])).toBe(f1031)
  })
})

describe('totals with invoices', () => {
  const base: Omit<PnlInputs, 'orders'> = { ads: [], manualAds: [], ai: [], fixed: [], expenses: [], handlingFeePerOrder: 2 }
  const orders = [
    applyNalpacInvoices(f1012, parseNalpacInvoiceCsv(csv(R1012)).invoices),
    f1031,
  ]

  it('uses the invoiced fee instead of the handling setting, so nothing counts twice', () => {
    const t = totalsFor({ ...base, orders }, '2026-10-01', '2026-10-31')
    expect(t.invoicedOrders).toBe(1)
    expect(t.handling).toBe(4.5) // $2.50 invoiced on #1012 + the $2 setting on #1031
    expect(t.shippingCost).toBe(34.25) // 27.75 invoiced + 6.50 estimated
    expect(t.productCost).toBe(137.03) // 127.53 invoiced + 9.50 on file
  })

  it('says on the statement which costs are actual', () => {
    const t = totalsFor({ ...base, orders }, '2026-10-01', '2026-10-31')
    const ship = statementRows(t).find(r => r.key === 'shippingCost')
    expect(ship?.hint).toBe('Nalpac invoiced freight for 1 of 2 orders, average rate for the shipping method for the rest')
  })

  it('labels invoiced orders in the CSV export', () => {
    const out = ordersCsv(orders, 2)
    expect(out).toContain('Nalpac invoice (FedEx OneRate)')
    expect(out).toContain('Standard US')
  })
})

function round(n: number): number { return Math.round(n * 100) / 100 }
