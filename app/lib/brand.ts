/**
 * Shared brand constants — safe to import on client or server.
 * Single source of truth for the SEO title and description used in
 * ErrorBoundary, homepage meta, and Organization JSON-LD.
 *
 * Keep BRAND_DESCRIPTION at or below 160 characters so truncateForMeta
 * never clips it. Current length: 112 chars.
 */

export const BRAND_TITLE = 'xdipx — Sexual Wellness, Edited'

export const BRAND_DESCRIPTION =
  'Curated sexual wellness, vetted by humans. Discreet shipping and billing. 30-day returns. Statement reads XDIPX.'
