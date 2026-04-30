// Single source of truth for converting any product/taxonomy tag into a
// canonical slug. Used at write-time (Sanity backfill + sync) and at query-time
// (search filter + facet count). Both sides MUST go through this function or
// the schema invariant breaks.
//
// Examples:
//   "Plugs and Probes"           → "plugs-and-probes"
//   "cat:plugs-and-probes"       → "plugs-and-probes"
//   "brand:Dame"                 → "dame"
//   "COUPLES'' VIBRATORS"        → "couples-vibrators"
//   "  Top 100 Items  "          → "top-100-items"
//   "Strap-on Compatible"        → "strap-on-compatible"

const PREFIXES = ['cat:', 'brand:']

export function normalizeTag(input: string): string {
  let s = input.trim().toLowerCase()
  for (const p of PREFIXES) {
    if (s.startsWith(p)) { s = s.slice(p.length); break }
  }
  // Collapse Nalpac-feed double-apostrophes (e.g. "couples'' vibrators")
  // and any single apostrophe — they don't survive slugification anyway.
  s = s.replace(/'+/g, '')
  // Replace ampersands with "and" before stripping punctuation, so
  // "Massage & Candles" → "massage-and-candles" instead of "massage-candles".
  s = s.replace(/&/g, ' and ')
  // Anything that isn't a-z 0-9 collapses to a single hyphen.
  s = s.replace(/[^a-z0-9]+/g, '-')
  // Trim leading/trailing hyphens.
  s = s.replace(/^-+|-+$/g, '')
  return s
}

export function normalizeTagList(input: readonly string[] | null | undefined): string[] {
  if (!input) return []
  const seen = new Set<string>()
  for (const raw of input) {
    const n = normalizeTag(raw)
    if (n) seen.add(n)
  }
  return Array.from(seen)
}
