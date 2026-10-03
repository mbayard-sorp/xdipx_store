/**
 * Instagram category eligibility (ticket #13099, consolidating #12876/#12877
 * duplication). docs/store-team/instagram-campaigns.md §4b, "Picking the
 * product", filter 2: "Never a dildo, never an anatomically realistic
 * product." If that section and this file disagree, the doc is the source of
 * truth and this file is the bug.
 *
 * Before this file, three independent implementations of the same check
 * existed with different exclusion lists: `scripts/pick-todays-product.ts`'s
 * `isInstagramEligible` matched the fuller doctrine text (dong, pussy,
 * vagina, dual/triple density, celebrity molded, anatomically) against both
 * title and product type; `app/lib/social-candidates.server.ts`'s
 * `isInstagramEligibleCategory` and `app/lib/new-product-social-filter.ts`'s
 * `isInstagramEligibleProduct` matched only `dildo|realistic|sex doll`
 * against product type alone, each filed the same day on a separate branch
 * from the other, neither aware of the other two. This module is the single
 * reconciled list and the one function all three call sites now import.
 */

export const INSTAGRAM_CATEGORY_EXCLUDED_PATTERNS: readonly RegExp[] = [
  /\bdildos?\b/i,
  /\bdongs?\b/i,
  /realistic/i,
  /dual densit/i,
  /triple densit/i,
  /celebrity molded/i,
  /\bpussy\b/i,
  /\bvagina\b/i,
  /anatomically/i,
  /sex\s*doll/i,
]

/**
 * Checks both title and product type, like `pick-todays-product.ts`'s
 * original did: a product type the doctrine doesn't name in words (e.g. a
 * generic "Massager" whose title says "Realistic Vibrating...") still needs
 * catching, and title is the one signal product type alone can't see.
 */
export function isInstagramEligibleByCategory(
  p: { title?: string | null | undefined; productType?: string | null | undefined },
): { eligible: boolean; reason: string } {
  const haystack = `${p.productType ?? ''} ${p.title ?? ''}`.trim()
  for (const re of INSTAGRAM_CATEGORY_EXCLUDED_PATTERNS) {
    if (re.test(haystack)) {
      return { eligible: false, reason: `excluded category: matches ${re} in "${haystack.slice(0, 80)}"` }
    }
  }
  return { eligible: true, reason: 'no excluded-category match in product type or title' }
}
