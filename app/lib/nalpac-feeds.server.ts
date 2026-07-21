import { gzipSync, gunzipSync } from 'node:zlib'
import { parse } from 'csv-parse/sync'
import { cleanDescription } from './feed-processor.server'
import { kvGet, kvSet } from './kv.server'

const BASE_URL = 'https://productfeeds.wyomind.com/feeds/1s6o37vbh23'
const FEED_TTL = 6 * 60 * 60 // 6 hours

// Parsed rows are cached gzipped. The main feed serializes to ~25MB of JSON,
// past Upstash's 10MB max request size, so storing the array directly made
// every kvSet fail and every invocation re-download and re-parse the CSV.
// Column-repetitive row JSON gzips far below the limit.
const GZ_PREFIX = 'gz1:'

function packRows(rows: RawRow[]): string {
  return GZ_PREFIX + gzipSync(Buffer.from(JSON.stringify(rows), 'utf8')).toString('base64')
}

function unpackRows(cached: unknown): RawRow[] | null {
  // Legacy entries (small feeds that fit under the limit) stored the array as-is.
  if (Array.isArray(cached)) return cached as RawRow[]
  if (typeof cached === 'string' && cached.startsWith(GZ_PREFIX)) {
    try {
      const buf = Buffer.from(cached.slice(GZ_PREFIX.length), 'base64')
      return JSON.parse(gunzipSync(buf).toString('utf8')) as RawRow[]
    } catch {
      return null
    }
  }
  return null
}

export interface NalpacPriceSnapshot {
  sku: string
  vendor: string | null
  productTitle: string | null
  msrp: number
  wholesale: number
  mapPrice: number | null
  qty: number | null
  inSaleFeed: boolean
  inNewFeed: boolean
  inTop100Feed: boolean
  nalpacDiscountPct: number | null
  raw: { mainRow?: Record<string, string>; saleRow?: Record<string, string> }
}

export interface FeedFetchResult {
  fetchedAt: Date
  snapshots: Map<string, NalpacPriceSnapshot>
  counts: { main: number; sale: number; new: number; top100: number; merged: number }
  errors: string[]
}

type RawRow = Record<string, string>

function feedUrl(name: 'main' | 'sale' | 'new' | 'top100'): string {
  const envKey = `NALPAC_FEED_${name.toUpperCase()}_URL` as keyof NodeJS.ProcessEnv
  const override = process.env[envKey]
  if (override) return override
  const fileMap: Record<string, string> = {
    main:   'nal-product-attributes-main',
    sale:   'nal-on-sale',
    new:    'nal-new-products',
    top100: 'nal-top-100',
  }
  return `${BASE_URL}/${fileMap[name]}.csv`
}

async function fetchAndParse(name: 'main' | 'sale' | 'new' | 'top100', force: boolean): Promise<RawRow[]> {
  const cacheKey = `pricing:nalpac:feed:${name}`

  if (!force) {
    const cached = unpackRows(await kvGet<unknown>(cacheKey))
    if (cached) return cached
  }

  const res = await fetch(feedUrl(name))
  if (!res.ok) throw new Error(`Nalpac ${name} feed HTTP ${res.status}`)
  const csv = await res.text()

  const rows = parse(csv, {
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
  }) as RawRow[]

  await kvSet(cacheKey, packRows(rows), FEED_TTL)
  return rows
}

