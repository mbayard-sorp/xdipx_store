/**
 * Ad Studio v2 metrics (PR-G): CSV import for Google Ads and Shop Campaigns,
 * Shopify order attribution by utm_content, the daily rollup that finally
 * writes daily_profit_summary.ad_spend, and the feeds the Live tab reads.
 *
 * The pure parsing, matching and math live in ad-metrics-core.ts and are
 * re-exported here, so callers need only this module.
 *
 * Where the numbers come from (one row per creative, day and platform in
 * ad_creative_daily_metrics):
 *   - platform google | shop, source csv: spend, impressions, clicks from an
 *     imported report. Platform-reported conversions and revenue are NOT stored:
 *     Shop Campaigns revenue counts shipping and tax, and Shopify is the one
 *     source no platform can restrict.
 *   - platform shopify, source shopify: orders and net revenue attributed by
 *     attributeShopifyOrders (spend 0). Kept on its own row so a re-import of a
 *     spend report never overwrites orders and a re-attribution never
 *     overwrites spend. Readers sum across platforms.
 *   - creative_id null rows: spend that matched no creative (Shop Campaigns
 *     history is campaign level). It still counts toward the day's ad_spend.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  adCampaigns, adCreativeDailyMetrics, adCreatives, adRuleEvents, dailyProfitSummary, mediaAssets, orderAttribution,
} from '../../db/schema'
import { getAdsGrossMarginPct } from '~/lib/ad-settings.server'
import {
  buildCreativeIndex, buildSampleFeed, computeBreakEven, ctrPct, extractOrderUtmContent, netRevenueCents, netRoas,
  parseMetricsCsv, planImport, resolveCreativeId, rowFromWindow, sortRows, needsAction, formatMoney, formatRoas,
  DEFAULT_AOV_CENTS, RULE_RECOMMENDATION,
  type BreakEven, type CreativeIndex, type ImportPlan, type LiveBand, type LiveFeed, type LiveRow, type LiveSource,
  type MetricsSource, type ParsedMetricRow, type ParsedMetricsFile, type Recommendation, type RuleFiring,
  type ShopHistoryDay, type UtmContentSource, type WindowTotals, type LiveActionKind,
} from '~/lib/ad-metrics-core'

export * from '~/lib/ad-metrics-core'

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }
export function todayUtc(now: Date = new Date()): string { return ymd(now) }
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return ymd(d)
}
function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n))
  return out
}

// ---------------------------------------------------------------------------
// Break-even
// ---------------------------------------------------------------------------

/**
 * Trailing-30-day AOV from daily_profit_summary (revenue / orders, which is the
 * order total, shipping and tax included, because that is what the summary
 * records) and the margin setting. Falls back to the research default AOV when
 * the window has no orders. Only the ratio of net revenue to spend feeds ROAS,
 * so the AOV only moves the break-even CPA.
 */
