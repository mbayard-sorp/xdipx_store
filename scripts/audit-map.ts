/**
 * MAP & margin audit.
 *
 * Fetches all Nalpac-tagged products from Shopify and prints:
 *   [VIOLATION] — variants priced below MAP for MAP-restricted vendors
 *   [THIN]      — variants with margin < 20%
 *
 * Usage:
 *   pnpm tsx scripts/audit-map.ts
 */

import 'dotenv/config'
import { bulkFetchProductsForPricing } from '../app/lib/shopify.server'

// Vendors that enforce MAP. Extend as needed.
const MAP_RESTRICTED_VENDORS: Set<string> = new Set([
  'Nalpac',
  'Eldorado',
  'Williams Trading',
  'Doc Johnson',
  'California Exotic Novelties',
  'Pipedream',
  'CalExotics',
])

async function main(): Promise<void> {
  console.log('Fetching products for pricing audit...')
  const products = await bulkFetchProductsForPricing()
  console.log(`Fetched ${products.length} products.\n`)

  let violations = 0
  let thinMargins = 0

  for (const product of products) {
    const { handle, vendor, metafields, variants } = product
    const mapPrice = metafields.mapPrice ?? 0
    const wholesaleCost = metafields.wholesaleCost

    const vendorStr = vendor ?? ''
    const isMapVendor = MAP_RESTRICTED_VENDORS.has(vendorStr)

    for (const variant of variants) {
      const { sku, price } = variant

      // MAP check
      if (isMapVendor && mapPrice > 0 && price < mapPrice) {
        console.log(
          `[VIOLATION] ${handle} / ${sku} — price $${price.toFixed(2)} < MAP $${mapPrice.toFixed(2)} (vendor: ${vendorStr})`,
        )
        violations++
      }

      // Margin check
      if (wholesaleCost != null && wholesaleCost > 0 && price > 0) {
        const marginPct = (price - wholesaleCost) / price
        if (marginPct < 0.20) {
          console.log(
            `[THIN] ${handle} / ${sku} — price $${price.toFixed(2)}, wholesale $${wholesaleCost.toFixed(2)}, margin ${Math.round(marginPct * 100)}%`,
          )
          thinMargins++
        }
      }
    }
  }

  console.log('')
  console.log(`Summary: ${violations} MAP violation(s), ${thinMargins} thin-margin variant(s) across ${products.length} product(s).`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
