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

/** The Nalpac main feed's "Image 1" column for a zero-media product's SKU, or null. */
export function nalpacImageOneUrl(mainRow: Record<string, string> | undefined): string | null {
  return mainRow?.['Image 1']?.trim() || null
}

// ─── Layer 2: signature-ground compositing (docs/store-team/shop-image-strategy.md) ───

/** '#FFE6DD' or 'FFE6DD' (3- or 6-digit) -> {r,g,b}. Throws on an unparseable value. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const stripped = hex.trim().replace(/^#/, '')
  const full = stripped.length === 3 ? stripped.split('').map(c => c + c).join('') : stripped
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`invalid hex color: ${hex}`)
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export interface GroundPlacement {
  width: number
  height: number
  left: number
  top: number
}

/**
 * Resize-and-center placement for a product cutout on a square ground canvas:
 * the product's longer edge becomes `scale` of `canvasSize`, aspect ratio is
 * preserved, and the result is centered. Pure arithmetic so it is testable
 * without decoding an actual image.
 */
export function computeGroundPlacement(
  productWidth: number,
  productHeight: number,
  canvasSize: number,
  scale: number,
): GroundPlacement {
  if (productWidth <= 0 || productHeight <= 0) throw new Error('product dimensions must be positive')
  const longEdge = Math.max(productWidth, productHeight)
  const factor = (canvasSize * scale) / longEdge
  const width = Math.max(1, Math.round(productWidth * factor))
  const height = Math.max(1, Math.round(productHeight * factor))
  return {
    width,
    height,
    left: Math.round((canvasSize - width) / 2),
    top: Math.round((canvasSize - height) / 2),
  }
}

/**
 * A soft contact-shadow ellipse, sized off the placed product and anchored to
 * where it meets the ground, as an SVG string ready for sharp to rasterize and
 * blur. Kept pure (string in, string out) so geometry is unit-testable without
 * an image library.
 */
export function contactShadowSvg(canvasSize: number, placement: GroundPlacement): string {
  const rx = Math.max(1, Math.round(placement.width * 0.4))
  const ry = Math.max(1, Math.round(rx * 0.22))
  const cx = canvasSize / 2
  const cy = placement.top + placement.height - Math.round(ry * 0.6)
  return `<svg width="${canvasSize}" height="${canvasSize}" xmlns="http://www.w3.org/2000/svg">`
    + `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="black" fill-opacity="0.22" /></svg>`
}
