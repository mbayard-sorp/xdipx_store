/**
 * Retired storefront routes now permanently redirect (301) into the current
 * IA. Kept as a single map so retargeting a destination later is a one-line
 * edit here instead of hunting through each route module.
 *
 * Verified against live Shopify (2026-07-02): `vibrators` and `best-sellers`
 * collections exist; `strokers` is the closest ungendered product-type
 * collection covering the old /for-him territory. Never point back at the
 * gendered `/collections/for-him` or `/collections/for-her` handles, even
 * though those collections still exist in Shopify.
 */
export const RETIRED_ROUTE_TARGETS = {
  vault: '/collections',
  forHer: '/collections/vibrators',
  forHim: '/collections/strokers',
} as const
