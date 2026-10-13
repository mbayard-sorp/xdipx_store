/**
 * Nalpac invoices, the pure half: parse Nalpac's order-history CSV export and
 * apply what Nalpac actually billed to a P&L order. Client-safe (no database,
 * no Shopify), so the tests and the dashboard share one definition.
 *
 * WHAT AN INVOICE CONTAINS
 *
 *   Invoice Total = item cost + NALPAC_DROPSHIP_FEE + Freight Total
 *
 * Checked against Shopify's inventory unit cost on #1002, #1009, #1012, #1017,
 * #1022, #1027, #1029 and #1030 (2026-10-13): every one leaves exactly $2.50
 * after freight and item cost. The fee lands on the P&L's handling line, the
 * freight on Shipping (Nalpac), and the remainder on product cost.
 */
import { round2, type PnlOrderFact } from '~/lib/pnl-core'

/** Nalpac's flat per-invoice drop-ship fee, folded into each invoice total. */
export const NALPAC_DROPSHIP_FEE = 2.5

/** One invoice row as stored. Amounts in dollars, dates ISO (YYYY-MM-DD) or null. */
export interface NalpacInvoice {
  invoiceNo: string
  orderName: string
  poNo: string
  nalpacOrderNo: string | null
  pickTicketNo: string | null
  orderDate: string | null
  dueDate: string | null
  paidDate: string | null
  shipDate: string | null
  status: string | null
  freight: number
  invoiceTotal: number
  carrier: string | null
  trackingNumber: string | null
}

export interface ParsedInvoiceFile {
  invoices: NalpacInvoice[]
  /** Rows that could not be used, with the reason, in file order. */
  skipped: Array<{ row: number; invoiceNo: string | null; reason: string }>
  /** Invoice numbers that appeared more than once in the file (the last copy wins). */
  duplicatesInFile: number
}

export class NalpacCsvError extends Error {}

/** RFC 4180 CSV: quoted fields, doubled quotes inside them, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(f => f.trim() !== '')) rows.push(row)
  return rows
}

/** 'shopify-XDIP-oid-1030' to '#1030'. Null when the PO is not a Shopify order. */
export function orderNameFromPo(po: string): string | null {
  const m = /(?:oid-|^#?)(\d{4,})\s*$/i.exec(po.trim())
  return m ? `#${m[1]}` : null
}

/** Nalpac's MM-DD-YYYY to ISO. Blank is null; anything else unreadable is an error. */
function isoDate(raw: string): string | null | undefined {
  const s = raw.trim()
  if (!s) return null
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)
  if (!m) return undefined
  const [, mm, dd, yyyy] = m
  const iso = `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso
}

function money(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return round2(Number(s))
}

const REQUIRED = ['Invoice No', 'PO No', 'Freight Total', 'Invoice Total'] as const

/**
 * Nalpac's export to invoice rows. Columns are found by header name, so a
 * reordered export still reads. Only the four REQUIRED columns must exist.
 */
export function parseNalpacInvoiceCsv(text: string): ParsedInvoiceFile {
  const rows = parseCsv(text)
  if (rows.length === 0) throw new NalpacCsvError('That file is empty.')
  const header = rows[0]!.map(h => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name.toLowerCase())
  const missing = REQUIRED.filter(r => col(r) < 0)
  if (missing.length > 0) {
    throw new NalpacCsvError(`That does not look like Nalpac's order export. Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`)
  }
  const get = (r: string[], name: string) => {
    const i = col(name)
    return i < 0 ? '' : (r[i] ?? '').trim()
  }
  const opt = (r: string[], name: string, max: number) => get(r, name).slice(0, max) || null

  const byNo = new Map<string, NalpacInvoice>()
  const skipped: ParsedInvoiceFile['skipped'] = []
  let duplicatesInFile = 0

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2
    const invoiceNo = get(r, 'Invoice No')
    if (!invoiceNo) { skipped.push({ row: rowNo, invoiceNo: null, reason: 'no invoice number' }); return }
    if (invoiceNo.length > 20) { skipped.push({ row: rowNo, invoiceNo: invoiceNo.slice(0, 20), reason: 'invoice number is too long' }); return }
    const poNo = get(r, 'PO No')
    const orderName = orderNameFromPo(poNo)
    if (!orderName) { skipped.push({ row: rowNo, invoiceNo, reason: poNo ? `PO "${poNo}" is not a Shopify order` : 'no PO number' }); return }
    const freight = money(get(r, 'Freight Total'))
    const invoiceTotal = money(get(r, 'Invoice Total'))
    if (freight === null || invoiceTotal === null) { skipped.push({ row: rowNo, invoiceNo, reason: 'freight or invoice total is not a number' }); return }

    const dates = {
      orderDate: isoDate(get(r, 'Order Date')), dueDate: isoDate(get(r, 'Due Date')),
      paidDate: isoDate(get(r, 'Paid Date')), shipDate: isoDate(get(r, 'Ship Date')),
    }
    if (Object.values(dates).some(d => d === undefined)) { skipped.push({ row: rowNo, invoiceNo, reason: 'a date is not MM-DD-YYYY' }); return }

    if (byNo.has(invoiceNo)) duplicatesInFile++
    byNo.set(invoiceNo, {
      invoiceNo, orderName, poNo: poNo.slice(0, 60),
      nalpacOrderNo: opt(r, 'Order No', 20), pickTicketNo: opt(r, 'Pick Ticket No', 20),
      orderDate: dates.orderDate ?? null, dueDate: dates.dueDate ?? null, paidDate: dates.paidDate ?? null, shipDate: dates.shipDate ?? null,
      status: opt(r, 'Status', 30), freight, invoiceTotal,
      carrier: opt(r, 'Carrier', 60), trackingNumber: opt(r, 'Tracking Number', 60),
    })
  })

  return { invoices: [...byNo.values()], skipped, duplicatesInFile }
}

