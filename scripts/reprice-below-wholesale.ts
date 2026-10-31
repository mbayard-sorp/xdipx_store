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
import { adminGraphQL, normalizeMetafieldKey, updateVariantPricing } from '../app/lib/shopify.server'
import { enforceWholesaleFloor } from '../app/lib/pricing-engine-v2.server'
import { getMinMarkupPct } from '../app/lib/pricing-apply-v2.server'

const APPLY = process.argv.includes('--apply')
const AS_JSON = process.argv.includes('--json')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1] ?? '0', 10) || Infinity : Infinity

const TEST_SKU_PREFIX = /^XDX-TEST-/i
const PAGE_SIZE = 50
const PAGE_DELAY_MS = 400

interface CandidateRow {
  variantGid: string
  sku: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  price: number
  wholesaleCost: number
  floorPrice: number
  compareAtPrice: number | null
  currentMarginPct: number | null
  qty: number
  recommendation: 'reprice' | 'delist'
}

interface ProductNode {
  id: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  variants: {
    nodes: Array<{
      id: string
      sku: string | null
      price: string
      compareAtPrice: string | null
      inventoryQuantity: number
    }>
  }
  metafields: { nodes: Array<{ namespace: string; key: string; value: string }> }
}

async function fetchActiveProducts(): Promise<ProductNode[]> {
  const all: ProductNode[] = []
  let cursor: string | null = null
  let first = true

  do {
    if (!first) await new Promise(r => setTimeout(r, PAGE_DELAY_MS))
    first = false

    const data = await adminGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: ProductNode[]
      }
    }>(`
      query RepriceCandidates($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            handle
            title
            vendor
            productType
            variants(first: 100) {
              nodes { id sku price compareAtPrice inventoryQuantity }
            }
            metafields(keys: ["xdipx.wholesale_cost"], first: 5) {
              nodes { namespace key value }
            }
          }
        }
      }
    `, { first: PAGE_SIZE, after: cursor })

    all.push(...data.products.nodes)
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
  } while (cursor !== null)

  return all
}

async function main() {
  const minMarkupPct = await getMinMarkupPct()
  const products = await fetchActiveProducts()

  const rows: CandidateRow[] = []
  let variantsScanned = 0

  for (const product of products) {
    const mfMap = new Map<string, string>()
    for (const mf of product.metafields.nodes) mfMap.set(normalizeMetafieldKey(mf), mf.value)
    const wholesaleCostRaw = mfMap.get('wholesale_cost')
    const wholesaleCost = wholesaleCostRaw != null ? parseFloat(wholesaleCostRaw) : null
    if (wholesaleCost == null || wholesaleCost <= 0) continue

    for (const variant of product.variants.nodes) {
      variantsScanned++
      if (TEST_SKU_PREFIX.test(variant.sku ?? '')) continue

      const price = parseFloat(variant.price)
      const floorPrice = enforceWholesaleFloor(price, wholesaleCost, minMarkupPct)
      if (floorPrice === price) continue // at or above the floor already

      const compareAtPrice = variant.compareAtPrice != null ? parseFloat(variant.compareAtPrice) : null
      rows.push({
        variantGid: variant.id,
        sku: variant.sku || '(no sku)',
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        price,
        wholesaleCost,
        floorPrice,
        compareAtPrice,
        currentMarginPct: price > 0 ? Math.round(((price - wholesaleCost) / price) * 10000) / 100 : null,
        qty: variant.inventoryQuantity,
        recommendation: variant.inventoryQuantity > 0 ? 'reprice' : 'delist',
      })
    }
  }

  rows.sort((a, b) => a.currentMarginPct! - b.currentMarginPct!)

  if (AS_JSON) {
    console.log(JSON.stringify({
      scannedProducts: products.length,
      variantsScanned,
      minMarkupPct,
      violators: rows.length,
      rows,
    }, null, 2))
  } else {
    console.log(`Scanned ${products.length} ACTIVE products with a wholesale_cost metafield (${variantsScanned} variants).`)
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
