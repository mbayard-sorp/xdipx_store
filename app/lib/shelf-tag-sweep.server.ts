/**
 * Nightly `shelf:<type>` tag sweep (ticket #17678).
 *
 * Every active and draft product carries a `shelf:<type>` tag so collection
 * rules can move off Shopify `product_type` (see `shelf-tag.ts` for why).
 * The import/enrich publish path (`import-enrich.server.ts`) stamps the tag
 * once when a product gets or already has a real type; this sweep keeps it
 * correct afterward:
 *
 * - productType is a real type and the shelf tag differs: swap it (remove
 *   whatever `shelf:*` tag(s) it carries, add the one matching its current
 *   type).
 * - productType is "Discontinued" and it carries NO shelf tag at all (never
 *   went through the publish path with a real type, or predates this
 *   ticket): derive one from its Nalpac categories + title, the same
 *   deriveProductType rules the import path uses.
 * - productType is "Discontinued" and it already has a shelf tag: leave it
 *   alone. Nalpac flipping the type later never removes or changes the
 *   shelf tag — that is the whole point of decoupling the two.
 *
 * Runs once nightly inside the existing pricing-batch cron handler
 * (`server/cron.pricing-batch-recompute.ts`), alongside the `sale:active`
 * sweep it is modeled on (`sale-tag-sweep.server.ts`) — no new `vercel.json`
 * entry, no new `cron-expectations.ts` row.
 */

import { deriveProductType } from './product-type-derive'
import { DISCONTINUED_PRODUCT_TYPE, SHELF_TAG_PREFIX, isRealShelfType, shelfTagForProductType } from './shelf-tag'

export interface ShelfTagCandidate {
  productId: string
  title: string
  productType: string | null
  tags: readonly string[]
  /** Nalpac Sub-Category values for this product, joined from deal_history.
   *  Empty when the product has no deal_history row (manually added, or
   *  older than the table covers) — derivation then falls back to title
   *  alone, same as deriveProductType always does. */
  categories: readonly string[]
}

export interface ShelfTagSweepRepo {
  /** Every ACTIVE and DRAFT product's type, tags, title, and Nalpac
   *  categories. */
  listCandidates: () => Promise<ShelfTagCandidate[]>
  /** Remove `removeTags` (if any) and add `addTag`, on one product. */
  swapTag: (productId: string, removeTags: readonly string[], addTag: string) => Promise<void>
}

export interface ShelfTagAction {
  removeTags: string[]
  addTag: string
}

/**
 * Pure decision for one product. Returns null when nothing should change —
 * in particular, a "Discontinued" product that already carries a shelf tag
 * is always null here, by construction (there is no branch that computes a
 * replacement for it).
 */
export function shelfTagAction(
  product: Pick<ShelfTagCandidate, 'productType' | 'tags' | 'categories' | 'title'>,
): ShelfTagAction | null {
  const existingShelfTags = product.tags.filter(t => t.startsWith(SHELF_TAG_PREFIX))

  if (isRealShelfType(product.productType)) {
    const desired = shelfTagForProductType(product.productType)
    if (existingShelfTags.length === 1 && existingShelfTags[0] === desired) return null
    return { removeTags: existingShelfTags, addTag: desired }
  }

  if (product.productType === DISCONTINUED_PRODUCT_TYPE && existingShelfTags.length === 0) {
    const derived = deriveProductType({ categories: product.categories, title: product.title })
    if (!isRealShelfType(derived.productType)) return null
    return { removeTags: [], addTag: shelfTagForProductType(derived.productType) }
  }

  return null
}

export interface ShelfTagSweepResult {
  checked: number
  swapped: number
  derivedForDiscontinued: number
}

export async function runShelfTagSweep(deps: { repo: ShelfTagSweepRepo }): Promise<ShelfTagSweepResult> {
  const products = await deps.repo.listCandidates()
  let swapped = 0
  let derivedForDiscontinued = 0

  for (const product of products) {
    const action = shelfTagAction(product)
    if (!action) continue
    await deps.repo.swapTag(product.productId, action.removeTags, action.addTag)
    if (product.productType === DISCONTINUED_PRODUCT_TYPE) derivedForDiscontinued++
    else swapped++
  }

  return { checked: products.length, swapped, derivedForDiscontinued }
}

/** Most-recent deal_history.categories per numeric Shopify product id, for
 *  the Discontinued-with-no-shelf-tag derivation branch above. Shopify data
 *  (tags/type/title) lives in shopify.server.ts; this is the one DB join the
 *  sweep needs, kept here rather than pulling db.server into shopify.server.ts. */
async function categoriesByProductId(): Promise<Map<string, readonly string[]>> {
  const { desc } = await import('drizzle-orm')
  const { db } = await import('~/lib/db.server')
  const { dealHistory } = await import('../../db/schema')

  const rows = await db
    .select({ productId: dealHistory.shopifyProductId, categories: dealHistory.categories })
    .from(dealHistory)
    .orderBy(desc(dealHistory.createdAt))

  const map = new Map<string, readonly string[]>()
  for (const row of rows) {
    if (!row.productId || map.has(row.productId)) continue
    map.set(row.productId, (row.categories ?? []).filter((c): c is string => !!c && c !== '(uncategorized)'))
  }
  return map
}

export const dbShelfTagRepo: ShelfTagSweepRepo = {
  listCandidates: async () => {
    const { listShelfTagCandidates } = await import('./shopify.server')
    const [products, categoryMap] = await Promise.all([listShelfTagCandidates(), categoriesByProductId()])
    return products.map(p => ({
      ...p,
      categories: categoryMap.get(p.productId.replace('gid://shopify/Product/', '')) ?? [],
    }))
  },
  swapTag: async (productId, removeTags, addTag) => {
    const { addShopifyProductTag, removeShopifyProductTag } = await import('./shopify.server')
    for (const tag of removeTags) {
      await removeShopifyProductTag(productId, tag)
    }
    await addShopifyProductTag(productId, addTag)
  },
}

/** Live entry point: reads the live catalog. Logs counts; never throws into
 *  the caller — a failed sweep must not fail the pricing batch it rides
 *  along with. */
export async function runLiveShelfTagSweep(): Promise<ShelfTagSweepResult | null> {
  try {
    const result = await runShelfTagSweep({ repo: dbShelfTagRepo })
    console.info(
      `[shelf-tag-sweep] checked ${result.checked} active+draft products: ` +
      `${result.swapped} swapped to match a real type, ${result.derivedForDiscontinued} derived for a tagless Discontinued product`,
    )
    return result
  } catch (err) {
    console.error('[shelf-tag-sweep] failed (ignored):', err instanceof Error ? err.message : err)
    return null
  }
}
