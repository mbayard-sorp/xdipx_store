/**
 * Nalpac invoices, the server half (migration 122): store an uploaded export
 * without duplicating anything, and read invoices back for the P&L.
 *
 * Dedupe is by Nalpac invoice number. Re-uploading an export that overlaps
 * the last one updates any invoice whose fields changed (a paid date filled
 * in, a tracking number added) and leaves the rest untouched.
 */
import { inArray, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { nalpacInvoices } from '../../db/schema'
import { NalpacCsvError, invoiceChanged, parseNalpacInvoiceCsv, type NalpacInvoice, type ParsedInvoiceFile } from '~/lib/nalpac-invoices'

const CHUNK = 200

type Row = typeof nalpacInvoices.$inferSelect

function fromRow(r: Row): NalpacInvoice {
  const d = (v: string | null) => (v ? String(v) : null)
  return {
    invoiceNo: r.invoiceNo, orderName: r.orderName, poNo: r.poNo, nalpacOrderNo: r.nalpacOrderNo, pickTicketNo: r.pickTicketNo,
    orderDate: d(r.orderDate), dueDate: d(r.dueDate), paidDate: d(r.paidDate), shipDate: d(r.shipDate), status: r.status,
    freight: Number(r.freightUsd), invoiceTotal: Number(r.invoiceTotalUsd), carrier: r.carrier, trackingNumber: r.trackingNumber,
  }
}

function chunks<T>(xs: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export interface UpsertResult { added: number; updated: number; unchanged: number }

/** Insert new invoices, update changed ones, skip identical ones. */
export async function upsertNalpacInvoices(parsed: ParsedInvoiceFile, uploadedBy: string | null): Promise<UpsertResult> {
  const existing = new Map<string, NalpacInvoice>()
  for (const part of chunks(parsed.invoices.map(i => i.invoiceNo))) {
    const rows = await db.select().from(nalpacInvoices).where(inArray(nalpacInvoices.invoiceNo, part))
    for (const r of rows) existing.set(r.invoiceNo, fromRow(r))
  }

  let added = 0
  let updated = 0
  const writes: NalpacInvoice[] = []
  for (const inv of parsed.invoices) {
    const prev = existing.get(inv.invoiceNo)
    if (!prev) { added++; writes.push(inv) } else if (invoiceChanged(prev, inv)) { updated++; writes.push(inv) }
  }

  for (const part of chunks(writes)) {
    await db.insert(nalpacInvoices).values(part.map(i => ({
      invoiceNo: i.invoiceNo, orderName: i.orderName, poNo: i.poNo, nalpacOrderNo: i.nalpacOrderNo, pickTicketNo: i.pickTicketNo,
      orderDate: i.orderDate, dueDate: i.dueDate, paidDate: i.paidDate, shipDate: i.shipDate, status: i.status,
      freightUsd: i.freight.toFixed(2), invoiceTotalUsd: i.invoiceTotal.toFixed(2),
      carrier: i.carrier, trackingNumber: i.trackingNumber, uploadedBy,
    }))).onConflictDoUpdate({
      target: nalpacInvoices.invoiceNo,
      set: {
        orderName: sql`excluded.order_name`, poNo: sql`excluded.po_no`, nalpacOrderNo: sql`excluded.nalpac_order_no`,
        pickTicketNo: sql`excluded.pick_ticket_no`, orderDate: sql`excluded.order_date`, dueDate: sql`excluded.due_date`,
        paidDate: sql`excluded.paid_date`, shipDate: sql`excluded.ship_date`, status: sql`excluded.status`,
        freightUsd: sql`excluded.freight_usd`, invoiceTotalUsd: sql`excluded.invoice_total_usd`,
        carrier: sql`excluded.carrier`, trackingNumber: sql`excluded.tracking_number`,
        uploadedBy: sql`excluded.uploaded_by`, updatedAt: sql`now()`,
      },
    })
  }

  return { added, updated, unchanged: parsed.invoices.length - added - updated }
}

/** Every stored invoice for these Shopify order names ('#1030'), grouped by order. */
export async function readInvoicesForOrders(orderNames: readonly string[]): Promise<Map<string, NalpacInvoice[]>> {
  const out = new Map<string, NalpacInvoice[]>()
  for (const part of chunks([...new Set(orderNames)])) {
    const rows = await db.select().from(nalpacInvoices).where(inArray(nalpacInvoices.orderName, part))
    for (const r of rows) out.set(r.orderName, [...(out.get(r.orderName) ?? []), fromRow(r)])
  }
  return out
}

export interface InvoiceSummary {
  count: number
  /** Latest Nalpac order date covered by an upload, ISO, or null when empty. */
  latestOrderDate: string | null
  /** When the last upload added or changed a row (ISO timestamp), or null. */
  lastChangedAt: string | null
}

export async function getInvoiceSummary(): Promise<InvoiceSummary> {
  const [r] = await db.select({
    count: sql<number>`count(*)::int`,
    latestOrderDate: sql<string | null>`max(${nalpacInvoices.orderDate})::text`,
    lastChangedAt: sql<string | null>`max(${nalpacInvoices.updatedAt})`,
  }).from(nalpacInvoices)
  return {
    count: Number(r?.count ?? 0),
    latestOrderDate: r?.latestOrderDate ?? null,
    lastChangedAt: r?.lastChangedAt ? new Date(r.lastChangedAt).toISOString() : null,
  }
}

/**
 * The order names in this list that Shopify has never heard of, so a PO typo
 * or an order placed outside the store shows up at upload time instead of
 * silently never matching. Throws when Shopify cannot be read.
 */
export async function ordersMissingFromShopify(orderNames: readonly string[]): Promise<string[]> {
  const { adminGraphQL } = await import('~/lib/shopify.server')
  const found = new Set<string>()
  for (const part of chunks([...new Set(orderNames)], 25)) {
    const query = part.map(n => `name:${n}`).join(' OR ')
    const r = await adminGraphQL<{ orders: { nodes: Array<{ name: string }> } }>(
      'query NalpacInvoiceOrders($query: String!, $first: Int!) { orders(first: $first, query: $query) { nodes { name } } }',
      { query: `${query} status:any`, first: 50 },
    )
    for (const o of r.orders?.nodes ?? []) found.add(o.name)
  }
  return [...new Set(orderNames)].filter(n => !found.has(n))
}

const MAX_UPLOAD_BYTES = 2_000_000

export interface UploadOutcome {
  message: string
  /** One line per thing the owner should look at: skipped rows, orders Shopify does not know. */
  details: string[]
}

/** The Costs tab upload, end to end. Throws NalpacCsvError with an owner-readable message. */
export async function uploadNalpacInvoiceFile(file: unknown, uploadedBy: string | null): Promise<UploadOutcome> {
  if (!(file instanceof File) || file.size === 0) throw new NalpacCsvError('Choose the CSV you exported from Nalpac first.')
  if (file.size > MAX_UPLOAD_BYTES) throw new NalpacCsvError('That file is over 2 MB. Nalpac\'s order export is far smaller, so check it is the right file.')
  const parsed = parseNalpacInvoiceCsv(await file.text())
  if (parsed.invoices.length === 0) throw new NalpacCsvError('No usable invoices in that file. Nothing was saved.')

  const r = await upsertNalpacInvoices(parsed, uploadedBy)
  const details: string[] = []
  for (const s of parsed.skipped.slice(0, 20)) details.push(`Row ${s.row}${s.invoiceNo ? ` (invoice ${s.invoiceNo})` : ''} skipped: ${s.reason}.`)
  if (parsed.skipped.length > 20) details.push(`…and ${parsed.skipped.length - 20} more skipped rows.`)
  if (parsed.duplicatesInFile > 0) details.push(`${parsed.duplicatesInFile} invoice${parsed.duplicatesInFile === 1 ? ' appears' : 's appear'} twice in the file; the last copy was kept.`)
  try {
    const missing = await ordersMissingFromShopify(parsed.invoices.map(i => i.orderName))
    if (missing.length > 0) details.push(`Not found in Shopify, so ${missing.length === 1 ? 'it' : 'they'} will not show on the P&L: ${missing.join(', ')}.`)
  } catch (err) {
    console.error('[nalpac invoices] shopify order check failed', err)
  }

  const parts = [`${r.added} new`, `${r.updated} updated`, `${r.unchanged} already up to date`]
  return { message: `Saved ${parsed.invoices.length} invoice${parsed.invoices.length === 1 ? '' : 's'}: ${parts.join(', ')}.`, details }
}