/** Fields that decide whether a re-uploaded invoice changed. */
export function invoiceChanged(a: NalpacInvoice, b: NalpacInvoice): boolean {
  const keys: Array<keyof NalpacInvoice> = [
    'orderName', 'poNo', 'nalpacOrderNo', 'pickTicketNo', 'orderDate', 'dueDate', 'paidDate', 'shipDate',
    'status', 'freight', 'invoiceTotal', 'carrier', 'trackingNumber',
  ]
  return keys.some(k => (a[k] ?? null) !== (b[k] ?? null))
}

/**
 * Replace an order's estimated costs with what Nalpac billed. Several invoices
 * for one order (a split shipment) add up, each carrying its own fee. Line
 * costs are rescaled to the invoiced product cost so the product breakdown
 * foots with the statement; a fully refunded order that still shipped keeps
 * its cost at the order level, since no line has units left to carry it.
 */
export function applyNalpacInvoices(fact: PnlOrderFact, invoices: readonly NalpacInvoice[]): PnlOrderFact {
  if (invoices.length === 0) return fact
  const total = invoices.reduce((s, i) => s + i.invoiceTotal, 0)
  const freight = invoices.reduce((s, i) => s + i.freight, 0)
  const handling = NALPAC_DROPSHIP_FEE * invoices.filter(i => i.invoiceTotal > 0).length
  const productCost = round2(Math.max(0, total - freight - handling))

  const live = fact.lines.filter(l => l.units > 0)
  const known = live.reduce((s, l) => s + (l.cogs ?? 0), 0)
  const weight = (l: PnlOrderFact['lines'][number]) => (l.units <= 0 ? 0 : known > 0 ? (l.cogs ?? 0) : l.units)
  const totalWeight = fact.lines.reduce((s, l) => s + weight(l), 0)
  const lines = totalWeight > 0
    ? fact.lines.map(l => ({ ...l, cogs: round2(productCost * (weight(l) / totalWeight)) }))
    : fact.lines

  return {
    ...fact,
    cogs: productCost,
    cogsMissingUnits: 0,
    shippingCost: round2(freight),
    lines,
    invoice: {
      invoiceNos: invoices.map(i => i.invoiceNo),
      total: round2(total),
      freight: round2(freight),
      handling: round2(handling),
      carrier: invoices.map(i => i.carrier).find(Boolean) ?? null,
    },
  }
}
