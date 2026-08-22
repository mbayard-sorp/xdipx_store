/**
 * Per-product brief gatherer for the full-enrichment batch path.
 *
 * Pulls everything `runBatchFullEnrichment` (and the legacy single-product
 * `gather-enricher-brief.ts` script) needs to enrich one product:
 *   - Shopify product snapshot (REST)
 *   - Variant-level `custom.original_description` aggregation (GraphQL)
 *   - deal_history row (Neon) for sku/brand/categories
 *   - Pairing candidates from `getPairingCandidates`
 *
 * The aggregated variant descriptions are the new richer source: most
 * recently imported products have descriptions on each variant rather than
 * the master product. We dedupe + concatenate them (cap ~6K chars) and use
 * that as `rawDescription` when present, falling back to the product-level
 * `custom.original_description` and finally to `body_html`.
 *
 * Shared editorial context (vocab, dial registry, dial taxonomy) is loaded
 * once per batch via `loadSharedEnrichmentContext()` and embedded in the
 * cached system prompt — not duplicated per product.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import {
  adminGraphQL,
  getPairingCandidates,
} from '~/lib/shopify.server'
import { fetchAllNalpacFeeds } from '~/lib/nalpac-feeds.server'
import { cleanDescription } from '~/lib/feed-processor.server'
import { getDialRegistry, getDialTaxonomy } from '~/lib/dial-registry.server'
import { getAskEmmaVocabulary } from '~/lib/ask-emma-vocab.server'
import type { ProductBrief, SharedEnrichmentContext } from '~/lib/batch-enrichment.server'

const VARIANT_DESC_AGGREGATE_CAP = 6000

/**
 * Shopify Admin GraphQL has a calculated-cost rate limit (1000 cost
 * points/sec on standard plans, leaky bucket). When we hit it the API
 * returns userErrors or HTTP 429. Wrap the call in retry-with-backoff:
 * at the 1K-product scale we slam past the budget on the first 50 calls.
 */
async function adminGraphQLWithRetry<T>(
  query:     string,
  variables: Record<string, unknown>,
  attempt = 0,
): Promise<T> {
  try {
    return await adminGraphQL<T>(query, variables)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('throttled')
    if (!isRateLimit || attempt >= 4) throw err
    const delayMs = 1500 * Math.pow(2, attempt)  // 1.5s, 3s, 6s, 12s
    console.warn(`[enricher-brief] rate-limited; backing off ${delayMs}ms (attempt ${attempt + 1}/5)`)
    await new Promise(r => setTimeout(r, delayMs))
    return adminGraphQLWithRetry<T>(query, variables, attempt + 1)
  }
}

export interface ProductSnapshot {
  id:              string
  title:           string
  handle:          string
  vendor:          string
  body_html:       string
  /** Shopify product status — 'active' | 'draft' | 'archived'. */
  status:          string
  product_type:    string
  updated_at:      string
  metafields:      Record<string, string>
  images:          { src: string }[]
  /** Aggregated variant `custom.original_description` (if any), or master. */
  aggregatedDescription?: string
}

/**
 * Single GraphQL query that pulls product fields + xdipx + custom metafields
 * + variant `custom.original_description` in ONE round trip. Replaces the
 * earlier 3-REST + 1-GraphQL pattern that was getting throttled at 1K scale.
 */
