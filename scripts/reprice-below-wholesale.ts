/**
 * Ticket #18016 (relayed from product-manager, weekly strategy run 1663).
 * DRY-RUN BY DEFAULT.
 *
 * Lists every ACTIVE variant whose live Shopify price sits below the feed
 * wholesale cost (xdipx.wholesale_cost metafield) times (1 + the
 * monitor_p2_min_markup_pct floor), using the exact same clamp
 * (enforceWholesaleFloor) the pricing-apply-v2 write path already enforces
 * on every auto-applied price. Evidence (2026-10-26): 244 ACTIVE products,
 * 418 variants, 213 typed Discontinued, and the cohort is growing month over
 * month even though enforceWholesaleFloor shipped as #16352 and sits in the
 * recompute path -- this script is the cheapest way to find out which
 * variants the daily recompute is missing and why (a variant the batch
 * recompute never visits, a cost/markup change since the last recompute, or
 * a manual price edit that bypassed computePrice entirely).
 *
 * The reprice-versus-delist call stays the owner's (blocker #1550, the
 * owner-decision half of #16276): this script only prints a per-row hint
 * (qty > 0 -> reprice candidate, qty 0 -> delist candidate) for the owner to
 * read against the real inventory numbers. It never delists anything.
 *
 * Usage:
 *   npx tsx scripts/reprice-below-wholesale.ts             # dry run, table
 *   npx tsx scripts/reprice-below-wholesale.ts --json      # dry run, JSON
 *   npx tsx scripts/reprice-below-wholesale.ts --limit 20  # cap rows (table only)
 *   npx tsx scripts/reprice-below-wholesale.ts --apply     # writes the floor price to Shopify
 */
import './_load-env'
import { updateVariantPricing } from '../app/lib/shopify.server'
import { scanRepriceBelowWholesale } from '../app/lib/reprice-below-wholesale-scan.server'

const APPLY = process.argv.includes('--apply')
const AS_JSON = process.argv.includes('--json')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1] ?? '0', 10) || Infinity : Infinity

async function main() {
  const { scannedProducts, variantsScanned, minMarkupPct, rows } = await scanRepriceBelowWholesale()

  if (AS_JSON) {
    console.log(JSON.stringify({
      scannedProducts,
      variantsScanned,
      minMarkupPct,
      violators: rows.length,
      rows,
    }, null, 2))
  } else {
    console.log(`Scanned ${scannedProducts} ACTIVE products with a wholesale_cost metafield (${variantsScanned} variants).`)
    console.log(`Min markup floor: ${(minMarkupPct * 100).toFixed(1)}% (monitor_p2_min_markup_pct)`)
    console.log(`Variants priced below wholesale floor: ${rows.length}`)
    console.log('')
    console.log(
      'SKU'.padEnd(18) + 'PRICE'.padStart(9) + 'COST'.padStart(9) + 'FLOOR'.padStart(9) +
      'MARGIN'.padStart(8) + 'QTY'.padStart(6) + '  REC      TYPE / VENDOR / HANDLE',
    )
    let printed = 0
    for (const r of rows) {
      if (printed >= LIMIT) { console.log(`  ... ${rows.length - printed} more (raise --limit or use --json)`); break }
      printed++
      console.log(
        r.sku.padEnd(18) +
        `$${r.price.toFixed(2)}`.padStart(9) +
        `$${r.wholesaleCost.toFixed(2)}`.padStart(9) +
        `$${r.floorPrice.toFixed(2)}`.padStart(9) +
        `${r.currentMarginPct}%`.padStart(8) +
        `${r.qty}`.padStart(6) +
        `  ${r.recommendation.padEnd(8)} ${r.productType ?? '?'} / ${r.vendor ?? '?'} / ${r.handle}`,
      )
    }
    console.log('')
    console.log('"rec" is a qty-only hint (qty > 0 => reprice, qty 0 => delist); the owner')
    console.log('makes the real reprice-vs-delist call (blocker #1550). This script never')
    console.log('delists anything, and without --apply it never writes to Shopify either.')
  }

  if (!APPLY) {
    console.log(AS_JSON ? '' : '\nDry run only. Re-run with --apply to write the floor price for each row above.')
    return
  }

  console.log(`\nApplying floor price to ${rows.length} variant(s)...`)
  let applied = 0
  let failed = 0
  for (const r of rows) {
    try {
      const newCompare = r.compareAtPrice != null && r.compareAtPrice > r.floorPrice ? String(r.compareAtPrice) : ''
      await updateVariantPricing(r.variantGid, String(r.floorPrice), newCompare)
      applied++
      console.log(`  ok: ${r.sku} ${r.price.toFixed(2)} -> ${r.floorPrice.toFixed(2)}`)
    } catch (err) {
      failed++
      console.error(`  FAILED: ${r.sku}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`\nApplied ${applied} of ${rows.length} (${failed} failed).`)
}

main().catch(err => {
  console.error('reprice-below-wholesale failed:', err)
  process.exit(1)
})
