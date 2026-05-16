/**
 * Tag normalization + display helpers for the home page discovery surface.
 *
 * Chip vocabularies are sourced from Shopify metafields (xdipx.mood_tags /
 * xdipx.audience_tags / xdipx.matters_tags). Merchandisers tag with
 * inconsistent casing (Sensual, sensual, SENSUAL) and use hyphenated
 * values for multi-word tags (Slow-And-Intimate). These helpers:
 *
 *   - `normalizeTag(raw)` collapses casing so dedupe works (Title-Case
 *     with hyphens preserved as the canonical storage form). The output
 *     is what we store in DiscoveryState and what we match against per-
 *     product mood/audience/matters arrays.
 *
 *   - `displayLabel(stored)` formats the canonical value for the UI:
 *     hyphens become spaces, small connector words (and/or/the/a/etc.)
 *     are lowercased mid-string.
 *
 * Pure, no deps — safe to import from server and client modules alike.
 */

/**
 * Words that should be lowercase mid-string when displayed (Title Case
 * with sentence-case connectors). First word is never demoted.
 */
const SMALL_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'for', 'with',
  'in', 'on', 'at', 'to', 'by', 'as', 'but', 'nor',
])

/**
 * Storage-form canonicalization. Lowercases everything, then Title-Cases
 * each word. Word boundaries: whitespace and hyphens (hyphens preserved
 * in output so editor-supplied compound forms like "Body-Safe" round-trip).
 *
 *   "sensual"             → "Sensual"
 *   "Slow-And-Intimate"   → "Slow-And-Intimate"
 *   "BODY-SAFE silicone"  → "Body-Safe Silicone"
 *   "  unhurried-solo "   → "Unhurried-Solo"
 */
export function normalizeTag(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // Split keeps the original separators (space, hyphen) so we can rejoin.
  return trimmed
    .toLowerCase()
    .split(/(\s+|-)/)
    .map(part => {
      if (/^\s+$/.test(part) || part === '-') return part
      if (part.length === 0) return part
      return part[0]!.toUpperCase() + part.slice(1)
    })
    .join('')
}

/**
 * Display formatting for chip labels. Replaces hyphens with spaces and
 * lowercases small connector words (after the first word).
 *
 *   "Slow-And-Intimate" → "Slow and Intimate"
 *   "Body-Safe Silicone" → "Body Safe Silicone"
 *   "Sensual" → "Sensual"
 *   "Date Night" → "Date Night"
 */
export function displayLabel(stored: string): string {
  const flat = stored.replace(/-/g, ' ')
  const words = flat.split(/\s+/).filter(Boolean)
  return words
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase()
      return w
    })
    .join(' ')
}
