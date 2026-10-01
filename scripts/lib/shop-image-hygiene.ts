/**
 * Pure helpers for the Shop image clean-up (docs/store-team/shop-image-strategy.md
 * Layer 1). Kept out of scripts/sweep-packshot-primaries.ts so they can be
 * unit-tested without running the script's main().
 */

/**
 * Apparel and wearables: the clean sibling of a Nalpac "A" shot is usually the
 * garment worn on a model, which ads-policy §Shop rule 4 keeps off position 0
 * (no body, no skin). Verified 2026-09-30 on a random A/B sample: the one pair
 * where B showed a body was a pair of mesh trunks. These keep their current
 * primary.
 */
const APPAREL = /\b(trunks?|briefs?|boxers?|thongs?|jock(strap)?|panty|panties|bras?|bralette|teddy|bodysuit|body ?stocking|lingerie|dress|chemise|babydoll|garters?|stockings?|corset|bustier|skirt|shorts|leggings?|harness|romper|gown|robe|underwear|swim(suit|wear)?|g-string|pasties|catsuit|singlet)\b/i

export function isApparelTitle(title: string): boolean {
  return APPAREL.test(title)
}

/** Collapse whitespace and replace em and en dashes (house style bans em-dashes). */
function clean(s: string): string {
  return s.replace(/\u2014/g, ',').replace(/\u2013/g, '-').replace(/\s+/g, ' ').trim()
}

/**
 * Alt text for a product image: a plain product description at the paid-ad
 * register (title, plus the brand when the title does not already carry it).
 * Position 0 gets the bare description; later images are numbered views so
 * screen readers can tell them apart.
 */
export function altTextFor(title: string, vendor: string | null | undefined, index: number): string {
  const t = clean(title)
  const v = clean(vendor ?? '')
  const base = !v || t.toLowerCase().includes(v.toLowerCase()) ? t : `${t} by ${v}`
  const alt = index === 0 ? base : `${base}, view ${index + 1}`
  return alt.slice(0, 512)
}

/** Split a list into fixed-size chunks (fileUpdate is called per chunk). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
