/**
 * Collection handles that are near-duplicates of a canonical browse surface and
 * should consolidate their SEO signal there via rel=canonical, instead of
 * competing as a separate indexable document.
 *
 * `just-dropped` is a bare Shopify smart collection (a tag rule, no Sanity
 * categoryPage, no hero, no editorial copy) whose product set substantially
 * overlaps `/new`, the catalog's canonical new-arrivals surface. Flagged by the
 * seo-pdp-auditor: the drop-page enrichment of `/new` was creating a
 * duplicate-content pair with `/collections/just-dropped` while crawl budget is
 * collapsed.
 *
 * Cross-canonical, not a 301: the collection has its own sort (BEST_SELLING) and
 * may be linked from the storefront nav, so the URL keeps working — the page
 * still renders. It just points its canonical at the preferred URL so Google
 * indexes one page, not a pair. Handles listed here are also dropped from the
 * sitemap (see sitemap.server.ts): a URL that canonicalizes elsewhere should
 * never be submitted for indexing on its own.
 *
 * Values are site-relative paths resolved through canonicalUrl().
 */
export const COLLECTION_CANONICAL_ALIASES: Record<string, string> = {
  'just-dropped': '/new',
}

/** Handles that canonicalize elsewhere — for the sitemap exclusion filter. */
export const CANONICAL_ALIASED_HANDLES: ReadonlySet<string> = new Set(
  Object.keys(COLLECTION_CANONICAL_ALIASES),
)
