/**
 * Shared brand constants — safe to import on client or server.
 * Fallback source of truth for the SEO title and description used in
 * ErrorBoundary, homepage meta, and Organization JSON-LD.
 *
 * The homepage title/description are now team-editable in Sanity
 * (singleton.homeSeo → getHomeSeo). These constants are the fallback used when
 * that singleton is blank. Keep BRAND_DESCRIPTION at or below 155 characters so
 * search engines never clip it, and keep it commercial + trust-led (curation,
 * discreet shipping, XDIPX billing, returns) so Google prefers it over the
 * footer legal disclaimer. Current length: 133 chars.
 */

export const BRAND_TITLE = 'xdipx — Sexual Wellness, Edited'

export const BRAND_DESCRIPTION =
  'Shop curated sex toys and sexual wellness, vetted by humans. Discreet shipping, private XDIPX billing, and 30-day returns. Find your fit.'
