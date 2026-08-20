/**
 * Per-field enrichment coverage across the live catalog — Shopify walk + cache.
 *
 * `admin.imports.tsx` already reports coarse lifecycle counts (queued /
 * enriched / live) from `import_candidates` timestamps, which only says whether
 * the enrich→publish step ran, never whether a given editorial field actually
 * landed on the product. This module answers the other question by counting, on
 * the products live on the storefront, which enrichment metafields are set
 * (ticket #3891).
 *
 * Source of truth is Shopify itself — the actual metafields on `status:active`
 * products — not the AI-generation cache (`product_enrichment_cache`), which can
 * hold a cached generation whose write to Shopify never landed.
 *
 * The live paginated Shopify walk is too heavy for a page loader, so the loader
 * reads a KV-cached snapshot and an admin "Refresh" action recomputes it. The
 * pure scoring logic lives in `enrichment-coverage.ts`.
 */
import { adminGraphQL } from '~/lib/shopify.server'
import { kvGet, kvSet } from '~/lib/kv.server'
import { ENRICHMENT_FIELDS, tallyCoverage } from '~/lib/enrichment-coverage'
import type { CoverageProductNode, EnrichmentCoverage } from '~/lib/enrichment-coverage'

export type { EnrichmentCoverage, FieldCoverage } from '~/lib/enrichment-coverage'

const KV_KEY = 'enrichment:coverage:v1'
const CACHE_TTL_SECONDS = 6 * 60 * 60 // 6h; a Refresh recomputes on demand.
const MAX_PAGES = 60                   // 60 × 100 = 6,000 SKUs; catalog is ~3K.

const IDENTIFIERS = ENRICHMENT_FIELDS
  .map(f => `{ namespace: "xdipx", key: "${f.key}" }`)
  .join('\n            ')

const COVERAGE_PAGE_QUERY = /* GraphQL */ `
  query EnrichmentCoveragePage($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        metafields(identifiers: [
            ${IDENTIFIERS}
        ]) { key value }
      }
    }
  }
`

interface CoveragePage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: CoverageProductNode[]
  }
}

/**
 * Walk every `status:active` product from the Shopify Admin API, requesting
 * only the enrichment metafields, and tally coverage. Heavy (paginated): call
 * it from the admin Refresh action, never from a hot loader.
 */
export async function computeEnrichmentCoverage(): Promise<EnrichmentCoverage> {
  const nodes: CoverageProductNode[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: CoveragePage = await adminGraphQL<CoveragePage>(COVERAGE_PAGE_QUERY, { cursor })
    nodes.push(...data.products.nodes)
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
    if (!cursor) break
  }

  return { ...tallyCoverage(nodes), builtAt: new Date().toISOString() }
}

/** Read the last cached snapshot, or null when none has been computed yet. */
export async function getCachedEnrichmentCoverage(): Promise<EnrichmentCoverage | null> {
  return kvGet<EnrichmentCoverage>(KV_KEY)
}

/** Recompute from Shopify and cache the snapshot. Returns the fresh snapshot. */
export async function refreshEnrichmentCoverage(): Promise<EnrichmentCoverage> {
  const coverage = await computeEnrichmentCoverage()
  await kvSet(KV_KEY, coverage, CACHE_TTL_SECONDS)
  return coverage
}
