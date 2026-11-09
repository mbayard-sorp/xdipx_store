/**
 * /compare/{slug} pages that duplicate an existing Notebook post on the same
 * comparison and should consolidate their SEO signal there via rel=canonical,
 * instead of competing against their own Notebook twin as a separate
 * indexable document (ticket #20824).
 *
 * All four pairs follow the same pattern: the /compare/ page launched weeks
 * to months after its Notebook twin was already indexed and ranking, so the
 * Notebook post is the established page in every case. Two pairs have direct
 * GSC evidence of the harm (ticket #20824's 2026-11-09 snapshot):
 * `penis-sleeve-vs-extender`'s Notebook twin holds position 5.86 on 74
 * impressions with zero clicks, and `air-pulse-toy-vs-vibrator` itself fell
 * from position 5 to 9.33 week over week — both the signature of two pages
 * splitting one query's signal, not of a weak snippet. The other two pairs
 * (`water-based-vs-silicone-vs-hybrid-lube`, `mini-vs-full-size-vibrator`)
 * had no GSC numbers cited in the ticket; defer-to-the-older-established-page
 * is applied as the same consistent default rather than guessed per pair —
 * revisit with live GSC data if either Notebook twin is actually
 * underperforming its /compare/ counterpart.
 *
 * Cross-canonical, not a redirect: the /compare/ page keeps rendering (it may
 * still be linked from the storefront), it just points its canonical at the
 * Notebook URL so Google indexes one page per comparison. Aliased slugs are
 * also dropped from the sitemap (see sitemap.server.ts) — a URL that
 * canonicalizes elsewhere should never be submitted for indexing on its own,
 * same precedent as `collection-canonical-aliases.ts`.
 *
 * Values are site-relative paths resolved through canonicalUrl().
 */
export const COMPARE_CANONICAL_ALIASES: Record<string, string> = {
  'water-based-vs-silicone-vs-hybrid-lube': '/notebook/silicone-vs-water-based-lube',
  'air-pulse-toy-vs-vibrator': '/notebook/air-pulse-toy-vs-vibrator-difference',
  'penis-sleeve-vs-extender': '/notebook/penis-sleeve-vs-penis-extender',
  'mini-vs-full-size-vibrator': '/notebook/mini-vs-full-size-vibrator-does-size-matter',
}

/** Slugs that canonicalize elsewhere — for the sitemap exclusion filter. */
export const CANONICAL_ALIASED_COMPARE_SLUGS: ReadonlySet<string> = new Set(
  Object.keys(COMPARE_CANONICAL_ALIASES),
)

/** The site-relative canonical path for a /compare/{slug} page: itself, unless aliased. */
export function resolveCompareCanonicalPath(slug: string): string {
  return COMPARE_CANONICAL_ALIASES[slug] ?? `/compare/${slug}`
}
