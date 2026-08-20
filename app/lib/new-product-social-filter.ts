/**
 * Curation gate for the new-product -> social event trigger (ticket #4360).
 *
 * `server/webhooks.ts` files a suggestion when a product goes live. Posting
 * every product that goes live is filler, and at this account size filler reads
 * as having nothing to say. This module is the editorial gate that decides
 * whether a freshly-live product earns a social row at all.
 *
 * It is a single pure function so the whole decision is unit-testable without a
 * database: the filing site in `server/webhooks.ts` gathers the DB-derived
 * inputs (recent pricing_audit_log rationales for the product's SKUs, and how
 * many product-triggered rows were filed this week) and hands them here.
 *
 * Catalogue and rationale: docs/store-team/instagram-campaigns.md section 4c
 * (the exclude list). If that section and this file disagree, that section is
 * the source of truth and this file is the bug.
 */

/**
 * At most this many product-triggered social rows per rolling week. The arrival
 * pattern is bursty (~15/day when an import batch lands), and section 4c budgets
 * "roughly one event-sourced post per day, at most" across every event type, of
 * which new-product is only one. Three genuine launches a week is a generous
 * ceiling against that budget; the point of the cap is to refuse the burst, not
 * to hit a precise number.
 */
export const NEW_PRODUCT_WEEKLY_CAP = 3

// Commodity consumables: accessory-tier restocks that happened to get a fresh
// Shopify id, not launches. Condoms, toy cleaner, coconut oil lube, delay
// wipes, oral gel (section 4c). Deliberately NOT a blanket "lube" match: lube
// is a real, postable category (see the "Lube, Actually" campaign), so only the
// coconut-oil commodity form is excluded here.
const COMMODITY_CONSUMABLE_PATTERNS: readonly RegExp[] = [
  /\bcondoms?\b/,
  /\btoy cleaner\b/,
  /\bcleaner wipes?\b/,
  /\bcoconut oil\b/,
  /\bdelay wipes?\b/,
  /\bnumbing wipes?\b/,
  /\boral (?:gel|sex) (?:gel|strips?|spray)\b/,
  /\boral pleasure gel\b/,
]

// Off-theme novelty: items that undercut "editorially curated sexual wellness"
// if they sit beside the featured products. The current batch's tell was a
// cannabis-leaf sticky-note pad (section 4c).
const OFF_THEME_NOVELTY_PATTERNS: readonly RegExp[] = [
  /\bcannabis\b/,
  /\bmarijuana\b/,
  /\bpot leaf\b/,
  /\bweed\b/,
  /\b420\b/,
  /\bsticky note/,
  /\bnote ?pad\b/,
  /\bgag gift\b/,
  /\bnovelty (?:pad|paper|gift|sticker)\b/,
]

// Pricing-engine rationales that are hard excludes (section 4c). Matched
// case-insensitively as substrings so the filing site can pass rationales
// verbatim.
const DISCONTINUED_MARKER = 'discontinued'
const DEAD_VELOCITY_MARKER = 'dead -> target margin'

function matchesAny(haystack: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(re => re.test(haystack))
}

export interface NewProductGateInput {
  /** Shopify product title. */
  title?: string | null | undefined
  /** Shopify product_type. */
  productType?: string | null | undefined
  /**
   * Rationale strings from recent `pricing_audit_log` rows for this product's
   * SKUs. The filing site fetches these; passing `[]` (or omitting) means "no
   * pricing signal", not "clean".
   */
  pricingRationales?: readonly (string | null | undefined)[]
  /** Count of product-triggered rows already filed in the trailing week. */
  weeklyCount?: number
  /** Max product-triggered rows per week. Defaults to NEW_PRODUCT_WEEKLY_CAP. */
  weeklyCap?: number
}

/**
 * Returns a short human-readable reason the product should NOT get a social
 * row, or `null` if it may be posted. Order is cheapest-signal-first, but every
 * branch is pure, so callers can rely on a stable reason string per input.
 */
export function newProductPostExcludeReason(input: NewProductGateInput): string | null {
  const text = `${input.title ?? ''} ${input.productType ?? ''}`.toLowerCase()

  if (matchesAny(text, COMMODITY_CONSUMABLE_PATTERNS)) {
    return 'commodity consumable (accessory-tier restock, not a launch)'
  }
  if (matchesAny(text, OFF_THEME_NOVELTY_PATTERNS)) {
    return 'off-theme novelty (undercuts editorially-curated sexual wellness)'
  }

  for (const rationale of input.pricingRationales ?? []) {
    const r = (rationale ?? '').toLowerCase()
    if (r.includes(DISCONTINUED_MARKER)) {
      return 'discontinued or on clearance (would 404 within weeks)'
    }
    if (r.includes(DEAD_VELOCITY_MARKER)) {
      return 'dead velocity (pricing engine flagged nobody is buying it)'
    }
  }

  const cap = input.weeklyCap ?? NEW_PRODUCT_WEEKLY_CAP
  if (typeof input.weeklyCount === 'number' && input.weeklyCount >= cap) {
    return `weekly product-post cap reached (${input.weeklyCount}/${cap} in the trailing week)`
  }

  return null
}

export interface RestockGateInput {
  /**
   * Rationale strings from recent `pricing_audit_log` rows for this product's
   * SKU. `[]` (or omitted) means "no pricing signal", not "clean".
   */
  pricingRationales?: readonly (string | null | undefined)[]
}

/**
 * Curation gate for the restock -> social event trigger (ticket #4361).
 *
 * A sold-out -> in-stock crossing is the rarest, highest-intent signal in
 * ecommerce, so unlike the new-product trigger it needs no weekly cap and no
 * commodity/novelty title filter: a true crossing is self-limiting and worth a
 * post on its own. The one thing it must still refuse is a SKU the pricing
 * engine has flagged discontinued or dead-velocity, because something returning
 * to stock on its way out of the catalogue is not good news. That hard exclude
 * shares the exact `pricing_audit_log` markers as the new-product gate (section
 * 4c) so the two triggers never drift apart on what "on its way out" means.
 *
 * Returns a short human-readable reason NOT to file, or `null` if the restock
 * may be posted. Pure, so callers can unit-test it without a database.
 */
export function restockPostExcludeReason(input: RestockGateInput): string | null {
  for (const rationale of input.pricingRationales ?? []) {
    const r = (rationale ?? '').toLowerCase()
    if (r.includes(DISCONTINUED_MARKER)) {
      return 'discontinued or on clearance (restocking on the way out is not news)'
    }
    if (r.includes(DEAD_VELOCITY_MARKER)) {
      return 'dead velocity (pricing engine flagged nobody is buying it)'
    }
  }
  return null
}
