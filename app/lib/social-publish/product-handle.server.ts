/**
 * The featured product's Shopify handle for a social_posts row (Phase 5,
 * ticket #4913).
 *
 * Before this the handle lived only inside the gate stamp in `feedback`,
 * because `social_posts` had no product column when the gate was built. It
 * has one now: `shopify_product_id`, set at draft time by the writer that
 * knows the product (migration 080). The publisher needs the handle for
 * catalog tagging and the publish-time stock re-check needs it to run at all,
 * so both read it from the row's product linkage first and fall back to the
 * stamp only while the column is null.
 *
 * Fails soft: a lookup that cannot resolve the id returns null and the
 * caller falls through to the stamp. Stock is enforced separately and fails
 * closed (`stock-guard.server.ts`), so a missing handle here never lets an
 * out-of-stock product through, it only means the tag is skipped.
 */
import { parseGateStamp } from '../social-publish-approve.server'

export interface ProductHandleSource {
  shopifyProductId?: string | null
  feedback?: string | null
}

/** Lazy import, so tests never load shopify.server (mirrors stock-guard.server.ts). */
async function defaultLookup(shopifyProductId: string): Promise<string | null> {
  const { getProductHandleById } = await import('../shopify.server')
  return getProductHandleById(shopifyProductId)
}

export async function resolvePostProductHandle(
  post: ProductHandleSource,
  lookup: (shopifyProductId: string) => Promise<string | null> = defaultLookup,
): Promise<string | null> {
  if (post.shopifyProductId) {
    let handle: string | null = null
    try {
      handle = await lookup(post.shopifyProductId)
    } catch {
      handle = null
    }
    if (handle?.trim()) return handle.trim()
  }
  // TODO(#4913 burn-in): drop the stamp fallback once every row that features
  // a product carries shopify_product_id.
  return parseGateStamp(post.feedback)?.productHandle ?? null
}
