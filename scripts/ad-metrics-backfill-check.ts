/**
 * READ-ONLY check of what attributeShopifyOrders would do, and what the ad_spend
 * column reads today (Ad Studio v2 PR-G). Nothing is written: Shopify is read
 * through the Admin GraphQL API and the database only through SELECTs.
 *
 *   npx tsx --env-file=.env scripts/ad-metrics-backfill-check.ts --since 2026-09-30
 *
 * Reports, for paid orders since --since:
 *   - how many orders there are,
 *   - how many carry any utm_content, by the field it came from,
 *   - how many of those map to an ad_creatives row,
 *   - the utm_content values that map to nothing,
 *   - what daily_profit_summary.ad_spend currently reads for those days.
 */
import { and, asc, gte, inArray } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { adminGraphQL } from '../app/lib/shopify.server'
import { adCreatives, dailyProfitSummary, orderAttribution } from '../db/schema'
import { buildCreativeIndex, extractOrderUtmContent, netRevenueCents, resolveCreativeId } from '../app/lib/ad-metrics-core'

const since = (() => {
  const i = process.argv.indexOf('--since')
  return i > 0 && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[i + 1] ?? '') ? process.argv[i + 1]! : '2026-09-30'
})()

interface Node {
  id: string
  name: string
  createdAt: string
  currentSubtotalPriceSet: { shopMoney: { amount: string } } | null
  totalShippingPriceSet: { shopMoney: { amount: string } } | null
  totalTaxSet: { shopMoney: { amount: string } } | null
  totalPriceSet: { shopMoney: { amount: string } } | null
  customAttributes: Array<{ key: string; value: string }>
  customerJourneySummary?: { firstVisit: { landingPage: string | null } | null; lastVisit: { landingPage: string | null } | null } | null
}

const Q = (journey: boolean) => `
  query($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query) {
      nodes {
        id name createdAt
        currentSubtotalPriceSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalPriceSet { shopMoney { amount } }
        customAttributes { key value }
        ${journey ? 'customerJourneySummary { firstVisit { landingPage } lastVisit { landingPage } }' : ''}
      }
      pageInfo { hasNextPage endCursor }
    }
  }`

async function fetchOrders(): Promise<{ nodes: Node[]; journey: boolean }> {
  let journey = true
  const out: Node[] = []
  let after: string | null = null
  for (let page = 0; page < 60; page++) {
    let res: { orders: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }
    try {
      res = await adminGraphQL(Q(journey), { query: `created_at:>='${since}T00:00:00Z' financial_status:paid status:any`, first: 50, after })
    } catch (err) {
      if (journey && page === 0) { journey = false; page--; continue }
      throw err
    }
    out.push(...res.orders.nodes)
    after = res.orders.pageInfo.hasNextPage ? res.orders.pageInfo.endCursor : null
    if (!after) break
  }
  return { nodes: out, journey }
}

async function main() {
  console.log(`[ad-metrics-backfill-check] READ ONLY. since ${since}`)
  const { nodes, journey } = await fetchOrders()
  console.log(`orders (paid, since ${since}): ${nodes.length}  (customer journey field ${journey ? 'available' : 'NOT available, skipped'})`)

  const ids = nodes.map(n => n.id.replace('gid://shopify/Order/', ''))
  const stored = new Map<string, { utm: string | null; landing: string | null; source: string | null; medium: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    if (!part.length) continue
    const rows = await db
      .select({ id: orderAttribution.shopifyOrderId, utm: orderAttribution.utmContent, landing: orderAttribution.landingSite, source: orderAttribution.utmSource, medium: orderAttribution.utmMedium })
      .from(orderAttribution)
      .where(inArray(orderAttribution.shopifyOrderId, part))
    for (const r of rows) stored.set(r.id, r)
  }
  console.log(`order_attribution rows covering those orders: ${stored.size}`)

  let index = buildCreativeIndex([])
  let creativeCount = 0
  try {
    const rows = await db.select({ id: adCreatives.id, externalAdId: adCreatives.externalAdId, exportPayload: adCreatives.exportPayload }).from(adCreatives)
    index = buildCreativeIndex(rows)
    creativeCount = rows.length
  } catch (err) {
    console.log(`ad_creatives v2 columns not readable (migration 114 not applied in this database yet): ${(err as Error).message.slice(0, 120)}`)
    try {
      const rows = await db.select({ id: adCreatives.id }).from(adCreatives)
      creativeCount = rows.length
    } catch { /* table absent */ }
  }
  console.log(`ad_creatives rows: ${creativeCount}; resolvable keys: ${index.byKey.size}`)

  const bySource: Record<string, number> = {}
  const unmatched: Array<{ order: string; utm: string; source: string }> = []
  const utmSources: Record<string, number> = {}
  let withUtm = 0
  let mapped = 0
  let net = 0
  for (const n of nodes) {
    const id = n.id.replace('gid://shopify/Order/', '')
    const s = stored.get(id)
    const src = n.customAttributes.find(a => a.key === '_utm_source')?.value ?? s?.source ?? '(none)'
    utmSources[src] = (utmSources[src] ?? 0) + 1
    const found = extractOrderUtmContent({
      customAttributes: n.customAttributes,
      storedUtmContent: s?.utm ?? null,
      storedLandingSite: s?.landing ?? null,
      journeyLandingPages: [n.customerJourneySummary?.firstVisit?.landingPage, n.customerJourneySummary?.lastVisit?.landingPage],
    })
    net += netRevenueCents({ subtotal: n.currentSubtotalPriceSet?.shopMoney?.amount ?? null })
    if (!found) continue
    withUtm++
    bySource[found.source] = (bySource[found.source] ?? 0) + 1
    if (resolveCreativeId(index, [found.value]) != null) mapped++
    else unmatched.push({ order: n.name, utm: found.value, source: found.source })
  }
  console.log(`orders carrying any utm_content: ${withUtm}  by field: ${JSON.stringify(bySource)}`)
  console.log(`orders mapping to a creative: ${mapped}`)
  console.log(`utm_content that maps to nothing: ${unmatched.length} ${JSON.stringify(unmatched.slice(0, 20))}`)
  console.log(`_utm_source mix across all orders: ${JSON.stringify(utmSources)}`)
  console.log(`net revenue (subtotal after discounts, excl. shipping and tax) across the window: $${(net / 100).toFixed(2)}`)

  const days = await db
    .select({ day: dailyProfitSummary.summaryDate, orders: dailyProfitSummary.totalOrders, adSpend: dailyProfitSummary.adSpend })
    .from(dailyProfitSummary)
    .where(and(gte(dailyProfitSummary.summaryDate, since)))
    .orderBy(asc(dailyProfitSummary.summaryDate))
  console.log(`daily_profit_summary rows since ${since}: ${days.length}`)
  for (const d of days) console.log(`  ${d.day}  orders=${d.orders}  ad_spend=${d.adSpend}`)
  const nonzero = days.filter(d => Number(d.adSpend) > 0).length
  console.log(`days with non-zero ad_spend: ${nonzero} of ${days.length}`)
}

main().then(() => process.exit(0)).catch(err => { console.error('[ad-metrics-backfill-check] failed:', err instanceof Error ? err.message : err); process.exit(1) })
