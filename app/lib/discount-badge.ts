/**
 * Discount-badge floor (ticket #467).
 *
 * A store whose whole pitch is honest curation cannot afford a "1% off" badge:
 * a trivial discount sitting beside genuine 10-37% ones teaches a visitor to
 * distrust every badge on the page, including the real ones (design-doctrine
 * §6, "never fabricate proof / no discount theatre"). Below the floor we render
 * NO badge or savings line; the struck compare-at price still carries the
 * markdown, so no information is lost.
 *
 * Shared by every card that surfaces a save-percentage — the home rails
 * (StorefrontProductCard), the PLP (VaultCard), and the discovery grid
 * (discovery/ProductCard) — so the surfaces cannot drift apart again.
 */

/** Minimum rounded save-percentage worth surfacing as a badge or savings line. */
export const MIN_DISCOUNT_BADGE_PCT = 10

/** True when a rounded save-percentage clears the floor. */
export function showDiscountBadge(savePct: number): boolean {
  return savePct >= MIN_DISCOUNT_BADGE_PCT
}
