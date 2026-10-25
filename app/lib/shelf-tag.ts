/**
 * `shelf:<type>` tag derivation (ticket #17678).
 *
 * Collections used to rule on Shopify `product_type` directly. The Nalpac
 * Integration app writes `product_type = 'Discontinued'` on the live Shopify
 * product when Nalpac discontinues an item — a real, owner-confirmed signal
 * that drives clearance pricing (owner decision 2026-10-24; see
 * `pricing-apply-v2.server.ts`'s `DISCONTINUED_PRODUCT_TYPE` route and the
 * #17401 self-heal stamp), not legacy mistyped data. A type-ruled collection
 * drops a product the moment Nalpac flips it this way, so collection rules
 * move to a `shelf:<type>` tag instead: written once while the product
 * carries a real type, and never touched again just because the type later
 * becomes "Discontinued" (docs/audits/collections-audit-2026-10-23.md §7).
 *
 * Intentionally pure (no .server suffix, no imports) so the slug rule is
 * unit-testable without Shopify or the DB.
 */

export const SHELF_TAG_PREFIX = 'shelf:'

/** Mirrors pricing-apply-v2.server.ts's own DISCONTINUED_PRODUCT_TYPE. Kept
 *  as a separate literal here (same reasoning as product-type.server.ts) to
 *  avoid pulling in a whole pricing module for one string. */
export const DISCONTINUED_PRODUCT_TYPE = 'Discontinued'

/**
 * Slug rule: lowercase, '&' to 'and', apostrophes dropped, every other run
 * of non [a-z0-9] collapsed to a single '-', trimmed of leading/trailing '-'.
 *
 *   "Men's Underwear"      -> mens-underwear
 *   "Babydoll / Chemise"   -> babydoll-chemise
 *   "Bath & Body"          -> bath-and-body
 */
export function shelfTagSlug(productType: string): string {
  return productType
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function shelfTagForProductType(productType: string): string {
  return `${SHELF_TAG_PREFIX}${shelfTagSlug(productType)}`
}

/**
 * A "real" shelf type: non-blank and not the "Discontinued" pricing-group
 * value Nalpac writes. Never derive or apply a shelf tag from "Discontinued"
 * itself — it names a clearance-pricing state, not a shelf.
 */
export function isRealShelfType(productType: string | null | undefined): productType is string {
  const trimmed = productType?.trim()
  return !!trimmed && trimmed !== DISCONTINUED_PRODUCT_TYPE
}
