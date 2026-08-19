/**
 * Publish-time stock guard for a social_posts row carrying a durable product
 * link (ticket #2212, migration 080; `social_posts.shopify_product_id`).
 *
 * Context. A stale approved draft could publish after its product went out of
 * stock (incident 2026-08-09) because `social_posts` had no product linkage of
 * its own: the pre-publish gate's own stock check
 * (`social-publish-gate.server.ts`) only ever runs when the caller supplies a
 * `productHandle` at gate time, baked into the `feedback` stamp — and nothing
 * guarantees that snapshot is still accurate, or that it was ever supplied at
 * all. `shopify_product_id` is set once, at draft time, by the writer that
 * actually knows the product, and this helper is called fresh on EVERY publish
 * attempt — the owner's manual click in admin.socials.tsx and the unattended
 * scheduler tick in social-publish-job.server.ts alike — so a product that
 * goes out of stock between approval and the real publish call still blocks.
 *
 * Additive, not a new hard requirement: a row with no `shopify_product_id`
 * returns `ok: true` immediately. No linkage means no known product to
 * verify, which is not the same thing as "known in stock".
 *
 * Fails closed like `isProductSellable` in social-publish-gate.server.ts: a
 * lookup that cannot determine availability (network error, unknown/archived
 * product) is treated the same as out of stock, never as in-stock by default.
 */
export interface StockGuardResult {
  ok: boolean
  /** Present only when `ok` is false: human-readable reason, safe to surface
   *  in a banner error or write into `feedback`. */
  detail?: string
}

/**
 * Imported lazily, inside the function body, rather than at module top:
 * mirrors the same default-lookup pattern in social-publish-gate.server.ts.
 * Every test injects its own `lookup`, so `shopify.server` (and everything it
 * transitively pulls in: db.server, kv.server, live env vars) is never loaded
 * by the test suite, only by an actual unlinked-lookup call in production.
 */
async function defaultLookup(shopifyProductId: string): Promise<boolean | null> {
  const { isProductAvailableForSaleById } = await import('../shopify.server')
  return isProductAvailableForSaleById(shopifyProductId)
}

export async function checkLinkedProductStock(
  shopifyProductId: string | null | undefined,
  lookup: (id: string) => Promise<boolean | null> = defaultLookup,
): Promise<StockGuardResult> {
  if (!shopifyProductId) return { ok: true }
  let available: boolean | null
  try {
    available = await lookup(shopifyProductId)
  } catch {
    available = null
  }
  if (available === true) return { ok: true }
  const detail = available === false
    ? `Linked product ${shopifyProductId} is out of stock.`
    : `Linked product ${shopifyProductId} could not be verified as in stock (not on the storefront, or the lookup failed).`
  return { ok: false, detail }
}