function parseNum(val: string | undefined): number {
  if (!val) return 0
  const n = parseFloat(val.replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

function safeText(val: string | undefined): string | null {
  if (!val) return null
  const cleaned = cleanDescription(val)
  return cleaned || null
}

function findSalePrice(row: RawRow, msrp: number): number | null {
  const candidates = ['Sale Price', 'Promo Price', 'On Sale Price']
  for (const col of candidates) {
    if (col in row) {
      const sp = parseNum(row[col])
      if (sp > 0 && sp < msrp) return sp
    }
  }
  return null
}

function skuOf(row: RawRow): string {
  return (row['SKU'] ?? row['Sku'] ?? '').trim()
}

function snapshotFromMain(row: RawRow): NalpacPriceSnapshot {
  const msrp      = parseNum(row['MSRP'])
  const wholesale = parseNum(row['Wholesale'] ?? row['Cost'])
  const rawMap    = parseNum(row['MAP'])
  const qtyRaw    = row['Total qty available'] ?? row['Qty'] ?? row['Quantity']
  const qty       = qtyRaw !== undefined ? parseInt(qtyRaw, 10) : null

  return {
    sku:              skuOf(row),
    vendor:           safeText(row['Vendor'] ?? row['Brand']),
    productTitle:     safeText(row['Product Title']),
    msrp,
    wholesale,
    mapPrice:         rawMap > 0 ? rawMap : null,
    qty:              qty !== null && !isNaN(qty) ? qty : null,
    inSaleFeed:       false,
    inNewFeed:        false,
    inTop100Feed:     false,
    nalpacDiscountPct: null,
    raw:              { mainRow: row },
  }
}

function snapshotFromSale(row: RawRow): NalpacPriceSnapshot {
  const msrp      = parseNum(row['MSRP'])
  const wholesale = parseNum(row['Wholesale'] ?? row['Cost'])
  const rawMap    = parseNum(row['MAP'])
  const salePrice = findSalePrice(row, msrp)

  return {
    sku:              skuOf(row),
    vendor:           safeText(row['Vendor'] ?? row['Brand']),
    productTitle:     safeText(row['Product Title']),
    msrp,
    wholesale,
    mapPrice:         rawMap > 0 ? rawMap : null,
    qty:              null,
    inSaleFeed:       true,
    inNewFeed:        false,
    inTop100Feed:     false,
    nalpacDiscountPct: salePrice !== null && msrp > 0
      ? (msrp - salePrice) / msrp
      : null,
    raw: { saleRow: row },
  }
}

export async function fetchAllNalpacFeeds(opts: { force?: boolean } = {}): Promise<FeedFetchResult> {
  const force  = opts.force ?? false
  const errors: string[] = []

  const [mainResult, saleResult, newResult, top100Result] = await Promise.allSettled([
    fetchAndParse('main',   force),
    fetchAndParse('sale',   force),
    fetchAndParse('new',    force),
    fetchAndParse('top100', force),
  ])

  if (mainResult.status === 'rejected') {
    throw new Error(`Nalpac main feed unavailable: ${mainResult.reason instanceof Error ? mainResult.reason.message : String(mainResult.reason)}`)
  }

  const mainRows   = mainResult.value
  const saleRows   = saleResult.status  === 'fulfilled' ? saleResult.value  : (errors.push(`sale feed: ${saleResult.reason instanceof Error ? saleResult.reason.message : String(saleResult.reason)}`), [] as RawRow[])
  const newRows    = newResult.status   === 'fulfilled' ? newResult.value   : (errors.push(`new feed: ${newResult.reason instanceof Error ? newResult.reason.message : String(newResult.reason)}`), [] as RawRow[])
  const top100Rows = top100Result.status === 'fulfilled' ? top100Result.value : (errors.push(`top100 feed: ${top100Result.reason instanceof Error ? top100Result.reason.message : String(top100Result.reason)}`), [] as RawRow[])

  const snapshots = new Map<string, NalpacPriceSnapshot>()

  for (const row of mainRows) {
    const sku = skuOf(row)
    if (!sku) continue
    snapshots.set(sku, snapshotFromMain(row))
  }

  const saleIndex = new Map<string, RawRow>()
  for (const row of saleRows) {
    const sku = skuOf(row)
    if (!sku) continue
    saleIndex.set(sku, row)
  }

  const newSkus    = new Set(newRows.map(skuOf).filter(Boolean))
  const top100Skus = new Set(top100Rows.map(skuOf).filter(Boolean))

  for (const [sku, snap] of snapshots) {
    const saleRow = saleIndex.get(sku)
    if (saleRow) {
      const salePrice = findSalePrice(saleRow, snap.msrp)
      snap.inSaleFeed       = true
      snap.nalpacDiscountPct = salePrice !== null && snap.msrp > 0
        ? (snap.msrp - salePrice) / snap.msrp
        : null
      snap.raw.saleRow = saleRow
      saleIndex.delete(sku)
    }
    if (newSkus.has(sku))    snap.inNewFeed    = true
    if (top100Skus.has(sku)) snap.inTop100Feed = true
  }

  // SKUs that appear only in the sale feed — still surface them.
  for (const [sku, row] of saleIndex) {
    if (!sku) continue
    const snap = snapshotFromSale(row)
    if (newSkus.has(sku))    snap.inNewFeed    = true
    if (top100Skus.has(sku)) snap.inTop100Feed = true
    snapshots.set(sku, snap)
  }

  return {
    fetchedAt: new Date(),
    snapshots,
    counts: {
      main:   mainRows.length,
      sale:   saleRows.length,
      new:    newRows.length,
      top100: top100Rows.length,
      merged: snapshots.size,
    },
    errors,
  }
}