export async function currentBreakEven(now: Date = new Date()): Promise<BreakEven> {
  const from = addDays(todayUtc(now), -30)
  let aovCents = DEFAULT_AOV_CENTS
  try {
    const [row] = await db
      .select({
        revenue: sql<string | null>`sum(${dailyProfitSummary.totalRevenue})`,
        orders: sql<string | null>`sum(${dailyProfitSummary.totalOrders})`,
      })
      .from(dailyProfitSummary)
      .where(gte(dailyProfitSummary.summaryDate, from))
    const rev = Number(row?.revenue ?? 0)
    const ord = Number(row?.orders ?? 0)
    if (ord > 0 && rev > 0) aovCents = Math.round((rev / ord) * 100)
  } catch (err) {
    console.error('[ad-metrics] AOV read failed, using default', err)
  }
  return computeBreakEven(aovCents, await getAdsGrossMarginPct())
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export class AdMetricsError extends Error {
  constructor(message: string, readonly code: string = 'bad_request') { super(message) }
}

async function loadCreativeIndex(): Promise<CreativeIndex> {
  const rows = await db
    .select({ id: adCreatives.id, externalAdId: adCreatives.externalAdId, exportPayload: adCreatives.exportPayload })
    .from(adCreatives)
  return buildCreativeIndex(rows)
}

export interface ImportOptions {
  source: MetricsSource
  /** false (default) returns the preview and writes nothing; true writes. */
  commit?: boolean
}

export interface ImportResult {
  source: MetricsSource
  committed: boolean
  encoding: string
  delimiter: string
  headerLine: number
  columns: string[]
  fileRows: number
  skipped: Array<{ line: number; reason: string }>
  dateRange: { from: string; to: string } | null
  totalSpendCents: number
  matchedRows: number
  unmatchedRows: number
  /** Every unmatched file row, so the UI can show them and nothing is silently dropped. */
  unmatched: Array<Pick<ParsedMetricRow, 'line' | 'day' | 'spendCents' | 'campaign' | 'adId' | 'utmContent' | 'product'>>
  creativeRowsToWrite: number
  accountRowsToWrite: number
  /** First rows of the plan, for the preview table. */
  preview: Array<{ day: string; target: string; spendCents: number; impressions: number; clicks: number }>
  written?: { creativeRows: number; accountRows: number; rollup: RollupResult[] }
}

const PREVIEW_ROWS = 12

function summarize(parsed: ParsedMetricsFile, plan: ImportPlan, commit: boolean): ImportResult {
  const days = parsed.rows.map(r => r.day).sort()
  return {
    source: parsed.source,
    committed: commit,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter === '\t' ? 'tab' : parsed.delimiter,
    headerLine: parsed.headerLine,
    columns: parsed.columns,
    fileRows: parsed.rows.length,
    skipped: parsed.skipped.slice(0, 50),
    dateRange: days.length ? { from: days[0]!, to: days[days.length - 1]! } : null,
    totalSpendCents: parsed.rows.reduce((s, r) => s + r.spendCents, 0),
    matchedRows: plan.matchedRows,
    unmatchedRows: plan.unmatched.length,
    unmatched: plan.unmatched.map(r => ({
      line: r.line, day: r.day, spendCents: r.spendCents, campaign: r.campaign, adId: r.adId, utmContent: r.utmContent, product: r.product,
    })),
    creativeRowsToWrite: plan.creativeRows.length,
    accountRowsToWrite: plan.accountRows.length,
    preview: [
      ...plan.creativeRows.map(r => ({ day: r.day, target: `creative #${r.creativeId}`, spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks })),
      ...plan.accountRows.map(r => ({ day: r.day, target: `account (${r.platform}, unmatched)`, spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks })),
    ].sort((a, b) => a.day.localeCompare(b.day)).slice(0, PREVIEW_ROWS),
  }
}

async function writePlan(plan: ImportPlan, parsed: ParsedMetricsFile): Promise<{ creativeRows: number; accountRows: number }> {
  for (const part of chunk(plan.creativeRows, 100)) {
    await db
      .insert(adCreativeDailyMetrics)
      .values(part.map(r => ({
        creativeId: r.creativeId, day: r.day, platform: r.platform,
        spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks, source: 'csv',
      })))
      .onConflictDoUpdate({
        target: [adCreativeDailyMetrics.creativeId, adCreativeDailyMetrics.day, adCreativeDailyMetrics.platform],
        // Spend, impressions and clicks only: orders and net revenue belong to the shopify row.
        set: {
          spendCents: sql`excluded.spend_cents`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          source: sql`excluded.source`,
        },
      })
  }
  // Account-level rows have a null creative_id, which a unique index treats as
  // distinct, so upsert cannot dedupe them. Replace the imported range instead.
  const days = plan.accountRows.map(r => r.day).sort()
  if (days.length) {
    await db.delete(adCreativeDailyMetrics).where(and(
      isNull(adCreativeDailyMetrics.creativeId),
      eq(adCreativeDailyMetrics.platform, parsed.source),
      eq(adCreativeDailyMetrics.source, 'csv'),
      gte(adCreativeDailyMetrics.day, days[0]!),
      lte(adCreativeDailyMetrics.day, days[days.length - 1]!),
    ))
    for (const part of chunk(plan.accountRows, 100)) {
      await db.insert(adCreativeDailyMetrics).values(part.map(r => ({
        creativeId: null, day: r.day, platform: r.platform,
        spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks, source: 'csv',
      })))
    }
  }
  return { creativeRows: plan.creativeRows.length, accountRows: plan.accountRows.length }
}

async function runImport(buffer: ArrayBuffer | Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  let parsed: ParsedMetricsFile
  try {
    parsed = parseMetricsCsv(buffer, opts.source)
  } catch (err) {
    throw new AdMetricsError(err instanceof Error ? err.message : 'Could not read that file.', 'bad_file')
  }
  if (parsed.rows.length === 0) throw new AdMetricsError('The file has a header row but no day rows.', 'bad_file')
  const plan = planImport(parsed, await loadCreativeIndex())
  const result = summarize(parsed, plan, !!opts.commit)
  if (!opts.commit) return result
  const written = await writePlan(plan, parsed)
  const days = [...new Set(parsed.rows.map(r => r.day))].sort()
  const rollup: RollupResult[] = []
  for (const d of days) rollup.push(await rollupDaily(d))
  return { ...result, written: { ...written, rollup } }
}

/**
 * Google Ads report (Editor or the Reports page download). UTF-16LE with a BOM
 * and a title line before the header is the normal case; UTF-8 also works. The
 * header is detected. `commit` false returns a preview and writes nothing.
 */
export function importGoogleAdsCsv(buffer: ArrayBuffer | Uint8Array, opts: { source: 'google'; commit?: boolean }): Promise<ImportResult> {
  return runImport(buffer, { source: opts.source, commit: opts.commit ?? false })
}

/** Shop Campaigns export from Shopify admin (UTF-8 CSV). Same two-step contract. */
export function importShopCampaignsCsv(buffer: ArrayBuffer | Uint8Array, opts: { source: 'shop'; commit?: boolean }): Promise<ImportResult> {
  return runImport(buffer, { source: opts.source, commit: opts.commit ?? false })
}

/**
 * Meta insights arrive through the Meta Ads MCP connector, which PR-E
 * authorizes and wires (the owner grants the connector there). Nothing here
 * calls Meta. Until then the routine imports Meta numbers by CSV if at all.
 */
export async function importMetaInsights(_opts?: { since?: string }): Promise<never> {
  throw new AdMetricsError('importMetaInsights is not configured: the Meta Ads connector is wired in PR-E.', 'not_configured')
}

// ---------------------------------------------------------------------------
// Shopify order attribution
// ---------------------------------------------------------------------------

const ORDERS_PAGE = 50
const MAX_PAGES = 60

const ORDERS_QUERY_BASE = (journey: boolean) => `
  query AdOrders($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query) {
      nodes {
        id
        name
        createdAt
        currentSubtotalPriceSet { shopMoney { amount } }
        customAttributes { key value }
        ${journey ? 'customerJourneySummary { firstVisit { landingPage } lastVisit { landingPage } }' : ''}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

interface AdOrderNode {
  id: string
  name: string
  createdAt: string
  currentSubtotalPriceSet: { shopMoney: { amount: string } } | null
  customAttributes: Array<{ key: string; value: string }>
  customerJourneySummary?: { firstVisit: { landingPage: string | null } | null; lastVisit: { landingPage: string | null } | null } | null
}

interface AdOrdersPage { orders: { nodes: AdOrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

export function adOrdersSearch(sinceDay: string): string {
  return `created_at:>='${sinceDay}T00:00:00Z' financial_status:paid status:any`
}

async function fetchOrders(sinceDay: string): Promise<AdOrderNode[]> {
  const { adminGraphQL } = await import('./shopify.server')
  const out: AdOrderNode[] = []
  let journey = true
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: AdOrdersPage
    try {
      res = await adminGraphQL<AdOrdersPage>(ORDERS_QUERY_BASE(journey), { query: adOrdersSearch(sinceDay), first: ORDERS_PAGE, after: cursor })
    } catch (err) {
      // The journey field needs its own scope; losing it costs a fallback, not the run.
      if (journey && page === 0) { journey = false; page--; continue }
      throw err
    }
    out.push(...res.orders.nodes)
    cursor = res.orders.pageInfo?.hasNextPage ? (res.orders.pageInfo.endCursor ?? null) : null
    if (!cursor) break
  }
  return out
}

export interface AttributionResult {
  sinceDay: string
  ordersScanned: number
  /** Orders resolved to a creative. */
  attributed: number
  /** Orders with no utm_content anywhere (organic, direct, ChatGPT and so on). Not guessed at. */
  noUtmContent: number
  /** Orders that carried a utm_content no creative owns. Returned so a typo or an unregistered ad is visible. */
  unmatched: Array<{ order: string; utmContent: string; source: UtmContentSource }>
  bySource: Record<UtmContentSource, number>
  creativesTouched: number
  rowsWritten: number
  rowsRemoved: number
}

export interface AttributedOrder {
  order: string
  day: string
  utmContent: string | null
  source: UtmContentSource | null
  netRevenueCents: number
}

/**
 * Pure fold: orders to per-(creative, day) totals. Exported for tests.
 * See extractOrderUtmContent for the exact fields read and their precedence.
 */
export function foldAttribution(
  orders: AttributedOrder[],
  index: CreativeIndex,
): { rows: Map<string, { creativeId: number; day: string; orders: number; netRevenueCents: number }>; unmatched: AttributionResult['unmatched']; noUtmContent: number; attributed: number; bySource: AttributionResult['bySource'] } {
  const rows = new Map<string, { creativeId: number; day: string; orders: number; netRevenueCents: number }>()
  const unmatched: AttributionResult['unmatched'] = []
  const bySource: AttributionResult['bySource'] = { note_attribute: 0, order_attribution: 0, landing_site: 0, journey: 0 }
  let noUtmContent = 0
  let attributed = 0
  for (const o of orders) {
    if (!o.utmContent || !o.source) { noUtmContent++; continue }
    const id = resolveCreativeId(index, [o.utmContent])
    if (id == null) { unmatched.push({ order: o.order, utmContent: o.utmContent, source: o.source }); continue }
    attributed++
    bySource[o.source]++
    const k = `${id}|${o.day}`
    const cur = rows.get(k) ?? { creativeId: id, day: o.day, orders: 0, netRevenueCents: 0 }
    cur.orders += 1
    cur.netRevenueCents += o.netRevenueCents
    rows.set(k, cur)
  }
  return { rows, unmatched, noUtmContent, attributed, bySource }
}

/**
 * Attribute paid Shopify orders since `sinceDay` (UTC) to creatives.
 *
 * FIELD READ, in order: the order's note attribute `_utm_content` (the cart
 * stamps it from the visitor's cookie, see attribution-cart.server.ts), then
 * order_attribution.utm_content, then `utm_content` in
 * order_attribution.landing_site, then in the customer journey's first or last
 * landing page. The value resolves to a creative through its
 * export_payload.destination_url utm_content, its external_ad_id, or its id.
 * An order with no utm_content is counted in `noUtmContent` and attributed to
 * nothing; an order whose utm_content matches no creative is returned in
 * `unmatched`. Neither is guessed at or folded into a creative.
 *
 * NET REVENUE: Shopify's currentSubtotalPrice, which is line items after
 * discounts and refunds, excluding shipping, duties and tax.
 *
 * The written rows (platform shopify, source shopify) are recomputed for the
 * whole window each run: rows for (creative, day) pairs that no longer have
 * orders in the window are removed, so a refund or a corrected attribute
 * cannot leave a stale order behind.
 */
export async function attributeShopifyOrders(sinceDay: string): Promise<AttributionResult> {
  const [nodes, index] = await Promise.all([fetchOrders(sinceDay), loadCreativeIndex()])
  const ids = nodes.map(n => n.id.replace('gid://shopify/Order/', ''))
  const stored = new Map<string, { utmContent: string | null; landingSite: string | null }>()
  for (const part of chunk(ids, 200)) {
    if (!part.length) continue
    const rows = await db
      .select({ id: orderAttribution.shopifyOrderId, utm: orderAttribution.utmContent, landing: orderAttribution.landingSite })
      .from(orderAttribution)
      .where(inArray(orderAttribution.shopifyOrderId, part))
    for (const r of rows) stored.set(r.id, { utmContent: r.utm, landingSite: r.landing })
  }

  const attributedOrders: AttributedOrder[] = nodes.map(n => {
    const id = n.id.replace('gid://shopify/Order/', '')
    const s = stored.get(id)
    const found = extractOrderUtmContent({
      customAttributes: n.customAttributes,
      storedUtmContent: s?.utmContent ?? null,
      storedLandingSite: s?.landingSite ?? null,
      journeyLandingPages: [n.customerJourneySummary?.firstVisit?.landingPage, n.customerJourneySummary?.lastVisit?.landingPage],
    })
    return {
      order: n.name,
      day: n.createdAt.slice(0, 10),
      utmContent: found?.value ?? null,
      source: found?.source ?? null,
      netRevenueCents: netRevenueCents({ subtotal: n.currentSubtotalPriceSet?.shopMoney?.amount ?? null }),
    }
  })
  const folded = foldAttribution(attributedOrders, index)

  const existing = await db
    .select({ id: adCreativeDailyMetrics.id, creativeId: adCreativeDailyMetrics.creativeId, day: adCreativeDailyMetrics.day })
    .from(adCreativeDailyMetrics)
    .where(and(eq(adCreativeDailyMetrics.platform, 'shopify'), gte(adCreativeDailyMetrics.day, sinceDay)))
  const stale = existing.filter(e => !folded.rows.has(`${e.creativeId}|${e.day}`)).map(e => e.id)
  for (const part of chunk(stale, 200)) {
    if (part.length) await db.delete(adCreativeDailyMetrics).where(inArray(adCreativeDailyMetrics.id, part))
  }

  const toWrite = [...folded.rows.values()]
  for (const part of chunk(toWrite, 100)) {
    if (!part.length) continue
    await db
      .insert(adCreativeDailyMetrics)
      .values(part.map(r => ({
        creativeId: r.creativeId, day: r.day, platform: 'shopify', spendCents: 0,
        orders: r.orders, netRevenueCents: r.netRevenueCents, source: 'shopify',
      })))
      .onConflictDoUpdate({
        target: [adCreativeDailyMetrics.creativeId, adCreativeDailyMetrics.day, adCreativeDailyMetrics.platform],
        set: { orders: sql`excluded.orders`, netRevenueCents: sql`excluded.net_revenue_cents`, source: sql`excluded.source` },
      })
  }

  return {
    sinceDay,
    ordersScanned: nodes.length,
    attributed: folded.attributed,
    noUtmContent: folded.noUtmContent,
    unmatched: folded.unmatched,
    bySource: folded.bySource,
    creativesTouched: new Set(toWrite.map(r => r.creativeId)).size,
    rowsWritten: toWrite.length,
    rowsRemoved: stale.length,
  }
}

// ---------------------------------------------------------------------------
// Rollup to daily_profit_summary.ad_spend
// ---------------------------------------------------------------------------

export interface RollupResult {
  day: string
  spendCents: number
  /** True when ad_spend was written. */
  written: boolean
  reason?: 'no_summary_row' | 'unchanged'
}

/**
 * Sum the day's spend across every row (creative and account level, every
 * platform) and write it to daily_profit_summary.ad_spend, the column nothing
 * wrote before. Only that column is touched. The summary row is created by the
 * 00:05 UTC profit cron; a day without one is reported (`no_summary_row`)
 * rather than inserted half-empty, and a later rollup picks it up.
 */
export async function rollupDaily(day: string): Promise<RollupResult> {
  const [sumRow] = await db
    .select({ spend: sql<number>`coalesce(sum(${adCreativeDailyMetrics.spendCents}), 0)::int` })
    .from(adCreativeDailyMetrics)
    .where(eq(adCreativeDailyMetrics.day, day))
  const spendCents = sumRow?.spend ?? 0
  const [existing] = await db
    .select({ day: dailyProfitSummary.summaryDate, adSpend: dailyProfitSummary.adSpend })
    .from(dailyProfitSummary)
    .where(eq(dailyProfitSummary.summaryDate, day))
  if (!existing) return { day, spendCents, written: false, reason: 'no_summary_row' }
  const next = (spendCents / 100).toFixed(2)
  if (Number(existing.adSpend) === Number(next)) return { day, spendCents, written: false, reason: 'unchanged' }
  await db.update(dailyProfitSummary).set({ adSpend: next }).where(eq(dailyProfitSummary.summaryDate, day))
  return { day, spendCents, written: true }
}

/** Roll up every day from `fromDay` that has metrics. Run once after the first Shop history import. */
export async function backfillAdSpend(fromDay: string): Promise<{ fromDay: string; days: RollupResult[]; written: number; skipped: number }> {
  const rows = await db
    .selectDistinct({ day: adCreativeDailyMetrics.day })
    .from(adCreativeDailyMetrics)
    .where(gte(adCreativeDailyMetrics.day, fromDay))
    .orderBy(asc(adCreativeDailyMetrics.day))
  const days: RollupResult[] = []
  for (const r of rows) days.push(await rollupDaily(r.day))
  return { fromDay, days, written: days.filter(d => d.written).length, skipped: days.filter(d => !d.written).length }
}

/** The routine's Pass 2 entry point: attribute yesterday and today, then roll both up. */
export async function runDailyMetrics(now: Date = new Date()) {
  const today = todayUtc(now)
  const yesterday = addDays(today, -1)
  const attribution = await attributeShopifyOrders(yesterday)
  const rollup = [await rollupDaily(yesterday), await rollupDaily(today)]
  return { today, yesterday, attribution, rollup, importMeta: 'not_configured' as const }
}

// ---------------------------------------------------------------------------
// Summaries and the Live feed
// ---------------------------------------------------------------------------

export interface CreativeSummary {
  creativeId: number
  lookbackDays: number
  spendCents: number
  impressions: number
  clicks: number
  ctrPct: number | null
  orders: number
  netRevenueCents: number
  netRoas: number | null
  breakEven: BreakEven
  daily: Array<{ day: string; spendCents: number; orders: number; netRevenueCents: number }>
}

function windowFrom(lookbackDays: number, now: Date): string {
  return addDays(todayUtc(now), -(Math.max(1, lookbackDays) - 1))
}

export async function creativeSummaries(creativeIds: number[], lookbackDays: number, now: Date = new Date()): Promise<CreativeSummary[]> {
  if (!creativeIds.length) return []
  const from = windowFrom(lookbackDays, now)
  const [rows, breakEven] = await Promise.all([
    db.select().from(adCreativeDailyMetrics).where(and(inArray(adCreativeDailyMetrics.creativeId, creativeIds), gte(adCreativeDailyMetrics.day, from))),
    currentBreakEven(now),
  ])
  return creativeIds.map(id => {
    const mine = rows.filter(r => r.creativeId === id)
    const byDay = new Map<string, { day: string; spendCents: number; orders: number; netRevenueCents: number }>()
    const t: WindowTotals = { spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0 }
    for (const r of mine) {
      t.spendCents += r.spendCents; t.impressions += r.impressions; t.clicks += r.clicks; t.orders += r.orders; t.netRevenueCents += r.netRevenueCents
      const d = byDay.get(r.day) ?? { day: r.day, spendCents: 0, orders: 0, netRevenueCents: 0 }
      d.spendCents += r.spendCents; d.orders += r.orders; d.netRevenueCents += r.netRevenueCents
      byDay.set(r.day, d)
    }
    return {
      creativeId: id, lookbackDays, ...t,
      ctrPct: ctrPct(t.clicks, t.impressions),
      netRoas: netRoas(t.netRevenueCents, t.spendCents),
      breakEven,
      daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    }
  })
}

export async function creativeSummary(creativeId: number, lookbackDays: number, now: Date = new Date()): Promise<CreativeSummary> {
  return (await creativeSummaries([creativeId], lookbackDays, now))[0]!
}

export interface LiveFilters {
  filter?: 'needs-action' | 'all'
  lane?: string | null
  platform?: string | null
  lookbackDays?: 7 | 30
  source?: LiveSource
  now?: Date
}

type EventRow = typeof adRuleEvents.$inferSelect

/** Manual and engine actions that change paused state, replayed in id order. Undone rows are skipped. */
export function replayPaused(events: Array<Pick<EventRow, 'id' | 'ruleId' | 'action' | 'appliedAt' | 'detail' | 'creativeId'>>): { paused: Set<string>; resumed: Set<string>; resolved: Set<string> } {
  const applied = events.filter(e => e.appliedAt != null).sort((a, b) => a.id - b.id)
  const undone = new Set<number>()
  for (const e of applied) {
    if (e.action === 'undo') {
      const u = (e.detail as { undoes?: number } | null)?.undoes
      if (typeof u === 'number') undone.add(u)
    }
  }
  const state = new Map<string, boolean>()
  const resolved = new Set<string>()
  for (const e of applied) {
    if (undone.has(e.id) || e.action === 'undo') continue
    const d = (e.detail ?? {}) as { sample?: boolean; key?: string }
    const key = d.sample && d.key ? d.key : e.creativeId != null ? String(e.creativeId) : null
    if (key == null) continue
    if (e.action !== 'pause' && e.action !== 'resume') { resolved.add(key); continue }
    state.set(key, e.action === 'pause')
  }
  const paused = new Set<string>()
  const resumed = new Set<string>()
  for (const [k, v] of state) (v ? paused : resumed).add(k)
  return { paused, resumed, resolved }
}

export function ruleSentence(ruleId: string, w: WindowTotals, lookbackDays: number, be: BreakEven): string {
  const roas = formatRoas(netRoas(w.netRevenueCents, w.spendCents))
  const win = `${lookbackDays}d`
  switch (ruleId) {
    case 'R1': return `Pause: ${formatMoney(w.spendCents)} spent, ${w.orders} orders, R1`
    case 'R2': return `Pause: ${w.impressions.toLocaleString('en-US')} impressions at ${(ctrPct(w.clicks, w.impressions) ?? 0).toFixed(2)}% CTR, R2`
    case 'R3': return `Pause: ${roas} net ROAS against ${formatRoas(be.roas)} break-even over ${win}, R3`
    case 'R4': return `Revive: a late order brought net ROAS to ${roas} over ${win}, R4`
    case 'R5': return `Scale: ${roas} net ROAS on ${w.orders} orders over ${win}, R5`
    case 'R6': return `Brake: ${roas} net ROAS under ${formatRoas(be.roas)} break-even over ${win}, R6`
    case 'R7': return `R7 paused all: today's spend passed the daily cap`
    case 'R8': return `Refresh: reach is wearing out, R8`
    default: return `${ruleId} fired`
  }
}

