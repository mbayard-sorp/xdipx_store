/**
 * Server-side product_type helpers: live-vocabulary validation against the
 * pricing_product_type_map table and the enrich/publish-time guard that
 * backfills a missing type before a product goes live.
 *
 * Why this exists: pricing engine v2 resolves margin rules by product_type.
 * A product published without one silently prices on the global 50% rule
 * (the 2026-07-21 incident). Import paths set the type at creation via
 * deriveProductType; this module is the belt-and-braces layer for products
 * that slipped through (reused drafts, pre-fix imports, vocabulary drift).
 */

import { db } from '~/lib/db.server'
import { pricingProductTypeMap } from '../../db/schema'
import { deriveProductType } from '~/lib/product-type-derive'
import { getShopifyProductType, setShopifyProductType } from '~/lib/shopify.server'

const VOCAB_TTL_MS = 10 * 60 * 1000
let vocabCache: { types: Set<string>; fetchedAt: number } | null = null

/** The live canonical vocabulary from pricing_product_type_map, cached 10 min.
 *  Falls back to the last good value (or an empty set) on DB failure so the
 *  import/publish paths never hard-fail on a vocabulary read. */
export async function getCanonicalProductTypes(): Promise<Set<string>> {
  const now = Date.now()
  if (vocabCache && now - vocabCache.fetchedAt < VOCAB_TTL_MS) return vocabCache.types
  try {
    const rows = await db.select({ productType: pricingProductTypeMap.productType }).from(pricingProductTypeMap)
    vocabCache = { types: new Set(rows.map(r => r.productType)), fetchedAt: now }
  } catch (err) {
    console.warn('[product-type] pricing_product_type_map read failed, using stale/empty vocabulary:', err instanceof Error ? err.message : err)
    if (!vocabCache) vocabCache = { types: new Set(), fetchedAt: now }
  }
  return vocabCache.types
}

/**
 * Guard used by the enrich -> publish path: make sure a product carries a
 * product_type the pricing engine can resolve before it goes live.
 *
 * - Type already set: verify it against the live table; log (don't touch) if
 *   it's off-vocabulary — that's drift for a human, not something to clobber.
 * - Type missing: derive from Nalpac categories + title and write it to
 *   Shopify. If derivation fails or produces an off-vocabulary value, log an
 *   error and leave the product untouched. Never blocks the caller.
 *
 * Returns the type the product ends up with (null when unresolved).
 */
export async function ensureProductTypeForPublish(input: {
  numericProductId: string
  sku?: string
  categories: readonly string[]
  title: string
  /** Pass when the caller already holds the product's current type (e.g. from
   *  a snapshot) — skips the Shopify read. '' / null both mean "unset". */
  currentType?: string | null
}): Promise<string | null> {
  const { numericProductId, sku, categories, title } = input
  const label = sku ? `${sku} (product ${numericProductId})` : `product ${numericProductId}`

  let current: string | null = null
  if (input.currentType !== undefined) {
    current = input.currentType?.trim() ? input.currentType.trim() : null
  } else {
    try {
      current = await getShopifyProductType(numericProductId)
    } catch (err) {
      console.warn(`[product-type] could not read product_type for ${label}:`, err instanceof Error ? err.message : err)
      return null
    }
  }

  const vocab = await getCanonicalProductTypes()

  if (current) {
    if (vocab.size > 0 && !vocab.has(current)) {
      console.error(`[product-type-guard] ${label} publishing with product_type "${current}" that is NOT in pricing_product_type_map — pricing will fall through to the global rule`)
    }
    return current
  }

  const derived = deriveProductType({ categories, title })
  if (!derived.productType) {
    console.error(`[product-type-guard] ${label} would publish WITHOUT a product_type and none is derivable (categories=${JSON.stringify(categories)}, title=${JSON.stringify(title)}) — pricing will fall through to the global rule; set it manually`)
    return null
  }
  if (vocab.size > 0 && !vocab.has(derived.productType)) {
    console.error(`[product-type-guard] ${label} derived product_type "${derived.productType}" is not in pricing_product_type_map — vocabulary drift; not writing it`)
    return null
  }

  try {
    await setShopifyProductType(numericProductId, derived.productType)
    console.info(`[product-type] ${label} backfilled product_type "${derived.productType}" (matched by ${derived.matchedBy}) before publish`)
    return derived.productType
  } catch (err) {
    console.error(`[product-type-guard] ${label} failed to write derived product_type "${derived.productType}":`, err instanceof Error ? err.message : err)
    return null
  }
}
