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
 * Source of truth is Shopify itself — the actual metafields (plus, since
 * ticket #13673, the product's own `description`/body_html, which the
 * derived "enriched story" signal needs) on `status:active` products — not
 * the AI-generation cache (`product_enrichment_cache`), which can hold a
 * cached generation whose write to Shopify never landed.
 *
 * The live paginated Shopify walk is too heavy for a page loader, so the loader
 * reads a KV-cached snapshot and an admin "Refresh" action recomputes it. The
 * pure scoring logic lives in `enrichment-coverage.ts`.
 */
import { adminGraphQL, normalizeMetafieldKey } from '~/lib/shopify.server'
import { kvGet, kvSet } from '~/lib/kv.server'
import { ENRICHMENT_FIELDS, tallyCoverage } from '~/lib/enrichment-coverage'
import type { CoverageProductNode, EnrichmentCoverage } from '~/lib/enrichment-coverage'

export type { EnrichmentCoverage, FieldCoverage } from '~/lib/enrichment-coverage'

const KV_KEY = 'enrichment:coverage:v1'
const CACHE_TTL_SECONDS = 6 * 60 * 60 // 6h; a Refresh recomputes on demand.
const MAX_PAGES = 60                   // 60 × 100 = 6,000 SKUs; catalog is ~3K.

// Admin API's Product.metafields is a MetafieldConnection: it rejects the
// Storefront-only `identifiers:` argument ("Field 'metafields' doesn't accept
// argument 'identifiers'"), and it also rejects a `namespace:` argument
// passed alongside `keys:`. The working form is fully-qualified
// "namespace.key" strings with no separate namespace argument — same pattern
// as the `keys:` queries elsewhere in shopify.server.ts. Queried this way,
// Shopify returns `key` in the qualified "xdipx.tagline" form, so the mapper
// below normalizes back to the bare key via `normalizeMetafieldKey`.
const KEYS = ENRICHMENT_FIELDS
  .map(f => `"xdipx.${f.key}"`)
  .join('\n            ')

const COVERAGE_PAGE_QUERY = /* GraphQL */ `
  query EnrichmentCoveragePage($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        description
        metafields(keys: [
            ${KEYS}
        ], first: ${ENRICHMENT_FIELDS.length}) {
          nodes { namespace key value }
        }
      }
    }
  }
`

interface CoveragePage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<{
      id: string
      description: string | null
      metafields: { nodes: Array<{ namespace: string; key: string; value: string }> }
    }>
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
    for (const p of data.products.nodes) {
      nodes.push({
        id: p.id,
        description: p.description,
        metafields: p.metafields.nodes.map(mf => ({ key: normalizeMetafieldKey(mf), value: mf.value })),
      })
    }
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