const SHOP_HISTORY_DAYS = 90

async function shopHistory(now: Date): Promise<ShopHistoryDay[]> {
  const from = addDays(todayUtc(now), -SHOP_HISTORY_DAYS)
  const rows = await db
    .select({
      day: adCreativeDailyMetrics.day,
      platform: adCreativeDailyMetrics.platform,
      spend: sql<number>`sum(${adCreativeDailyMetrics.spendCents})::int`,
      impressions: sql<number>`sum(${adCreativeDailyMetrics.impressions})::int`,
      clicks: sql<number>`sum(${adCreativeDailyMetrics.clicks})::int`,
    })
    .from(adCreativeDailyMetrics)
    .where(and(eq(adCreativeDailyMetrics.platform, 'shop'), gte(adCreativeDailyMetrics.day, from)))
    .groupBy(adCreativeDailyMetrics.day, adCreativeDailyMetrics.platform)
    .orderBy(desc(adCreativeDailyMetrics.day))
  return rows.map(r => ({ day: r.day, platform: r.platform, spendCents: r.spend, impressions: r.impressions, clicks: r.clicks, ctrPct: ctrPct(r.clicks, r.impressions) }))
}

/** Which sources have data, so the loader can default to something real and the empty state can say what exists. */
export async function liveSourceCounts(now: Date = new Date()): Promise<{ live: number; shopHistory: number }> {
  const from = addDays(todayUtc(now), -90)
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adCreativeDailyMetrics)
    .where(and(gte(adCreativeDailyMetrics.day, from), sql`${adCreativeDailyMetrics.creativeId} is not null`, sql`${adCreativeDailyMetrics.platform} <> 'shopify'`))
  const [shop] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adCreativeDailyMetrics)
    .where(and(gte(adCreativeDailyMetrics.day, from), eq(adCreativeDailyMetrics.platform, 'shop')))
  return { live: live?.n ?? 0, shopHistory: shop?.n ?? 0 }
}

