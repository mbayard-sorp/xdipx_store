/**
 * Ticket #19545. Read-only scan shared by `scripts/reprice-below-wholesale.ts`
 * and the weekly `/cron/reprice-below-wholesale-scan` cron. This module has no
 * write path at all -- it never imports `updateVariantPricing` or any other
 * Shopify mutation -- so `--apply` stays script-only by construction, not by
 * convention.
 *
 * Extracted from the script (ticket #18016) rather than duplicated: both
 * callers must use the exact same `enforceWholesaleFloor` clamp the
 * pricing-apply-v2 write path already enforces, or a drift between them would
 * make the readout lie about what the real recompute considers a violator.
 */
import { adminGraphQL, normalizeMetafieldKey } from './shopify.server'
import { enforceWholesaleFloor } from './pricing-engine-v2.server'
import { getMinMarkupPct } from './pricing-apply-v2.server'

const TEST_SKU_PREFIX = /^XDX-TEST-/i
const PAGE_SIZE = 50
const PAGE_DELAY_MS = 400

export interface RepriceCandidateRow {
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

interface RepriceCandidatesQueryResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: ProductNode[]
  }
}

async function fetchActiveProducts(): Promise<ProductNode[]> {
  const all: ProductNode[] = []
  let cursor: string | null = null
  let first = true

  do {
    if (!first) await new Promise(r => setTimeout(r, PAGE_DELAY_MS))
    first = false

    const data: RepriceCandidatesQueryResult = await adminGraphQL<RepriceCandidatesQueryResult>(`
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

/** Pure: builds one candidate row per violating variant. Exported for direct unit testing. */
export function buildCandidateRows(products: readonly ProductNode[], minMarkupPct: number): {
  rows: RepriceCandidateRow[]
  variantsScanned: number
} {
  const rows: RepriceCandidateRow[] = []
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
  return { rows, variantsScanned }
}

export interface RepriceBelowWholesaleScanResult {
  scannedProducts: number
  variantsScanned: number
  minMarkupPct: number
  violators: number
  repriceCount: number
  delistCount: number
  rows: RepriceCandidateRow[]
}

/** Live wiring: pages the whole ACTIVE catalog and scores every variant. Read-only. */
export async function scanRepriceBelowWholesale(): Promise<RepriceBelowWholesaleScanResult> {
  const minMarkupPct = await getMinMarkupPct()
  const products = await fetchActiveProducts()
  const { rows, variantsScanned } = buildCandidateRows(products, minMarkupPct)
  const repriceCount = rows.filter(r => r.recommendation === 'reprice').length
  return {
    scannedProducts: products.length,
    variantsScanned,
    minMarkupPct,
    violators: rows.length,
    repriceCount,
    delistCount: rows.length - repriceCount,
    rows,
  }
}

/** Compact, owner-readable text: counts plus the top N rows. Pure, for the blocker/bus-event body. */
export function formatScanSummary(result: RepriceBelowWholesaleScanResult, limit = 25): string {
  const top = result.rows.slice(0, limit)
  const lines = top.map(r =>
    `${r.sku} $${r.price.toFixed(2)} vs $${r.wholesaleCost.toFixed(2)} cost (floor $${r.floorPrice.toFixed(2)}), `
    + `qty ${r.qty}, ${r.recommendation}, ${r.vendor ?? '?'} / ${r.handle}`,
  )
  return [
    `${result.violators} ACTIVE variant(s) priced below the wholesale floor `
    + `(${result.scannedProducts} products / ${result.variantsScanned} variants scanned, `
    + `min markup ${(result.minMarkupPct * 100).toFixed(1)}%).`,
    `Split by qty: ${result.repriceCount} reprice candidate(s) (qty > 0), ${result.delistCount} delist candidate(s) (qty 0).`,
    `Top ${top.length} of ${result.violators}, worst margin first:`,
    ...lines,
  ].join('\n')
}
