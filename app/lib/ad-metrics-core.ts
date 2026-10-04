/**
 * Ad Studio v2 metrics: the pure half (PR-G). No database, no Shopify, no
 * server-only imports, so the Live tab components can import its types and the
 * tests can exercise every rule without mocks. The database half lives in
 * ad-metrics.server.ts, which re-exports everything here.
 *
 * Contents: CSV decoding and parsing for Google Ads and Shop Campaigns
 * exports, the creative matcher, the order-attribution resolver, net revenue
 * and break-even math, the Live row derivations, and the deterministic sample
 * dataset.
 */
import { ADS_RULE_DEFAULTS } from '~/lib/ad-settings-defaults'

// ---------------------------------------------------------------------------
// Break-even and ROAS
// ---------------------------------------------------------------------------

/** Used when the store has no orders in the trailing window (research E.2: about $33). */
export const DEFAULT_AOV_CENTS = 3300

export interface BreakEven {
  aovCents: number
  marginPct: number
  /** AOV x gross margin. */
  cpaCents: number
  /** 1 / gross margin. */
  roas: number
}

/** Break-even CPA = AOV x gross margin; break-even ROAS = 1 / gross margin (research E.2). */
export function computeBreakEven(aovCents: number, marginPct: number): BreakEven {
  const margin = marginPct > 0 && marginPct <= 100 ? marginPct : 45
  const aov = aovCents > 0 ? aovCents : DEFAULT_AOV_CENTS
  return {
    aovCents: aov,
    marginPct: margin,
    cpaCents: Math.round(aov * (margin / 100)),
    roas: 1 / (margin / 100),
  }
}

/** Net ROAS = net revenue / spend. Null when nothing was spent (no ratio exists). */
export function netRoas(netRevenueCents: number, spendCents: number): number | null {
  if (!(spendCents > 0)) return null
  return netRevenueCents / spendCents
}

export function ctrPct(clicks: number, impressions: number): number | null {
  if (!(impressions > 0)) return null
  return (clicks / impressions) * 100
}

