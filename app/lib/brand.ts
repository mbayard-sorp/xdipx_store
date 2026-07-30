/**
 * Shared brand constants, safe to import on client or server.
 * Fallback source of truth for the SEO title and description used in
 * ErrorBoundary, homepage meta, and Organization JSON-LD.
 *
 * The homepage title/description are now team-editable in Sanity
 * (singleton.homeSeo -> getHomeSeo). These constants are the fallback used when
 * that singleton is blank. Keep BRAND_DESCRIPTION at or below 155 characters so
 * search engines never clip it, and keep it commercial + trust-led (curation,
 * discreet shipping, XDIPX billing, returns) so Google prefers it over the
 * footer legal disclaimer.
 *
 * No em-dashes in any of these strings. They are served to every crawler on
 * every page, and the voice charter (docs/emma-voice.md) bans the character.
 * `app/lib/brand.test.ts` pins that plus the 60/155 length ceilings.
 */

/**
 * The brand name on its own, for schema.org Organization `name` and for
 * composing titles (`<page> | xdipx`). Never a tagline: this is the entity
 * string search engines match the brand on.
 */
export const BRAND_NAME = 'xdipx'

/**
 * The homepage/site-level title tag. Brand-first on purpose: the homepage's
 * search queries are overwhelmingly brand-navigational (including misspellings
 * like "dipx" and "xdip"), so the brand token has to lead. 44 chars, inside the
 * ~60-char SERP cap.
 */
export const BRAND_TITLE = 'xdipx | Curated Sex Toys and Sexual Wellness'

/**
 * The homepage/site-level meta description. 137 chars.
 *
 * Deliberately says "chosen with care" rather than "vetted by humans": the
 * product-manager import carve-out (CLAUDE.md) lets an agent approve import
 * candidates with no per-item human approval, so a human-QA claim shown to
 * every searcher is not something we can substantiate catalog-wide.
 */
export const BRAND_DESCRIPTION =
  'Shop curated sex toys and sexual wellness, chosen with care. Discreet shipping, private XDIPX billing, and 30-day returns. Find your fit.'
