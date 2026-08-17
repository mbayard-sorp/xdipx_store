/**
 * MAP floor violation report (ticket #3714). READ-ONLY.
 *
 * Lists every variant whose live Shopify price sits below the product's
 * xdipx.map_price metafield, using the exact same Admin API lens the pricing
 * engine reads (bulkFetchProductsForPricing). Writes nothing anywhere; the
 * output is for the owner / pricing-ops to drive fixes, normally by re-running
 * the batch recompute now that computePrice clamps MAP after rounding.
 *
 * Usage:
 *   npx tsx scripts/report-below-map.ts            # human-readable table
 *   npx tsx scripts/report-below-map.ts --json     # machine-readable JSON
 *   npx tsx scripts/report-below-map.ts --limit 20 # cap rows printed (table only)
 */
import 'dotenv/config'
import { bulkFetchProductsForPricing } from '../app/lib/shopify.server'

interface Violation {
  sku: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  price: number
  map: number
  belowBy: number
  discontinued: boolean
}

const asJson = process.argv.includes('--json')
const limitIdx = process.argv.indexOf('--limit')
const limit = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1] ?? '0', 10) || Infinity : Infinity

async function main() {
  const products = await bulkFetchProductsForPricing()

  const violations: Violation[] = []
  let variantsScanned = 0
  let productsWithMap = 0

  for (const product of products) {
    const map = product.metafields.mapPrice
    if (map == null || map <= 0) continue
    productsWithMap++
    const discontinued =
      product.metafields.discontinuedAt != null || product.productType === 'Discontinued'

    for (const variant of product.variants) {
      variantsScanned++
      if (/^XDX-TEST-/i.test(variant.sku ?? '')) continue
      if (variant.price >= map - 0.005) continue
      violations.push({
        sku: variant.sku || '(no sku)',
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        price: variant.price,
        map,
        belowBy: Math.round((map - variant.price) * 100) / 100,
        discontinued,
      })
    }
  }

  violations.sort((a, b) => b.belowBy - a.belowBy)

  const active = violations.filter(v => !v.discontinued)
  const disc = violations.filter(v => v.discontinued)

  if (asJson) {
    console.log(JSON.stringify({
      scannedProducts: products.length,
      productsWithMap,
      variantsScannedWithMap: variantsScanned,
      violators: violations.length,
      violatorsActive: active.length,
      violatorsDiscontinuedExempt: disc.length,
      rows: violations,
    }, null, 2))
    return
  }

  console.log(`Scanned ${products.length} products (${productsWithMap} with a MAP floor).`)
  console.log(`Variants below MAP: ${violations.length} total`)
  console.log(`  ${active.length} active (compliance risk, need repricing)`)
  console.log(`  ${disc.length} discontinued (clearance ladder, MAP exempt by spec)`)
  console.log('')
  console.log('SKU'.padEnd(18) + 'PRICE'.padStart(9) + 'MAP'.padStart(9) + 'UNDER'.padStart(8) + '  DISC  VENDOR / HANDLE')
  let printed = 0
  for (const v of violations) {
    if (printed >= limit) { console.log(`  ... ${violations.length - printed} more (raise --limit or use --json)`); break }
    printed++
    console.log(
      v.sku.padEnd(18) +
      `$${v.price.toFixed(2)}`.padStart(9) +
      `$${v.map.toFixed(2)}`.padStart(9) +
      `$${v.belowBy.toFixed(2)}`.padStart(8) +
      `  ${v.discontinued ? 'yes ' : 'no  '}  ${v.vendor ?? '?'} / ${v.handle}`,
    )
  }
  console.log('')
  console.log('Fix path: the batch recompute (or pricing-ops manual run) now clamps MAP after')
  console.log('psychological rounding, so a full recompute raises the active violators to MAP.')
  console.log('This script never writes; it only reports.')
}

main().catch(err => {
  console.error('report-below-map failed:', err)
  process.exit(1)
})
