/**
 * sync-lapsed-sale-costs.ts
 *
 * One-off cleanup for the pricing audit of 2026-10-15. The Nalpac Integration
 * app writes a Nalpac sale cost into Shopify's inventoryItem.unitCost when a
 * SKU goes on an "N% Off Sale" promo, and never raises it back when the promo
 * ends. The engine priced off that lapsed cost, so some variants now sell at
 * or below what Nalpac actually charges. The engine itself now prefers the
 * feed cost in that case (app/lib/engine-cost.ts); this script repairs the
 * Shopify cost field and reprices.
 *
 * Lists every variant whose unit cost is below today's Nalpac list wholesale
 * by more than 2%, classified as:
 *   lapsed        not in the sale feed today. The unit cost is a dead promo
 *                 cost. --apply writes the list wholesale to unitCost and
 *                 reprices through recomputeVariant.
 *   live_sale     tagged "N% Off Sale" today and the unit cost matches that
 *                 discount. The account's real cost; left alone.
 *   sale_mismatch tagged on sale today, but the unit cost is below even the
 *                 sale cost (an older, deeper promo). Reported only.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 *
 * MONEY NOTE: pricing_approval_mode is 'aggressive', so every reprice --apply
 * triggers auto-applies up to the mode's delta threshold without queueing.
 * Applying moves live prices. It is an owner call.
 *
 * Usage:
 *   npx tsx scripts/sync-lapsed-sale-costs.ts                    # dry run, summary + CSV
 *   npx tsx scripts/sync-lapsed-sale-costs.ts --csv=out.csv
 *   npx tsx scripts/sync-lapsed-sale-costs.ts --apply --limit=5  # canary
 *   npx tsx scripts/sync-lapsed-sale-costs.ts --apply --sku=95230
 *   npx tsx scripts/sync-lapsed-sale-costs.ts --apply            # every lapsed row
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { adminGraphQL, bulkFetchProductsForPricing } from '../app/lib/shopify.server'
import { fetchAllNalpacFeeds } from '../app/lib/nalpac-feeds.server'
import { recomputeVariant } from '../app/lib/pricing-apply-v2.server'
import { STALE_COST_TOLERANCE } from '../app/lib/engine-cost'

const args = process.argv.slice(2)
const flag = (name: string) => args.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
const flagValue = (name: string) => flag(name)?.split('=').slice(1).join('=') || null

const APPLY = flag('apply') != null
const LIMIT = flagValue('limit') ? parseInt(flagValue('limit')!, 10) : Infinity
const ONLY_SKU = flagValue('sku')
const CSV_PATH = flagValue('csv') ?? `stale-cost-dry-run-${new Date().toISOString().slice(0, 10)}.csv`
const WRITE_PACING_MS = 300

type Kind = 'lapsed' | 'live_sale' | 'sale_mismatch'

interface Row {
  kind: Kind
  sku: string
  title: string
  productType: string | null
  discontinued: boolean
  variantId: string
  inventoryItemId: string | null
  unitCost: number
  feedWholesale: number
  salePct: number | null
  ratio: number
  price: number
  marginAtFeedCost: number
  feedQty: number | null
}

/** "40% Off Sale" in Main Category / Sub-Category -> 0.40. */
function saleTagPct(row: Record<string, string> | undefined): number | null {
  if (!row) return null
  const text = `${row['Main Category'] ?? ''},${row['Sub-Category'] ?? ''}`
  const m = text.match(/(\d{1,2})%\s*Off\s*Sale/i)
  return m ? parseInt(m[1]!, 10) / 100 : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function setUnitCost(inventoryItemId: string, cost: number): Promise<void> {
  const data = await adminGraphQL<{
    inventoryItemUpdate: { inventoryItem: { id: string } | null; userErrors: { message: string }[] }
  }>(
    `mutation SetCost($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem { id }
        userErrors { message }
      }
    }`,
    { id: inventoryItemId, input: { cost: cost.toFixed(2) } },
  )
  const errs = data.inventoryItemUpdate.userErrors
  if (errs.length) throw new Error(errs.map(e => e.message).join('; '))
}

async function main() {
  console.log(`[stale-cost] mode: ${APPLY ? 'APPLY' : 'dry run'}`)
  const [feed, products] = await Promise.all([
    fetchAllNalpacFeeds(),
    bulkFetchProductsForPricing(),
  ])
  console.log(`[stale-cost] feed: ${feed.snapshots.size} skus (${feed.counts.sale} on sale); shopify: ${products.length} products`)

  const rows: Row[] = []
  let variantsChecked = 0
  let feedMatched = 0

  for (const p of products) {
    const discontinued = p.metafields.discontinuedAt != null || p.productType === 'Discontinued'
    for (const v of p.variants) {
      variantsChecked++
      if (ONLY_SKU && v.sku !== ONLY_SKU) continue
      const snap = feed.snapshots.get(v.sku)
      if (!snap || !(snap.wholesale > 0) || v.unitCost == null) continue
      feedMatched++
      if (v.unitCost >= snap.wholesale * STALE_COST_TOLERANCE) continue

      const salePct = snap.inSaleFeed ? saleTagPct(snap.raw.saleRow ?? snap.raw.mainRow) : null
      let kind: Kind = 'lapsed'
      if (snap.inSaleFeed) {
        const saleCost = salePct != null ? snap.wholesale * (1 - salePct) : null
        kind = saleCost == null || v.unitCost >= saleCost * STALE_COST_TOLERANCE ? 'live_sale' : 'sale_mismatch'
      }

      rows.push({
        kind,
        sku: v.sku,
        title: p.title,
        productType: p.productType,
        discontinued,
        variantId: v.variantId,
        inventoryItemId: v.inventoryItemId,
        unitCost: v.unitCost,
        feedWholesale: snap.wholesale,
        salePct,
        ratio: round2(v.unitCost / snap.wholesale),
        price: v.price,
        marginAtFeedCost: v.price > 0 ? (v.price - snap.wholesale) / v.price : 0,
        feedQty: snap.qty,
      })
    }
  }

  // Summary
  const byKind = (k: Kind) => rows.filter(r => r.kind === k)
  const lapsed = byKind('lapsed')
  const atOrBelowCost = lapsed.filter(r => r.price <= r.feedWholesale)
  const ratioClusters = new Map<number, number>()
  for (const r of lapsed) ratioClusters.set(r.ratio, (ratioClusters.get(r.ratio) ?? 0) + 1)
  const topRatios = [...ratioClusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  console.log('')
  console.log(`variants checked:               ${variantsChecked}`)
  console.log(`with a feed row + unit cost:    ${feedMatched}`)
  console.log(`unit cost < feed wholesale*${STALE_COST_TOLERANCE}: ${rows.length}`)
  console.log(`  live_sale (kept):             ${byKind('live_sale').length}`)
  console.log(`  sale_mismatch (report only):  ${byKind('sale_mismatch').length}`)
  console.log(`  lapsed (--apply target):      ${lapsed.length}`)
  console.log(`    of which discontinued:      ${lapsed.filter(r => r.discontinued).length}`)
  console.log(`    priced at/below feed cost:  ${atOrBelowCost.length} (${atOrBelowCost.filter(r => (r.feedQty ?? 0) > 0).length} with Nalpac stock)`)
  console.log(`    ratio clusters:             ${topRatios.map(([r, n]) => `${r.toFixed(2)}x${n}`).join(', ')}`)
  console.log('')
  console.log('worst 10 lapsed by margin at feed cost:')
  for (const r of [...lapsed].sort((a, b) => a.marginAtFeedCost - b.marginAtFeedCost).slice(0, 10)) {
    console.log(`  ${r.sku.padEnd(10)} unit ${r.unitCost.toFixed(2).padStart(7)}  feed ${r.feedWholesale.toFixed(2).padStart(7)}  price ${r.price.toFixed(2).padStart(7)}  margin ${(r.marginAtFeedCost * 100).toFixed(0).padStart(4)}%  ${r.discontinued ? 'disc' : ''}`)
  }

  const header = 'kind,sku,product_type,discontinued,unit_cost,feed_wholesale,sale_pct,ratio,price,margin_at_feed_cost,feed_qty,variant_id,title'
  const csv = [header, ...rows.map(r => [
    r.kind, r.sku, JSON.stringify(r.productType ?? ''), r.discontinued, r.unitCost.toFixed(2),
    r.feedWholesale.toFixed(2), r.salePct ?? '', r.ratio.toFixed(2), r.price.toFixed(2),
    r.marginAtFeedCost.toFixed(4), r.feedQty ?? '', r.variantId, JSON.stringify(r.title),
  ].join(','))].join('\n')
  writeFileSync(CSV_PATH, csv + '\n')
  console.log(`\n[stale-cost] wrote ${rows.length} rows to ${CSV_PATH}`)

  if (!APPLY) {
    console.log('[stale-cost] dry run: nothing written. Re-run with --apply to sync lapsed costs and reprice.')
    return
  }

  const targets = lapsed.slice(0, LIMIT)
  console.log(`\n[stale-cost] APPLY: syncing ${targets.length} lapsed variant(s)`)
  const statusCounts = new Map<string, number>()
  let failed = 0
  for (const r of targets) {
    try {
      if (!r.inventoryItemId) throw new Error('no inventory item id')
      await setUnitCost(r.inventoryItemId, r.feedWholesale)
      const res = await recomputeVariant({ variantId: r.variantId, trigger: 'manual' })
      statusCounts.set(res.status, (statusCounts.get(res.status) ?? 0) + 1)
      console.log(`  ${r.sku}: cost ${r.unitCost.toFixed(2)} -> ${r.feedWholesale.toFixed(2)}; reprice ${res.status}${res.applied ? ' (applied)' : ''}${res.error ? ` [${res.error}]` : ''}`)
    } catch (err) {
      failed++
      console.error(`  ${r.sku}: FAILED ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise(res => setTimeout(res, WRITE_PACING_MS))
  }
  console.log(`[stale-cost] done. ${[...statusCounts.entries()].map(([s, n]) => `${s}=${n}`).join(' ')} failed=${failed}`)
}

main().then(
  () => process.exit(0),
  err => { console.error(err); process.exit(1) },
)
