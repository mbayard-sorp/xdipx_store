/**
 * Brief gatherer for `emma-product-enricher` subagent.
 *
 * Usage:
 *   npx tsx scripts/gather-enricher-brief.ts <shopifyProductId>
 *
 * Pulls everything the subagent needs to enrich one product — Shopify product
 * snapshot, Sanity vocabularies (askEmmaVocabulary singleton, dialRegistry,
 * dialTaxonomy), pairing candidates, current xdipx metafields — and prints a
 * single JSON brief to stdout.
 *
 * The brief is the entire payload you paste into the agent dispatch prompt.
 * No files written; pipe to clipboard or a temp file as you prefer.
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { dealHistory } from '../db/schema'
import {
  shopifyAdmin,
  getPairingCandidates,
} from '../app/lib/shopify.server'
import { getDialRegistry, getDialTaxonomy } from '../app/lib/dial-registry.server'
import { getAskEmmaVocabulary } from '../app/lib/ask-emma-vocab.server'

// Mirror of `fetchProductSnapshot` from scripts/backfill-product-enrichment.ts.
// Inlined here so this gather script stays self-contained; if you change the
// shape, change both. (TODO: extract to a shared helper if a third caller appears.)
interface ShopifyProductSnapshot {
  id:              string
  title:           string
  handle:          string
  vendor:          string
  body_html:       string
  status:          string
  product_type:    string
  updated_at:      string
  metafields:      Record<string, string>
  rawDescription?: string
  images:          { src: string }[]
}

async function fetchProductSnapshot(numericId: string): Promise<ShopifyProductSnapshot | null> {
  try {
    const { product } = await shopifyAdmin<{
      product: {
        id:           number
        title:        string
        handle:       string
        vendor:       string
        body_html:    string
        status:       string
        product_type: string
        updated_at:   string
        images:       { src: string }[]
      } | null
    }>(`/products/${numericId}.json`)
    if (!product) return null

    const xdipx = await shopifyAdmin<{
      metafields: Array<{ namespace: string; key: string; value: string }>
    }>(`/products/${numericId}/metafields.json?namespace=xdipx&limit=50`)
    const custom = await shopifyAdmin<{
      metafields: Array<{ namespace: string; key: string; value: string }>
    }>(`/products/${numericId}/metafields.json?namespace=custom&limit=10`)

    const metafields: Record<string, string> = {}
    for (const m of [...(xdipx.metafields ?? []), ...(custom.metafields ?? [])]) {
      metafields[`${m.namespace}.${m.key}`] = m.value
    }

    const result: ShopifyProductSnapshot = {
      id:           String(product.id),
      title:        product.title,
      handle:       product.handle,
      vendor:       product.vendor,
      body_html:    product.body_html,
      status:       product.status,
      product_type: product.product_type,
      updated_at:   product.updated_at,
      metafields,
      images:       product.images ?? [],
    }
    if (metafields['custom.original_description']) result.rawDescription = metafields['custom.original_description']
    return result
  } catch (err) {
    console.warn(`[gather] fetchProductSnapshot ${numericId} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

async function main() {
  const shopifyProductId = process.argv[2]
  if (!shopifyProductId) {
    console.error('Usage: npx tsx scripts/gather-enricher-brief.ts <shopifyProductId>')
    process.exit(1)
  }

  const [snap, dialRegistry, dialTaxonomy, vocab] = await Promise.all([
    fetchProductSnapshot(shopifyProductId),
    getDialRegistry(),
    getDialTaxonomy(),
    getAskEmmaVocabulary(),
  ])
  if (!snap) {
    console.error(`Shopify product ${shopifyProductId} not found`)
    process.exit(1)
  }

  const histRows = await db
    .select({ sku: dealHistory.sku, brand: dealHistory.brand, categories: dealHistory.categories })
    .from(dealHistory)
    .where(eq(dealHistory.shopifyProductId, shopifyProductId))
    .limit(1)
  const hist = histRows[0]
  const sku = hist?.sku
  const brand = hist?.brand ?? snap.vendor ?? ''
  const categories = (hist?.categories as string[] | null | undefined) ?? []

  const dealPriceRaw = snap.metafields['xdipx.original_price']
  const msrp = Number(dealPriceRaw) || 0
  const dealPrice = Number(snap.metafields['xdipx.map_price']) || msrp

  const pairingCandidates = await getPairingCandidates({
    shopifyProductId,
    subCategories: categories,
  }).catch(() => [])

  const rawDescription = snap.rawDescription ?? snap.body_html.replace(/<[^>]+>/g, ' ').slice(0, 2000)

  const brief = {
    shopifyProductId,
    sku,
    rawTitle:        snap.title,
    brand,
    vendor:          snap.vendor,
    rawDescription,
    categories,
    dealPrice,
    msrp,
    existingMetafields: snap.metafields,
    vocabularies: {
      moodVocab:        vocab.mood,
      audienceVocab:    vocab.audience,
      mattersVocab:     vocab.matters,
      dialRegistryByType: dialRegistry,
      dialTaxonomy,
    },
    pairingCandidates: pairingCandidates.map((c) => ({
      productId:       c.productId,
      title:           c.title,
      brand:           c.brand,
      productTypeDial: c.productTypeDial,
      price:           c.price,
    })),
  }

  console.log(JSON.stringify(brief, null, 2))
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
