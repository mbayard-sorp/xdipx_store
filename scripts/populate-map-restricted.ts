/**
 * Populate xdipx.map_restricted for manufacturer hard-block vendors (ticket #3715).
 *
 * The flag was designed for vendors that forbid ANY advertised discount
 * regardless of MAP math, but no writer ever set it, so it was true on zero of
 * 4,701 active products and every reader's mapRestricted branch was dead code.
 *
 * Division of labor after this ships:
 *   - MAP == MSRP (the common case, ~1,639 products) is already derived at
 *     read time by mapAllowsDiscountDisplay in app/lib/discount-badge.ts
 *     (mapPrice < regularPrice check). No flag needed for those.
 *   - The flag covers only the true manufacturer hard block. The Nalpac feed
 *     carries no hard-block column (MAP is its only pricing signal), so the
 *     signal source is the MAP_RESTRICTED_VENDORS allowlist the legacy pricing
 *     engine already treats as MAP-locked (Lovense, Playground).
 *
 * DRY-RUN BY DEFAULT. Pass --apply to actually write metafields.
 *
 * Usage:
 *   npx tsx scripts/populate-map-restricted.ts           # dry run, lists what would change
 *   npx tsx scripts/populate-map-restricted.ts --apply   # writes xdipx.map_restricted=true
 */
import 'dotenv/config'
import { bulkFetchProductsForPricing, updateProductMetafield } from '../app/lib/shopify.server'
import { MAP_RESTRICTED_VENDORS } from '../app/lib/pricing-engine.server'

const apply = process.argv.includes('--apply')

function isHardBlockVendor(vendor: string | null): boolean {
  if (!vendor) return false
  const trimmed = vendor.trim().toLowerCase()
  return MAP_RESTRICTED_VENDORS.some(v => v.toLowerCase() === trimmed)
}

async function main() {
  console.log(`Mode: ${apply ? 'APPLY (writing metafields)' : 'DRY RUN (no writes; pass --apply to write)'}`)
  console.log(`Hard-block vendor list: ${MAP_RESTRICTED_VENDORS.join(', ')}`)

  const products = await bulkFetchProductsForPricing()

  let candidates = 0
  let alreadySet = 0
  let written = 0
  let failed = 0

  for (const product of products) {
    if (!isHardBlockVendor(product.vendor)) continue
    candidates++

    if (product.metafields.mapRestricted) {
      alreadySet++
      continue
    }

    console.log(`${apply ? 'SET ' : 'would set '}map_restricted=true  ${product.vendor}  ${product.handle}`)

    if (!apply) continue

    try {
      await updateProductMetafield(product.productGid, 'map_restricted', 'true', 'boolean')
      written++
    } catch (err) {
      failed++
      console.error(`  FAILED ${product.handle}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log('')
  console.log(`Scanned ${products.length} products.`)
  console.log(`Hard-block vendor products: ${candidates} (${alreadySet} already flagged)`)
  if (apply) {
    console.log(`Written: ${written}, failed: ${failed}`)
  } else {
    console.log(`Would write: ${candidates - alreadySet} (dry run, nothing written)`)
  }
}

main().catch(err => {
  console.error('populate-map-restricted failed:', err)
  process.exit(1)
})
