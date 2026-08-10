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

/**
 * Canonical savings-line wording, shared by every card that renders a
 * "You save" line (ticket #842). One wording, no colon: the PLP VaultCard used
 * to carry a colon ("You save: $X") while the discovery grid did not, so the
 * same fact read three ways across the site. Amount is a dollar figure, pct is
 * the already-rounded save percentage.
 */
export function formatSavings(amount: number, pct: number): string {
  return `You save $${amount.toFixed(2)} (${pct}%)`
}

/** Range variant, for cards whose variants span more than one markdown. */
export function formatSavingsRange(amount: number, pct: number): string {
  return `Save up to $${amount.toFixed(2)} (${pct}%)`
}

/**
 * The compact percentage pill on the home rails is a distinct badge treatment,
 * not the savings line, but its string lives here too so all three surfaces
 * draw their save-copy from one module and cannot drift apart.
 */
export function formatDiscountBadge(pct: number): string {
  return `${pct}% off`
}