export function formatMoney(cents: number): string {
  const d = cents / 100
  return `$${d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatRoas(v: number | null): string {
  return v == null ? 'n/a' : `${v.toFixed(1)}x`
}

/** Net ROAS for a row: n/a until at least one order exists (a 0.0x on no sales reads as a verdict). */
export function roasLabel(r: { netRoas: number | null; orders: number }): string {
  return r.orders === 0 ? 'n/a' : formatRoas(r.netRoas)
}

// ---------------------------------------------------------------------------
// Net revenue of a Shopify order
// ---------------------------------------------------------------------------

export interface OrderMoney {
  /** Shopify subtotal: line items after discounts, before shipping, duties, taxes and tips. */
  subtotal?: number | string | null
  /** Fallbacks, used only when the subtotal is missing. */
  totalPrice?: number | string | null
  totalShipping?: number | string | null
  totalTax?: number | string | null
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Net revenue in cents: subtotal after discounts, EXCLUDING shipping and tax.
 * Shopify's `subtotal` already nets discounts, so nothing is subtracted a
 * second time. When the subtotal is absent, derive it as total minus shipping
 * minus tax. Never negative.
 *
 * Why not the order total: Shop Campaigns ROAS counts shipping and tax
 * (docs/ads-policy.md, Shop app section), which inflates the number the rules
 * compare to break-even.
 */
export function netRevenueCents(o: OrderMoney): number {
  const hasSubtotal = o.subtotal != null && o.subtotal !== ''
  const dollars = hasSubtotal ? num(o.subtotal) : num(o.totalPrice) - num(o.totalShipping) - num(o.totalTax)
  return Math.max(0, Math.round(dollars * 100))
}

// ---------------------------------------------------------------------------
// Creative matching and order attribution
// ---------------------------------------------------------------------------

export interface CreativeKeyRow {
  id: number
  externalAdId: string | null
  exportPayload: unknown
}

export interface CreativeIndex {
  byKey: Map<string, number>
}

export function utmContentOfUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url, 'https://xdipx.com')
    const v = u.searchParams.get('utm_content')
    return v && v.trim() ? v.trim() : null
  } catch {
    const m = /[?&]utm_content=([^&#\s]+)/i.exec(url)
    if (!m) return null
    try { return decodeURIComponent(m[1]!).trim() || null } catch { return m[1]!.trim() || null }
  }
}

function norm(v: string): string {
  return v.trim().toLowerCase()
}

/**
 * Index creatives by every key a platform or an order can carry:
 *  - `utm_content` parsed from export_payload.destination_url (and the Google
 *    `final_url` if the payload names it that way),
 *  - external_ad_id (Meta macro {{ad.id}} lands in utm_content, Google exports an Ad ID),
 *  - the creative id itself (research E.1 convention: utm_content=<creative_id>).
 * First writer wins on a collision, so a duplicated key never silently re-points.
 */
export function buildCreativeIndex(creatives: CreativeKeyRow[]): CreativeIndex {
  const byKey = new Map<string, number>()
  const put = (k: string | null | undefined, id: number) => {
    if (!k) return
    const key = norm(k)
    if (key && !byKey.has(key)) byKey.set(key, id)
  }
  for (const c of creatives) {
    const p = (c.exportPayload && typeof c.exportPayload === 'object' ? c.exportPayload : {}) as Record<string, unknown>
    const dest = typeof p['destination_url'] === 'string' ? p['destination_url'] : typeof p['final_url'] === 'string' ? p['final_url'] : null
    put(utmContentOfUrl(dest), c.id)
    if (typeof p['utm_content'] === 'string') put(p['utm_content'], c.id)
    put(c.externalAdId, c.id)
    put(String(c.id), c.id)
  }
  return { byKey }
}

export function resolveCreativeId(index: CreativeIndex, candidates: Array<string | null | undefined>): number | null {
  for (const c of candidates) {
    if (!c) continue
    const hit = index.byKey.get(norm(c))
    if (hit != null) return hit
  }
  return null
}

export interface OrderAttributionInput {
  /** Shopify order customAttributes (note_attributes). The cart stamps `_utm_content`. */
  customAttributes?: Array<{ key: string; value: string }> | null
  /** order_attribution.utm_content (written by the orders/create webhook from the same attributes). */
  storedUtmContent?: string | null
  /** order_attribution.landing_site (REST landing_site captured by the webhook). */
  storedLandingSite?: string | null
  /** customerJourneySummary first and last visit landing pages (GraphQL). */
  journeyLandingPages?: Array<string | null | undefined>
}

export type UtmContentSource = 'note_attribute' | 'order_attribution' | 'landing_site' | 'journey'

/**
 * Where an order's utm_content comes from, in order of trust:
 *  1. note attribute `_utm_content` (stamped from the visitor's cookie on the
 *     cart, so it survives Meta stripping URL parameters),
 *  2. order_attribution.utm_content (same attribute, as the webhook stored it),
 *  3. `utm_content` in order_attribution.landing_site,
 *  4. `utm_content` in the customer journey's first or last landing page.
 * When none carries one the order is unattributed to any creative: it is
 * counted and returned, never guessed at.
 */
export function extractOrderUtmContent(o: OrderAttributionInput): { value: string; source: UtmContentSource } | null {
  const attr = o.customAttributes?.find(a => a.key === '_utm_content' || a.key === 'utm_content')?.value?.trim()
  if (attr) return { value: attr, source: 'note_attribute' }
  const stored = o.storedUtmContent?.trim()
  if (stored) return { value: stored, source: 'order_attribution' }
  const fromLanding = utmContentOfUrl(o.storedLandingSite)
  if (fromLanding) return { value: fromLanding, source: 'landing_site' }
  for (const page of o.journeyLandingPages ?? []) {
    const v = utmContentOfUrl(page)
    if (v) return { value: v, source: 'journey' }
  }
  return null
}

// ---------------------------------------------------------------------------
// CSV decoding
// ---------------------------------------------------------------------------

export type CsvEncoding = 'utf-16le' | 'utf-16be' | 'utf-8'

export function detectEncoding(buf: Uint8Array): CsvEncoding {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8'
  // No BOM: ASCII text saved as UTF-16 has a zero in every other byte.
  const probe = Math.min(buf.length, 64)
  let oddZeros = 0
  let evenZeros = 0
  for (let i = 0; i < probe; i++) {
    if (buf[i] === 0) { if (i % 2 === 0) evenZeros++; else oddZeros++ }
  }
  if (probe >= 4 && oddZeros > probe / 4 && evenZeros === 0) return 'utf-16le'
  if (probe >= 4 && evenZeros > probe / 4 && oddZeros === 0) return 'utf-16be'
  return 'utf-8'
}

export function decodeCsvBuffer(input: ArrayBuffer | Uint8Array): { text: string; encoding: CsvEncoding } {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input)
  const encoding = detectEncoding(buf)
  let text: string
  if (encoding === 'utf-16be') {
    const swapped = new Uint8Array(buf.length - (buf.length % 2))
    for (let i = 0; i < swapped.length; i += 2) { swapped[i] = buf[i + 1]!; swapped[i + 1] = buf[i]! }
    text = new TextDecoder('utf-16le').decode(swapped)
  } else {
    text = new TextDecoder(encoding).decode(buf)
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return { text, encoding }
}

/** RFC 4180-ish: quoted fields, doubled quotes, embedded newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '').slice(0, 12)
  const score = (d: string) => Math.max(0, ...lines.map(l => l.split(d).length - 1))
  const t = score('\t')
  const c = score(',')
  const s = score(';')
  if (t >= c && t >= s && t > 0) return '\t'
  if (s > c) return ';'
  return ','
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** ISO, US slash, "Oct 1, 2026", "Thursday, October 1, 2026". Anything else is not a day (title, total, blank). */
export function parseDay(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s)
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) return validYmd(Number(m[3]), Number(m[1]), Number(m[2]))
  m = /^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const mo = MONTHS[m[1]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[1]!.slice(0, 3).toLowerCase()]
    if (mo) return validYmd(Number(m[3]), mo, Number(m[2]))
  }
  return null
}

/** "$1,234.56", "1.234,56" is not supported (US exports). Returns null for "--", "" and totals text. */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = raw.replace(/[$,\s]/g, '').replace(/%$/, '')
  if (s === '' || s === '--' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function toCents(v: number | null): number {
  return v == null ? 0 : Math.round(v * 100)
}

function key(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

type ColumnMap = Partial<Record<'day' | 'spend' | 'impressions' | 'clicks' | 'conversions' | 'revenue' | 'adId' | 'url' | 'campaign' | 'product' | 'utmContent', number>>

const GOOGLE_ALIASES: Record<keyof ColumnMap, string[]> = {
  day: ['day', 'date'],
  spend: ['cost', 'spend', 'amountspent'],
  impressions: ['impr', 'impressions'],
  clicks: ['clicks'],
  conversions: ['conversions', 'allconv', 'allconversions'],
  revenue: ['convvalue', 'conversionvalue', 'allconvvalue', 'totalconvvalue'],
  adId: ['adid', 'adidentifier'],
  url: ['finalurl', 'adfinalurl', 'finalurls', 'finalurlsuffix'],
  campaign: ['campaign', 'campaignname'],
  product: [],
  utmContent: ['utmcontent'],
}

const SHOP_ALIASES: Record<keyof ColumnMap, string[]> = {
  day: ['day', 'date', 'reportingstarts', 'reportingdate'],
  spend: ['spend', 'adspend', 'amountspent', 'cost', 'totalspend'],
  impressions: ['impressions', 'impr'],
  clicks: ['clicks', 'linkclicks'],
  conversions: ['orders', 'conversions', 'purchases', 'ordersattributed'],
  revenue: ['sales', 'revenue', 'ordervalue', 'conversionvalue', 'grosssales', 'totalsales', 'attributedsales'],
  adId: [],
  url: ['finalurl', 'url', 'landingpage'],
  campaign: ['campaign', 'campaignname', 'name'],
  product: ['product', 'producthandle', 'handle', 'producttitle'],
  utmContent: ['utmcontent'],
}

function mapColumns(header: string[], aliases: Record<keyof ColumnMap, string[]>): ColumnMap {
  const keys = header.map(key)
  const out: ColumnMap = {}
  for (const field of Object.keys(aliases) as Array<keyof ColumnMap>) {
    for (const a of aliases[field]) {
      const i = keys.indexOf(a)
      if (i >= 0) { out[field] = i; break }
    }
  }
  return out
}

export type MetricsSource = 'google' | 'shop'

export interface ParsedMetricRow {
  line: number
  day: string
  spendCents: number
  impressions: number
  clicks: number
  /** Platform-reported, informational only. Orders and net revenue come from Shopify. */
  conversions: number
  platformRevenueCents: number
  adId: string | null
  utmContent: string | null
  campaign: string | null
  product: string | null
  url: string | null
}

export interface ParsedMetricsFile {
  source: MetricsSource
  encoding: CsvEncoding
  delimiter: string
  headerLine: number
  columns: string[]
  rows: ParsedMetricRow[]
  skipped: Array<{ line: number; reason: string }>
}

export class MetricsParseError extends Error {}

/**
 * Parse a platform report. The header row is detected, not assumed: Google Ads
 * reports start with a title line ("Ad report") and a date-range line, Shop
 * exports may carry their own preamble. The header is the first row that has
 * both a day column and a spend column. Rows whose day does not parse (the
 * totals line, blanks, footnotes) are skipped and listed, not dropped quietly.
 */
export function parseMetricsCsv(input: ArrayBuffer | Uint8Array, source: MetricsSource): ParsedMetricsFile {
  const { text, encoding } = decodeCsvBuffer(input)
  const delimiter = detectDelimiter(text)
  const table = parseDelimited(text, delimiter)
  const aliases = source === 'google' ? GOOGLE_ALIASES : SHOP_ALIASES

  let headerIdx = -1
  let cols: ColumnMap = {}
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const m = mapColumns(table[i]!, aliases)
    if (m.day != null && m.spend != null) { headerIdx = i; cols = m; break }
  }
  if (headerIdx < 0) {
    throw new MetricsParseError(
      `Could not find a header row with a Day (or Date) column and a spend column (${source === 'google' ? 'Cost' : 'Spend or Amount spent'}).`,
    )
  }

  const header = table[headerIdx]!
  const rows: ParsedMetricRow[] = []
  const skipped: Array<{ line: number; reason: string }> = []
  const cell = (r: string[], i: number | undefined): string | null => (i == null ? null : (r[i] ?? '').trim() || null)

  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i]!
    const line = i + 1
    const dayRaw = cell(r, cols.day)
    const day = parseDay(dayRaw)
    if (!day) {
      skipped.push({ line, reason: /total/i.test(r.join(' ')) ? 'totals row' : `no day ("${(dayRaw ?? '').slice(0, 24)}")` })
      continue
    }
    const url = cell(r, cols.url)
    rows.push({
      line,
      day,
      spendCents: toCents(parseNumber(cell(r, cols.spend))),
      impressions: Math.round(parseNumber(cell(r, cols.impressions)) ?? 0),
      clicks: Math.round(parseNumber(cell(r, cols.clicks)) ?? 0),
      conversions: parseNumber(cell(r, cols.conversions)) ?? 0,
      platformRevenueCents: toCents(parseNumber(cell(r, cols.revenue))),
      adId: cell(r, cols.adId),
      utmContent: cell(r, cols.utmContent) ?? utmContentOfUrl(url),
      campaign: cell(r, cols.campaign),
      product: cell(r, cols.product),
      url,
    })
  }
  return { source, encoding, delimiter, headerLine: headerIdx + 1, columns: header.map(h => h.trim()), rows, skipped }
}

export interface ImportPlan {
  /** One entry per (creativeId, day, platform): the file's rows summed. */
  creativeRows: Array<{ creativeId: number; day: string; platform: MetricsSource; spendCents: number; impressions: number; clicks: number }>
  /** Rows that matched no creative, summed per (day, platform). They land as account-level rows (creative_id null). */
  accountRows: Array<{ day: string; platform: MetricsSource; spendCents: number; impressions: number; clicks: number }>
  /** The unmatched file rows themselves, returned to the caller. Never silently dropped. */
  unmatched: ParsedMetricRow[]
  matchedRows: number
}

/** Match parsed rows to creatives and aggregate. Pure, so preview and commit share one plan. */
export function planImport(parsed: ParsedMetricsFile, index: CreativeIndex): ImportPlan {
  const cMap = new Map<string, ImportPlan['creativeRows'][number]>()
  const aMap = new Map<string, ImportPlan['accountRows'][number]>()
  const unmatched: ParsedMetricRow[] = []
  let matchedRows = 0
  for (const r of parsed.rows) {
    const id = resolveCreativeId(index, [r.utmContent, r.adId, r.campaign, r.product])
    if (id != null) {
      matchedRows++
      const k = `${id}|${r.day}`
      const cur = cMap.get(k) ?? { creativeId: id, day: r.day, platform: parsed.source, spendCents: 0, impressions: 0, clicks: 0 }
      cur.spendCents += r.spendCents; cur.impressions += r.impressions; cur.clicks += r.clicks
      cMap.set(k, cur)
    } else {
      unmatched.push(r)
      const cur = aMap.get(r.day) ?? { day: r.day, platform: parsed.source, spendCents: 0, impressions: 0, clicks: 0 }
      cur.spendCents += r.spendCents; cur.impressions += r.impressions; cur.clicks += r.clicks
      aMap.set(r.day, cur)
    }
  }
  return {
    creativeRows: [...cMap.values()].sort((a, b) => a.day.localeCompare(b.day) || a.creativeId - b.creativeId),
    accountRows: [...aMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    unmatched,
    matchedRows,
  }
}

// ---------------------------------------------------------------------------
// Live feed shapes
// ---------------------------------------------------------------------------

export type LiveSource = 'live' | 'sample' | 'shop-history'
export type LiveActionKind = 'pause' | 'resume' | 'scale' | 'brake' | 'refresh'
export type Recommendation = 'pause' | 'paused' | 'scale' | 'brake' | 'refresh' | 'revive' | 'healthy'

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  pause: 'Pause',
  paused: 'Paused',
  scale: 'Scale',
  brake: 'Brake',
  refresh: 'Refresh',
  revive: 'Revive',
  healthy: 'Healthy',
}

/** Sort order for "recommended actions first" (wires 8.2). */
export const RECOMMENDATION_RANK: Record<Recommendation, number> = {
  pause: 0, brake: 1, scale: 2, refresh: 3, revive: 4, paused: 5, healthy: 6,
}

export const RULE_RECOMMENDATION: Record<string, Recommendation> = {
  R1: 'pause', R2: 'pause', R3: 'pause', R4: 'revive', R5: 'scale', R6: 'brake', R7: 'paused', R8: 'refresh',
}

export interface RuleFiring {
  ruleId: string
  /** Plain-words sentence, built from the numbers, per wires 8.1. */
  sentence: string
  recommendation: Recommendation
  eventId: number | null
  firedAt: string | null
  /** True once an owner or the engine applied it. */
  applied: boolean
}

export interface DailyPoint { day: string; spendCents: number; impressions: number; clicks: number; orders: number; netRevenueCents: number }

export interface LiveRow {
  /** A string key so sample rows and real rows share one shape. */
  key: string
  creativeId: number | null
  label: string
  slogan: string | null
  thumbUrl: string | null
  lane: string
  registerTier: string
  platform: string
  lookbackDays: number
  spendCents: number
  impressions: number
  clicks: number
  ctrPct: number | null
  orders: number
  netRevenueCents: number
  netRoas: number | null
  recommendation: Recommendation
  firing: RuleFiring | null
  /** Shown when no rule has fired: Healthy, or the numbers that explain the quiet. */
  hint: string
  paused: boolean
  firedToday: boolean
  sample: boolean
}

export interface LiveBand {
  lookbackDays: number
  spendCents: number
  orders: number
  netRevenueCents: number
  netRoas: number | null
  rulesFiredToday: number
  series: Array<{ at: string; value: number }>
}

export interface ShopHistoryDay {
  day: string
  platform: string
  spendCents: number
  impressions: number
  clicks: number
  ctrPct: number | null
}

export interface LiveFeed {
  source: LiveSource
  sample: boolean
  lookbackDays: number
  breakEven: BreakEven
  band: LiveBand
  rows: LiveRow[]
  needsAction: number
  total: number
  shopHistory: ShopHistoryDay[]
  /** True when there is nothing at all to show for this source (drives the empty state). */
  empty: boolean
}

/** The metric-derived line shown when no rule event exists. Informational, never a rule verdict. */
export function deriveHint(m: { spendCents: number; orders: number; netRevenueCents: number; impressions: number; lookbackDays: number }, be: BreakEven): string {
  if (m.spendCents <= 0 && m.impressions <= 0) return 'Healthy. No spend yet.'
  const roas = netRoas(m.netRevenueCents, m.spendCents)
  const w = `${m.lookbackDays}d`
  if (m.orders === 0) return `Healthy so far. ${formatMoney(m.spendCents)} spent, 0 orders over ${w}; break-even spend is ${formatMoney(be.cpaCents)} per order.`
  return `Healthy. ${formatRoas(roas)} net ROAS on ${m.orders} order${m.orders === 1 ? '' : 's'} over ${w}.`
}

// ---------------------------------------------------------------------------
// Sample dataset
// ---------------------------------------------------------------------------

export interface SampleCreative {
  key: string
  label: string
  slogan: string
  lane: string
  registerTier: string
  platform: string
  /** Sample-only: frequency is not in the metrics table. Drives R8. */
  frequency: number
  days: DailyPoint[]
  /** Sample-only: set when a prior owner or engine action paused it. */
  paused?: boolean
}

export const SAMPLE_END_DAY = '2026-10-03'

function dayOffset(end: string, back: number): string {
  const d = new Date(`${end}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/** Deterministic daily series: no randomness, so tests and screenshots agree. */
function series(end: string, spec: (i: number) => Omit<DailyPoint, 'day'>): DailyPoint[] {
  return Array.from({ length: 14 }, (_, i) => ({ day: dayOffset(end, 13 - i), ...spec(i) }))
}

/**
 * Eight creatives over 14 days, built so that, at the default thresholds and a
 * $33 AOV at 45% margin (break-even CPA $14.85, break-even ROAS 2.22x):
 *   S1 fires R1 (spend $42 over 7d, zero orders)
 *   S2 fires R2 (2,000+ impressions, CTR under 0.5%)
 *   S3 fires R5 (3.1x net ROAS on 4 orders)
 *   S4 fires R8 (frequency 3.4, CTR down more than 30% against its first 3 days)
 *   S5 to S8 stay healthy (one is already paused).
 * Every figure is flagged sample and the Live tab labels it "sample data".
 */
export function sampleDataset(end: string = SAMPLE_END_DAY): { creatives: SampleCreative[]; sample: true } {
  const mk = (
    key: string, label: string, slogan: string, lane: string, tier: string, platform: string, frequency: number,
    spec: (i: number) => Omit<DailyPoint, 'day'>, paused = false,
  ): SampleCreative => ({ key, label, slogan, lane, registerTier: tier, platform, frequency, days: series(end, spec), paused })

  const creatives: SampleCreative[] = [
    // S1: R1. $6 a day for 14 days, no orders.
    mk('S1', 'S1 Billing Reads XDIPX', 'The statement reads XDIPX.', 'google', '4-5', 'google', 1.4,
      () => ({ spendCents: 600, impressions: 280, clicks: 11, orders: 0, netRevenueCents: 0 })),
    // S2: R2. Plenty of impressions, almost no clicks, no sales.
    mk('S2', 'S2 Two Lubes One Table', 'Water-based or aloe, side by side.', 'meta', '3-4', 'meta', 1.8,
      () => ({ spendCents: 200, impressions: 640, clicks: 2, orders: 0, netRevenueCents: 0 })),
    // S3: R5. Strong and steady: $5 a day, four orders in the last 7 days.
    mk('S3', 'S3 Quiet Reliable Bullet', 'Small, quiet, and ready.', 'google', '4-5', 'google', 1.6,
      i => ({ spendCents: 500, impressions: 520, clicks: 26, orders: i === 8 || i === 10 || i === 12 || i === 13 ? 1 : 0, netRevenueCents: i === 8 || i === 10 || i === 12 || i === 13 ? 2700 : 0 })),
    // S4: R8. CTR starts near 2.4% and slides to about 1.2%, frequency 3.4.
    mk('S4', 'S4 Overheard at the Counter', 'Overheard at the counter: it is the quiet one.', 'snap', '6-7', 'snap', 3.4,
      i => {
        const impressions = 900
        const ctr = i < 3 ? 0.024 : 0.012
        return { spendCents: 300, impressions, clicks: Math.round(impressions * ctr), orders: i % 5 === 0 ? 1 : 0, netRevenueCents: i % 5 === 0 ? 2500 : 0 }
      }),
    // S5: healthy, small spend, one order.
    mk('S5', 'S5 Heated Steel', 'Steel holds the warmth you give it.', 'adult', '9', 'exoclick', 1.2,
      i => ({ spendCents: 120, impressions: 800, clicks: 12, orders: i === 12 ? 1 : 0, netRevenueCents: i === 12 ? 2400 : 0 })),
    // S6: healthy, thin data.
    mk('S6', 'S6 Gift for Him', 'He will not ask where it came from.', 'newsletter', '7-9', 'newsletter', 1.0,
      i => ({ spendCents: i === 6 ? 5000 : 0, impressions: i === 6 ? 4100 : 0, clicks: i === 6 ? 70 : 0, orders: i === 7 ? 2 : 0, netRevenueCents: i === 7 ? 5600 : 0 })),
    // S7: healthy on ROAS, well under the scale thresholds.
    mk('S7', 'S7 Statement Reads XDIPX Meta', 'The statement reads XDIPX.', 'meta', '3-4', 'meta', 1.9,
      i => ({ spendCents: 200, impressions: 450, clicks: 9, orders: i === 9 ? 1 : 0, netRevenueCents: i === 9 ? 3100 : 0 })),
    // S8: already paused, spend stopped five days ago.
    mk('S8', 'S8 Wand Spec Sheet', 'Plug-in power, no battery to babysit.', 'google', '4-5', 'google', 1.5,
      i => ({ spendCents: i < 9 ? 300 : 0, impressions: i < 9 ? 400 : 0, clicks: i < 9 ? 3 : 0, orders: 0, netRevenueCents: 0 }), true),
  ]
  return { creatives, sample: true }
}

export interface WindowTotals { spendCents: number; impressions: number; clicks: number; orders: number; netRevenueCents: number }

export function sumWindow(days: DailyPoint[], end: string, lookbackDays: number): WindowTotals {
  const from = dayOffset(end, lookbackDays - 1)
  const t: WindowTotals = { spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0 }
  for (const d of days) {
    if (d.day < from || d.day > end) continue
    t.spendCents += d.spendCents; t.impressions += d.impressions; t.clicks += d.clicks
    t.orders += d.orders; t.netRevenueCents += d.netRevenueCents
  }
  return t
}

export type SampleThresholds = Pick<typeof ADS_RULE_DEFAULTS,
  'ads_rule_r1_be_multiple' | 'ads_rule_r2_min_ctr_pct' | 'ads_rule_r2_min_impressions' | 'ads_rule_r5_roas_factor'
  | 'ads_rule_r5_min_purchases' | 'ads_rule_r8_max_frequency' | 'ads_rule_r8_ctr_drop_pct'>

/**
 * The four rules the sample is designed around, evaluated in plain code so the
 * Live tab can show a sentence with real numbers and the tests can prove the
 * sample fires R1, R2, R5 and R8. This is NOT the rules engine: PR-H owns R1 to
 * R8 against live data, lifetime windows and the cooldowns. Here every window
 * is the 14 days of the sample, 7 days where the rule says 7.
 */
export function sampleFirings(c: SampleCreative, be: BreakEven, end: string = SAMPLE_END_DAY, th: SampleThresholds = ADS_RULE_DEFAULTS): RuleFiring[] {
  const out: RuleFiring[] = []
  const life = sumWindow(c.days, end, 14)
  const wk = sumWindow(c.days, end, 7)
  const push = (ruleId: string, sentence: string) =>
    out.push({ ruleId, sentence, recommendation: RULE_RECOMMENDATION[ruleId]!, eventId: null, firedAt: null, applied: false })

  if (c.paused) return out

  if (life.spendCents >= th.ads_rule_r1_be_multiple * be.cpaCents && life.orders === 0) {
    push('R1', `Pause: ${formatMoney(life.spendCents)} spent in 14d, 0 orders, R1`)
  }
  const ctr = ctrPct(life.clicks, life.impressions)
  if (life.impressions >= th.ads_rule_r2_min_impressions && ctr != null && ctr < th.ads_rule_r2_min_ctr_pct) {
    push('R2', `Pause: ${life.impressions.toLocaleString('en-US')} impressions in 14d at ${ctr.toFixed(2)}% CTR, R2`)
  }
  const roas = netRoas(wk.netRevenueCents, wk.spendCents)
  if (roas != null && roas >= th.ads_rule_r5_roas_factor * be.roas && wk.orders >= th.ads_rule_r5_min_purchases) {
    push('R5', `Scale: ${formatRoas(roas)} net ROAS on ${wk.orders} orders over 7d, R5`)
  }
  const first3 = c.days.slice(0, 3).reduce((a, d) => ({ i: a.i + d.impressions, k: a.k + d.clicks }), { i: 0, k: 0 })
  const last7 = c.days.slice(-7).reduce((a, d) => ({ i: a.i + d.impressions, k: a.k + d.clicks }), { i: 0, k: 0 })
  const ctrFirst = ctrPct(first3.k, first3.i)
  const ctrNow = ctrPct(last7.k, last7.i)
  if (c.frequency > th.ads_rule_r8_max_frequency && ctrFirst && ctrNow != null && (ctrFirst - ctrNow) / ctrFirst >= th.ads_rule_r8_ctr_drop_pct / 100) {
    const drop = Math.round(((ctrFirst - ctrNow) / ctrFirst) * 100)
    push('R8', `Refresh: frequency ${c.frequency.toFixed(1)}, CTR down ${drop}% from its first 3 days, R8`)
  }
  return out
}

export function rowFromWindow(
  base: Pick<LiveRow, 'key' | 'creativeId' | 'label' | 'slogan' | 'thumbUrl' | 'lane' | 'registerTier' | 'platform' | 'sample'>,
  w: WindowTotals,
  lookbackDays: number,
  be: BreakEven,
  firing: RuleFiring | null,
  paused: boolean,
  firedToday: boolean,
): LiveRow {
  // A paused row whose firing is a revive (R4) keeps that recommendation: Resume is the action.
  const revive = firing?.recommendation === 'revive'
  const recommendation: Recommendation = revive ? 'revive' : paused ? 'paused' : firing ? firing.recommendation : 'healthy'
  return {
    ...base,
    lookbackDays,
    spendCents: w.spendCents,
    impressions: w.impressions,
    clicks: w.clicks,
    ctrPct: ctrPct(w.clicks, w.impressions),
    orders: w.orders,
    netRevenueCents: w.netRevenueCents,
    netRoas: netRoas(w.netRevenueCents, w.spendCents),
    recommendation,
    firing: paused && !revive ? null : firing,
    hint: revive && firing ? firing.sentence : paused ? 'Paused. Spend stopped; Resume puts it back in the rotation.' : firing ? firing.sentence : deriveHint({ ...w, lookbackDays }, be),
    paused,
    firedToday,
    sample: base.sample,
  }
}

export function sortRows(rows: LiveRow[]): LiveRow[] {
  return [...rows].sort((a, b) =>
    RECOMMENDATION_RANK[a.recommendation] - RECOMMENDATION_RANK[b.recommendation] || b.spendCents - a.spendCents)
}

export function needsAction(r: LiveRow): boolean {
  return r.recommendation !== 'healthy' && r.recommendation !== 'paused'
}

/** Build the whole sample feed. Pure: the caller passes in manual events already replayed into `pausedKeys`. */
export function buildSampleFeed(opts: {
  lookbackDays: number
  breakEven: BreakEven
  /** Sample keys the owner paused through the Live tab (replayed from ad_rule_events). */
  pausedKeys?: ReadonlySet<string>
  /** Sample keys the owner resumed. */
  resumedKeys?: ReadonlySet<string>
  /** Sample keys whose recommendation the owner already acted on (scale, brake, refresh). */
  resolvedKeys?: ReadonlySet<string>
  end?: string
  /**
   * Which rules fired on one sample creative. The Live loader passes the real
   * rules engine (ad-rules-core); the default is the small PR-G stand-in, kept
   * so the pure feed stays testable without the engine.
   */
  firingsFor?: (c: SampleCreative) => RuleFiring[]
}): LiveFeed {
  const end = opts.end ?? SAMPLE_END_DAY
  const { creatives } = sampleDataset(end)
  const rows = creatives.map(c => {
    const paused = opts.pausedKeys?.has(c.key) ? true : opts.resumedKeys?.has(c.key) ? false : !!c.paused
    const found = (opts.firingsFor ?? (x => sampleFirings({ ...x, paused: false }, opts.breakEven, end)))(c)
    const firing = opts.resolvedKeys?.has(c.key) ? null : (found[0] ?? null)
    const w = sumWindow(c.days, end, opts.lookbackDays)
    return rowFromWindow({
      key: `sample:${c.key}`, creativeId: null, label: c.label, slogan: c.slogan, thumbUrl: null,
      lane: c.lane, registerTier: c.registerTier, platform: c.platform, sample: true,
    }, w, opts.lookbackDays, opts.breakEven, firing, paused, !!firing && !paused)
  })
  const sorted = sortRows(rows)
  const all = creatives.flatMap(c => c.days)
  const byDay = new Map<string, DailyPoint>()
  for (const d of all) {
    const cur = byDay.get(d.day) ?? { day: d.day, spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0 }
    cur.spendCents += d.spendCents; cur.impressions += d.impressions; cur.clicks += d.clicks
    cur.orders += d.orders; cur.netRevenueCents += d.netRevenueCents
    byDay.set(d.day, cur)
  }
  const dayList = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  const from = dayOffset(end, opts.lookbackDays - 1)
  const windowDays = dayList.filter(d => d.day >= from && d.day <= end)
  const spend = windowDays.reduce((s, d) => s + d.spendCents, 0)
  const orders = windowDays.reduce((s, d) => s + d.orders, 0)
  const net = windowDays.reduce((s, d) => s + d.netRevenueCents, 0)
  return {
    source: 'sample',
    sample: true,
    lookbackDays: opts.lookbackDays,
    breakEven: opts.breakEven,
    band: {
      lookbackDays: opts.lookbackDays,
      spendCents: spend,
      orders,
      netRevenueCents: net,
      netRoas: netRoas(net, spend),
      rulesFiredToday: sorted.filter(r => r.firedToday).length,
      series: windowDays.map(d => ({ at: d.day, value: d.spendCents / 100 })),
    },
    rows: sorted,
    needsAction: sorted.filter(needsAction).length,
    total: sorted.length,
    shopHistory: [],
    empty: false,
  }
}
