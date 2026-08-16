import { or, eq, desc, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { productCopurchase } from '../../db/schema'
import { kvGetMemo, kvSet, primeKvMemo, KV_KEYS } from '~/lib/kv.server'
import { getProductByHandle, getProductsByTag } from '~/lib/shopify.server'

const TTL_SECONDS = 60 * 60

/**
 * Real cross-sell signal for the PDP "Complete the set" rail — complements,
 * never substitutes.
 *
 * Ticket #3447: this used to fall back to a same-tag lookup whenever
 * `product_copurchase` had no rows for a handle (which is every handle —
 * the table is empty). `tags[0]` is the alphabetically-first tag, almost
 * always the `brand:<vendor>` tag, so the fallback recommended other
 * products from the same vendor: cheaper ALTERNATIVES to the product the
 * visitor was about to buy, rendered directly under the buy button. That
 * tag-based lookup now lives in `getSimilarByTag()` below, for the Ask Emma
 * "similar products" tool where a same-category suggestion is the correct
 * answer to "show me something similar" — it is the wrong answer here.
 *
 * This function returns real order co-purchase data only. Until
 * `product_copurchase` has rows, it returns `[]` on every call, and that is
 * correct: an empty rail is strictly better than a rail that argues against
 * the sale. The PDP fills the rail the rest of the way from real pairing
 * data (`xdipx.accessory_product_ids` / `xdipx.pairing_why`) — see
 * `_layout.products.$slug.tsx` — never from this heuristic.
 */
export async function getFrequentlyBoughtWith(handle: string, limit = 4): Promise<string[]> {
  const cacheKey = KV_KEYS.fbt(handle)
  const cached = await kvGetMemo<string[]>(cacheKey, 300)
  if (cached) return cached.slice(0, limit)

  let handles: string[] = []
  try {
    const rows = await db
      .select({
        other: sql<string>`CASE WHEN ${productCopurchase.handleA} = ${handle} THEN ${productCopurchase.handleB} ELSE ${productCopurchase.handleA} END`,
        count: productCopurchase.count,
      })
      .from(productCopurchase)
      .where(or(eq(productCopurchase.handleA, handle), eq(productCopurchase.handleB, handle)))
      .orderBy(desc(productCopurchase.count))
      .limit(limit * 2)
    handles = rows
      .map(r => r.other)
      .filter(Boolean)
      .filter(h => h !== handle)
      .slice(0, limit)
  } catch (err) {
    console.error('[recommendations] copurchase query failed:', err)
  }

  if (handles.length > 0) {
    await kvSet(cacheKey, handles, TTL_SECONDS).catch(() => {})
    primeKvMemo(cacheKey, handles)
  }

  return handles
}

/**
 * Tag-based "similar" lookup (same category, usually same vendor) for the
 * Ask Emma / IVR `recommendSimilar` tool, where a substitute IS the right
 * answer to "show me something similar to this". Do not use this for any
 * PDP cross-sell surface — see `getFrequentlyBoughtWith` above.
 */
export async function getSimilarByTag(handle: string, limit = 2): Promise<string[]> {
  try {
    const product = await getProductByHandle(handle)
    if (!product) return []

    const tag = product.tags?.[0]
    if (!tag) return []

    const products = await getProductsByTag(tag, limit + 5)
    return products
      .map(p => p.handle)
      .filter(h => h !== handle)
      .slice(0, limit)
  } catch {
    return []
  }
}
