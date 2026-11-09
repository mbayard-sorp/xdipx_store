/**
 * Feed-aware eligibility gate for the homepage's hand-placed discovery
 * surfaces — the Curiosity Shelf lanes (`curiosity-shelf.ts`) and the
 * discovery rails (`discovery-rules.server.ts`) (ticket #20826,
 * inventory-sentinel finding run 1925).
 *
 * Shopify's own `totalInventory` can disagree with what the supplier
 * actually has: `lust-fetish-seraphina` showed `totalInventory: 4` (Shopify
 * still counting units on hand) while the Nalpac feed reported `qty: 0` for
 * its SKU — the supplier is out, Shopify just hasn't caught up. A product in
 * that state is a bad pick for a curated, limited slot a visitor is handed
 * directly, even though it is not technically "out of stock" by the ordinary
 * sellability gate (`isOutOfStock` in `discovery-rules.server.ts`, which
 * governs whether the PDP itself still sells it).
 *
 * Pure, dependency-free module (no React, no `.server` import) so both the
 * pure `curiosity-shelf.ts` resolver and the `.server.ts` rails filter can
 * import it without crossing the client/server boundary either way.
 */

/**
 * Minimum total buyable units (Shopify's `totalInventory`) to hold one of
 * these hand-placed slots, stricter than the curator-tunable
 * `discovery_inventory_min` floor the algorithmic rails also respect: this
 * one is always on, the same way `isOutOfStock` is always on regardless of
 * that setting. `coquette-holiday-dress` at 5 total units (only one variant
 * actually buyable) is the case that sets the number — below this, a
 * curated/limited slot is a real sellout risk even before the feed signal
 * agrees.
 */
export const FEED_AWARE_MIN_BUYABLE_UNITS = 5

/** The two fields this gate reads. */
export interface FeedAwareEligibilityInput {
  /** Shopify's own total tracked inventory. Null = untracked, always passes. */
  totalInventory: number | null
  /** The representative SKU's live Nalpac feed quantity. Null = no feed row, always passes. */
  feedQty: number | null
}

/**
 * True when a product must NOT hold a curated/limited homepage slot:
 * the representative SKU's feed quantity is exactly 0 (the supplier itself
 * is out, whatever Shopify currently counts), OR Shopify's own total buyable
 * units are at or below `FEED_AWARE_MIN_BUYABLE_UNITS`. Either signal alone
 * disqualifies; `totalInventory == null` or `feedQty == null` (no signal) never
 * contributes a disqualification on its own, the same "absence is not
 * evidence of zero" rule every other stock gate in this codebase follows.
 */
export function isFeedAwareIneligible(p: FeedAwareEligibilityInput): boolean {
  if (p.feedQty === 0) return true
  return p.totalInventory !== null && p.totalInventory <= FEED_AWARE_MIN_BUYABLE_UNITS
}
