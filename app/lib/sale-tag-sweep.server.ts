/**
 * Nightly `sale:active` tag sweep (ticket #17601).
 *
 * Until 2026-10-24 the `on-sale` smart collection (a live dropPage, linked
 * from the site menus) was ruled on `product_type = 'Discontinued'` AND
 * `inventory > 1`. The owner approved retyping the 894 active products
 * mistyped "Discontinued" to their real types (ticket #17600), which emptied
 * the collection on the spot — that type was always a pricing-group key, not
 * a discount signal. The collection was re-ruled by hand to `tag:'sale:active'`
 * and the tag applied once to every qualifying product. This module keeps it
 * matching the live catalog going forward.
 *
 * The rule: ACTIVE, in stock, and at least one variant priced
 * `threshold` (default 0.6, i.e. 40% off) or deeper under its OWN
 * compare-at price. 62% of variants carry a compare-at (the MSRP strike), so
 * compare-at alone can never define a sale — it only means something compared
 * against the live sell price.
 *
 * Runs once nightly inside the existing pricing-batch cron handler
 * (`server/cron.pricing-batch-recompute.ts`, after `result.done`), not as its
 * own scheduled surface: no new `vercel.json` entry and no new
 * `cron-expectations.ts` row to keep in sync, and the sweep only means
 * anything once today's prices are the ones on every variant anyway.
 */

import { getPipelineSetting } from './feed-processor.server'

export const SALE_TAG = 'sale:active'

/** Fallback when `sale_tag_discount_threshold` is unset or unparseable. */
export const DEFAULT_SALE_DISCOUNT_THRESHOLD = 0.6

/** The pricing_settings key an owner can tune this from, read fresh every sweep. */
export const SALE_DISCOUNT_THRESHOLD_SETTING_KEY = 'sale_tag_discount_threshold'

export interface SaleTagProduct {
  productId: string
  tags: readonly string[]
  status: string
  totalInventory: number
  variants: ReadonlyArray<{ price: number; compareAtPrice: number | null }>
}

export interface SaleTagRepo {
  /** Every ACTIVE product's tags, stock, and variant prices. */
  listCandidates: () => Promise<SaleTagProduct[]>
  addTag: (productId: string, tag: string) => Promise<void>
  removeTag: (productId: string, tag: string) => Promise<void>
}

/** Read the live threshold, falling back when unset or out of (0,1). */
export async function saleDiscountThreshold(): Promise<number> {
  const raw = await getPipelineSetting(SALE_DISCOUNT_THRESHOLD_SETTING_KEY)
  const n = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_SALE_DISCOUNT_THRESHOLD
}

/**
 * Pure rule: does this product belong in the on-sale set right now?
 *
 * ACTIVE and in-stock are hard requirements (a draft or out-of-stock product
 * is never "on sale" however its compare-at reads). Among its variants, ANY
 * one at or under `threshold` of its own compare-at is enough — a kit with
 * one discounted size and one at full price still reads as on sale. A
 * variant with no compare-at (or a zero one) never qualifies on its own:
 * compare-at is the MSRP strike, not optional, for this rule.
 */
export function meetsSaleRule(
  product: Pick<SaleTagProduct, 'status' | 'totalInventory' | 'variants'>,
  threshold: number,
): boolean {
  if (product.status !== 'ACTIVE') return false
  if (product.totalInventory <= 0) return false
  return product.variants.some(v =>
    v.compareAtPrice != null && v.compareAtPrice > 0 && v.price <= threshold * v.compareAtPrice,
  )
}

export interface SaleTagSweepResult {
  checked: number
  added: number
  removed: number
  threshold: number
}

/**
 * Add or remove `SALE_TAG` on every ACTIVE product so the tag exactly
 * matches `meetsSaleRule`. Never touches any other tag: `addTag`/`removeTag`
 * each take one literal tag string, by design (see `SaleTagRepo`), so there
 * is no code path here that can read or rewrite a product's other tags.
 */
export async function runSaleTagSweep(deps: { repo: SaleTagRepo; threshold?: number }): Promise<SaleTagSweepResult> {
  const threshold = deps.threshold ?? await saleDiscountThreshold()
  const products = await deps.repo.listCandidates()
  let added = 0
  let removed = 0

  for (const product of products) {
    const shouldHaveTag = meetsSaleRule(product, threshold)
    const hasTag = product.tags.includes(SALE_TAG)
    if (shouldHaveTag && !hasTag) {
      await deps.repo.addTag(product.productId, SALE_TAG)
      added++
    } else if (!shouldHaveTag && hasTag) {
      await deps.repo.removeTag(product.productId, SALE_TAG)
      removed++
    }
  }

  return { checked: products.length, added, removed, threshold }
}

export const dbSaleTagRepo: SaleTagRepo = {
  listCandidates: async () => {
    const { listSaleTagCandidates } = await import('./shopify.server')
    return listSaleTagCandidates()
  },
  addTag: async (productId, tag) => {
    const { addShopifyProductTag } = await import('./shopify.server')
    await addShopifyProductTag(productId, tag)
  },
  removeTag: async (productId, tag) => {
    const { removeShopifyProductTag } = await import('./shopify.server')
    await removeShopifyProductTag(productId, tag)
  },
}

/** Live entry point: reads the live threshold and the live catalog. Logs
 *  counts; never throws into the caller — a failed sweep must not fail the
 *  pricing batch it rides along with. */
export async function runLiveSaleTagSweep(): Promise<SaleTagSweepResult | null> {
  try {
    const result = await runSaleTagSweep({ repo: dbSaleTagRepo })
    console.info(
      `[sale-tag-sweep] checked ${result.checked} active products at threshold ${result.threshold}: ` +
      `+${result.added} tagged, -${result.removed} untagged`,
    )
    return result
  } catch (err) {
    console.error('[sale-tag-sweep] failed (ignored):', err instanceof Error ? err.message : err)
    return null
  }
}