async function loadEvents(now: Date): Promise<EventRow[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000)
  return db.select().from(adRuleEvents).where(gte(adRuleEvents.firedAt, since)).orderBy(asc(adRuleEvents.id))
}

export async function liveFeed(f: LiveFilters = {}): Promise<LiveFeed> {
  const now = f.now ?? new Date()
  const lookbackDays = f.lookbackDays === 30 ? 30 : 7
  const source: LiveSource = f.source ?? 'live'
  const breakEven = await currentBreakEven(now)
  const from = windowFrom(lookbackDays, now)
  const today = todayUtc(now)

  if (source === 'sample') {
    const events = await loadEvents(now).catch(() => [] as EventRow[])
    const { paused, resumed, resolved } = replayPaused(events.filter(e => (e.detail as { sample?: boolean } | null)?.sample))
    const feed = buildSampleFeed({ lookbackDays, breakEven, pausedKeys: paused, resumedKeys: resumed, resolvedKeys: resolved })
    return applyFilters(feed, f)
  }

  if (source === 'shop-history') {
    const days = await shopHistory(now)
    const inWindow = days.filter(d => d.day >= from)
    const spend = inWindow.reduce((s, d) => s + d.spendCents, 0)
    const band: LiveBand = {
      lookbackDays, spendCents: spend, orders: 0, netRevenueCents: 0, netRoas: null, rulesFiredToday: 0,
      series: [...inWindow].sort((a, b) => a.day.localeCompare(b.day)).map(d => ({ at: d.day, value: d.spendCents / 100 })),
    }
    return { source, sample: false, lookbackDays, breakEven, band, rows: [], needsAction: 0, total: 0, shopHistory: days, empty: days.length === 0 }
  }

  const [metrics, creatives, events] = await Promise.all([
    db.select().from(adCreativeDailyMetrics).where(gte(adCreativeDailyMetrics.day, from)),
    db
      .select({
        id: adCreatives.id, slogan: adCreatives.slogan, hookCopy: adCreatives.hookCopy, lane: adCreatives.lane,
        registerTier: adCreatives.registerTier, pausedAt: adCreatives.pausedAt, thumb: mediaAssets.blobUrl, campaignPlatform: adCampaigns.platform,
      })
      .from(adCreatives)
      .leftJoin(mediaAssets, eq(mediaAssets.id, adCreatives.assetId))
      .leftJoin(adCampaigns, eq(adCampaigns.id, adCreatives.adCampaignId)),
    loadEvents(now),
  ])

  const byCreative = new Map<number, typeof metrics>()
  for (const m of metrics) {
    if (m.creativeId == null) continue
    const arr = byCreative.get(m.creativeId) ?? []
    arr.push(m)
    byCreative.set(m.creativeId, arr)
  }
  const { paused, resumed } = replayPaused(events.filter(e => !(e.detail as { sample?: boolean } | null)?.sample))
  const pending = new Map<number, EventRow>()
  for (const e of events) {
    if (e.creativeId == null || e.appliedAt != null || e.ruleId === 'MAN' || e.action === 'undo') continue
    pending.set(e.creativeId, e) // later id wins
  }

  const rows: LiveRow[] = []
  for (const c of creatives) {
    const mine = byCreative.get(c.id) ?? []
    const ev = pending.get(c.id)
    if (!mine.length && !ev) continue
    const w: WindowTotals = { spendCents: 0, impressions: 0, clicks: 0, orders: 0, netRevenueCents: 0 }
    const spendByPlatform = new Map<string, number>()
    for (const m of mine) {
      w.spendCents += m.spendCents; w.impressions += m.impressions; w.clicks += m.clicks; w.orders += m.orders; w.netRevenueCents += m.netRevenueCents
      if (m.platform !== 'shopify') spendByPlatform.set(m.platform, (spendByPlatform.get(m.platform) ?? 0) + m.spendCents)
    }
    const platform = [...spendByPlatform.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? c.campaignPlatform ?? c.lane ?? 'unknown'
    const isPaused = paused.has(String(c.id)) || (c.pausedAt != null && !resumed.has(String(c.id)))
    let firing: RuleFiring | null = null
    if (ev) {
      const detail = (ev.detail ?? {}) as { sentence?: string }
      firing = {
        ruleId: ev.ruleId,
        sentence: detail.sentence ?? ruleSentence(ev.ruleId, w, lookbackDays, breakEven),
        recommendation: RULE_RECOMMENDATION[ev.ruleId] ?? 'healthy',
        eventId: ev.id,
        firedAt: ev.firedAt.toISOString(),
        applied: false,
      }
    }
    const firedToday = !!ev && ev.firedAt.toISOString().slice(0, 10) === today
    rows.push(rowFromWindow({
      key: String(c.id), creativeId: c.id, label: `#${c.id}`, slogan: c.slogan ?? c.hookCopy ?? null, thumbUrl: c.thumb ?? null,
      lane: c.lane ?? 'owned', registerTier: c.registerTier ?? '', platform, sample: false,
    }, w, lookbackDays, breakEven, firing, isPaused, firedToday))
  }

  const windowRows = metrics
  const spend = windowRows.reduce((s, m) => s + m.spendCents, 0)
  const orders = windowRows.reduce((s, m) => s + m.orders, 0)
  const net = windowRows.reduce((s, m) => s + m.netRevenueCents, 0)
  const spendByDay = new Map<string, number>()
  for (const m of windowRows) spendByDay.set(m.day, (spendByDay.get(m.day) ?? 0) + m.spendCents)
  const series = [...spendByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([at, v]) => ({ at, value: v / 100 }))
  const rulesFiredToday = events.filter(e => e.ruleId !== 'MAN' && e.action !== 'undo' && e.firedAt.toISOString().slice(0, 10) === today).length

  const sorted = sortRows(rows)
  const feed: LiveFeed = {
    source: 'live', sample: false, lookbackDays, breakEven,
    band: { lookbackDays, spendCents: spend, orders, netRevenueCents: net, netRoas: netRoas(net, spend), rulesFiredToday, series },
    rows: sorted, needsAction: sorted.filter(needsAction).length, total: sorted.length, shopHistory: [], empty: sorted.length === 0,
  }
  return applyFilters(feed, f)
}

/** Lane, platform and needs-action filters. Counts on the segmented control stay unfiltered by the segment. */
export function applyFilters(feed: LiveFeed, f: LiveFilters): LiveFeed {
  let rows = feed.rows
  if (f.lane) rows = rows.filter(r => r.lane === f.lane)
  if (f.platform) rows = rows.filter(r => r.platform === f.platform)
  const needs = rows.filter(needsAction).length
  const total = rows.length
  if ((f.filter ?? 'needs-action') === 'needs-action') rows = rows.filter(needsAction)
  return { ...feed, rows, needsAction: needs, total }
}

export function liveFacets(feed: LiveFeed): { lanes: string[]; platforms: string[] } {
  return {
    lanes: [...new Set(feed.rows.map(r => r.lane))].sort(),
    platforms: [...new Set(feed.rows.map(r => r.platform))].sort(),
  }
}

// ---------------------------------------------------------------------------
// Live actions (simulation: write ad_rule_events only, no platform call)
// ---------------------------------------------------------------------------

const ACTION_VERB: Record<LiveActionKind, string> = { pause: 'pause', resume: 'resume', scale: 'scale_up', brake: 'scale_down', refresh: 'refresh' }

export interface LiveActionInput {
  /** A creative id as a string, or `sample:S1` for the sample dataset. */
  key: string
  kind: LiveActionKind
  /** The recommended rule's id when the tap follows a recommendation, else MAN. */
  ruleId?: string | null
  /** The pending recommendation event this tap resolves, if any. */
  resolvesEventId?: number | null
  appliedBy: string
}

export interface LiveActionResult { eventId: number; simulated: true; message: string; sample: boolean }

export function isLiveActionKind(v: unknown): v is LiveActionKind {
  return v === 'pause' || v === 'resume' || v === 'scale' || v === 'brake' || v === 'refresh'
}

/**
 * Pause, Resume, Scale, Brake and Refresh in this PR only record the decision:
 * one ad_rule_events row with action and applied_by, no platform call. PR-H
 * wires the rules engine and the real platform calls behind these same verbs.
 */
export async function recordLiveAction(input: LiveActionInput): Promise<LiveActionResult> {
  const sample = input.key.startsWith('sample:')
  const creativeId = sample ? null : Number(input.key)
  if (!sample && !(Number.isInteger(creativeId) && (creativeId as number) > 0)) throw new AdMetricsError('Unknown creative.', 'bad_request')
  const ruleId = (input.ruleId && /^R[1-8]$/.test(input.ruleId) ? input.ruleId : 'MAN')
  const now = new Date()
  const detail = {
    simulation: true,
    ...(sample ? { sample: true, key: input.key.slice('sample:'.length) } : {}),
    ...(input.resolvesEventId ? { resolves: input.resolvesEventId } : {}),
  }
  const [row] = await db
    .insert(adRuleEvents)
    .values({ ruleId, creativeId, action: ACTION_VERB[input.kind], detail, appliedBy: input.appliedBy, appliedAt: now })
    .returning({ id: adRuleEvents.id })
  if (!row) throw new AdMetricsError('Could not record the action.', 'write_failed')
  if (input.resolvesEventId && !sample) {
    await db.update(adRuleEvents).set({ appliedBy: input.appliedBy, appliedAt: now }).where(and(eq(adRuleEvents.id, input.resolvesEventId), isNull(adRuleEvents.appliedAt)))
  }
  const noun = sample ? input.key.slice('sample:'.length) : `#${input.key}`
  const messages: Record<LiveActionKind, string> = {
    pause: `Paused ${noun} in simulation. Nothing was live.`,
    resume: `Resumed ${noun} in simulation. Nothing was live.`,
    scale: `Scaled ${noun} budget 20% in simulation.`,
    brake: `Braked ${noun} budget 30% in simulation.`,
    refresh: `Refresh queued for ${noun} on the next render pass.`,
  }
  return { eventId: row.id, simulated: true, message: messages[input.kind], sample }
}

/** Undo writes an `undo` row that names the action it reverses, and re-opens the recommendation it resolved. */
export async function undoLiveAction(eventId: number, appliedBy: string): Promise<{ eventId: number }> {
  const [orig] = await db.select().from(adRuleEvents).where(eq(adRuleEvents.id, eventId))
  if (!orig || orig.action === 'undo') throw new AdMetricsError('Nothing to undo.', 'bad_request')
  const [already] = await db
    .select({ id: adRuleEvents.id })
    .from(adRuleEvents)
    .where(and(eq(adRuleEvents.action, 'undo'), sql`${adRuleEvents.detail}->>'undoes' = ${String(eventId)}`))
  if (already) return { eventId: already.id }
  const detail = { simulation: true, undoes: eventId, ...(((orig.detail ?? {}) as { sample?: boolean; key?: string }).sample ? { sample: true, key: (orig.detail as { key?: string }).key } : {}) }
  const [row] = await db
    .insert(adRuleEvents)
    .values({ ruleId: orig.ruleId, creativeId: orig.creativeId, action: 'undo', detail, appliedBy, appliedAt: new Date() })
    .returning({ id: adRuleEvents.id })
  const resolves = (orig.detail as { resolves?: number } | null)?.resolves
  if (resolves) await db.update(adRuleEvents).set({ appliedBy: null, appliedAt: null }).where(eq(adRuleEvents.id, resolves))
  return { eventId: row!.id }
}

export type { Recommendation }