export async function fetchProductSnapshot(numericId: string): Promise<ProductSnapshot | null> {
  try {
    const data = await adminGraphQLWithRetry<{
      product: {
        id:                string
        title:             string
        handle:            string
        vendor:            string
        descriptionHtml:   string
        status:            string
        productType:       string
        updatedAt:         string
        media: { edges: Array<{ node: { preview?: { image?: { url?: string } | null } | null } }> }
        metafields: { edges: Array<{ node: { namespace: string; key: string; value: string } }> }
        variants: { edges: Array<{ node: {
          id:    string
          title: string
          metafield: { value: string } | null
        } }> }
      } | null
    }>(`
      query EnricherSnapshot($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          vendor
          descriptionHtml
          status
          productType
          updatedAt
          media(first: 5) {
            edges {
              node {
                ... on MediaImage {
                  preview { image { url } }
                }
              }
            }
          }
          metafields(first: 100) {
            edges { node { namespace key value } }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                metafield(namespace: "custom", key: "original_description") {
                  value
                }
              }
            }
          }
        }
      }
    `, { id: `gid://shopify/Product/${numericId}` })

    const product = data.product
    if (!product) return null

    const metafields: Record<string, string> = {}
    for (const e of product.metafields.edges) {
      metafields[`${e.node.namespace}.${e.node.key}`] = e.node.value
    }

    const aggregated = aggregateVariantDescriptions(product.variants.edges.map(e => e.node))

    const snap: ProductSnapshot = {
      id:           String(product.id.split('/').pop()),
      title:        product.title,
      handle:       product.handle,
      vendor:       product.vendor,
      body_html:    product.descriptionHtml,
      status:       product.status.toLowerCase(),  // GraphQL returns 'DRAFT' uppercase; normalise
      product_type: product.productType,
      updated_at:   product.updatedAt,
      metafields,
      images:       product.media.edges
        .map(e => e.node.preview?.image?.url)
        .filter((u): u is string => !!u)
        .map(src => ({ src })),
    }

    const aggregatedDescription =
      aggregated
      ?? metafields['custom.original_description']
      ?? undefined
    if (aggregatedDescription) snap.aggregatedDescription = aggregatedDescription
    return snap
  } catch (err) {
    console.warn(`[enricher-brief] fetchProductSnapshot ${numericId} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

function aggregateVariantDescriptions(
  variants: ReadonlyArray<{ title: string; metafield: { value: string } | null }>,
): string | undefined {
  if (variants.length === 0) return undefined

  const seen = new Set<string>()
  const pieces: string[] = []
  for (const v of variants) {
    const value = v.metafield?.value?.trim()
    if (!value) continue
    const norm = value.toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
    if (seen.has(norm)) continue
    seen.add(norm)
    const piece = v.title && v.title !== 'Default Title'
      ? `[${v.title}] ${value}`
      : value
    pieces.push(piece)
  }
  if (pieces.length === 0) return undefined

  let aggregated = pieces.join('\n\n')
  if (aggregated.length > VARIANT_DESC_AGGREGATE_CAP) {
    aggregated = aggregated.slice(0, VARIANT_DESC_AGGREGATE_CAP) + '\n…[truncated]'
  }
  return aggregated
}

/**
 * Build a per-product brief suitable for `runBatchFullEnrichment`. Returns
 * null if the product isn't found in Shopify.
 */
export async function gatherProductBrief(numericProductId: string): Promise<ProductBrief | null> {
  const snap = await fetchProductSnapshot(numericProductId)
  if (!snap) return null

  const histRows = await db
    .select({
      sku:        dealHistory.sku,
      brand:      dealHistory.brand,
      categories: dealHistory.categories,
    })
    .from(dealHistory)
    .where(eq(dealHistory.shopifyProductId, numericProductId))
    .limit(1)
  const hist       = histRows[0]
  const sku        = hist?.sku
  const brand      = hist?.brand ?? snap.vendor ?? ''
  const categories = (hist?.categories as string[] | null | undefined) ?? []

  const msrp      = Number(snap.metafields['xdipx.original_price']) || 0
  const dealPrice = Number(snap.metafields['xdipx.map_price']) || msrp

  const pairingCandidates = await getPairingCandidates({
    shopifyProductId: numericProductId,
    subCategories:    categories,
  }).catch(() => [])

  let rawDescription =
    snap.aggregatedDescription
    ?? (snap.body_html ?? '').replace(/<[^>]+>/g, ' ').slice(0, 2000)

  // #4887: some imported products have no Shopify description at all (no
  // aggregated variant custom.original_description, no product-level one, and
  // no body_html), while the Nalpac feed row for the same SKU still carries a
  // real Product Description. Enriching from a bare title produced
  // wrong-identity products (a lip serum written up as a stroker, a thrusting
  // stroker as a sex machine), so fall back to the feed row before shipping a
  // thin brief. cleanDescription() is mandatory on any feed text (the CSV
  // encodes apostrophes as "ft." and opening quotes as "in.").
  if (!rawDescription.trim() && sku) {
    try {
      const { snapshots } = await fetchAllNalpacFeeds()
      const feedDesc = snapshots.get(sku)?.raw.mainRow?.['Product Description'] ?? ''
      if (feedDesc.trim()) {
        rawDescription = cleanDescription(feedDesc).slice(0, 2000)
        console.warn(`[enricher-brief] product ${numericProductId} (sku ${sku}): Shopify description empty, used Nalpac feed row fallback`)
      }
    } catch (err) {
      console.warn(`[enricher-brief] product ${numericProductId} (sku ${sku}): feed-description fallback lookup failed:`, err instanceof Error ? err.message : err)
    }
  }

  if (!rawDescription.trim()) {
    console.warn(`[enricher-brief] product ${numericProductId} (sku ${sku ?? 'n/a'}): empty rawDescription after Shopify + feed fallback, enrichment will be thin`)
  }

  const brief: ProductBrief = {
    shopifyProductId:   numericProductId,
    rawTitle:           snap.title,
    brand,
    vendor:             snap.vendor,
    rawDescription,
    categories,
    dealPrice,
    msrp,
    existingMetafields: snap.metafields,
    pairingCandidates: pairingCandidates.map(c => {
      const pc: ProductBrief['pairingCandidates'][number] = {
        productId: c.productId,
        title:     c.title,
      }
      if (c.brand)           pc.brand           = c.brand
      if (c.productTypeDial) pc.productTypeDial = c.productTypeDial
      if (typeof c.price === 'number') pc.price = c.price
      return pc
    }),
  }
  if (sku) brief.sku = sku
  return brief
}

/**
 * Load the editorial context shared across every product in a batch:
 * vocabularies, dial registry, dial taxonomy. Embedded in the cached system
 * prompt so 1K products write the cache once and read 999 times.
 */
export async function loadSharedEnrichmentContext(): Promise<SharedEnrichmentContext> {
  const [dialRegistry, dialTaxonomy, vocab] = await Promise.all([
    getDialRegistry(),
    getDialTaxonomy(),
    getAskEmmaVocabulary(),
  ])
  return {
    moodVocab:          vocab.mood,
    audienceVocab:      vocab.audience,
    mattersVocab:       vocab.matters,
    dialRegistryByType: dialRegistry,
    dialTaxonomy,
  }
}
