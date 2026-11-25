/**
 * Ticket #24094: the IPX7-as-shower defect (app/lib/ipx7-water-grant.ts and
 * app/lib/pdp-water-grant.ts) also lives in two Shopify metafields neither
 * checker reads — `xdipx.care_instructions` and `xdipx.specifications` — a
 * blind spot found on a live PDP (le-wand-classique-petite-wand-massager,
 * sku 96378) where `care_instructions` extended an IPX7 rating into a
 * shower/bath grant with a self-contradicting charging-port clause.
 *
 * Every IPX-sweep instrument the content lane owns reads Sanity blogPost
 * documents; this one reads the two Shopify metafields instead, so it is
 * additive rather than a duplicate of ipx7-water-grant.ts or
 * pdp-water-grant.ts.
 *
 * Scoped, per the ticket's own DONE WHEN, to IPX4 and IPX7 specifically: a
 * bullet that names one of those two codes in the same sentence as a
 * shower/bath/running-water word is a co-occurrence hit worth a human read,
 * not a sophisticated grant-with-no-restriction judgment like the other two
 * checkers make. This is a sizing sweep ("is this one sku or hundreds"), so
 * it is deliberately a cheap, over-inclusive co-occurrence count rather than
 * a precision-tuned predicate — a bullet that already carries a correct
 * restriction clause still counts, and a human reads the count down.
 */

export type IpRatingMetafieldSurface = 'care_instructions' | 'specifications'
export type FlaggedIpCode = 'IPX4' | 'IPX7'

const FLAGGED_IP_CODES: readonly FlaggedIpCode[] = ['IPX4', 'IPX7']

/** Shower, bath, or running-water (tap/jet) language. */
const WATER_LANGUAGE_RE = /\bshower\b|\bbath\b|\brunning water\b|\btap\b|\bjets?\b/i

/** True when a single bullet string names one of the two flagged IP codes. */
function bulletNamesFlaggedIpCode(bullet: string | null | undefined): boolean {
  if (!bullet) return false
  return FLAGGED_IP_CODES.some(code => new RegExp(`\\b${code}\\b`, 'i').test(bullet))
}

/** True when a single bullet string carries shower/bath/running-water language. */
function bulletHasWaterLanguage(bullet: string | null | undefined): boolean {
  if (!bullet) return false
  return WATER_LANGUAGE_RE.test(bullet)
}

/**
 * True when a single bullet string names one of the two flagged IP codes and
 * also carries shower/bath/running-water language, anywhere in the string.
 */
export function bulletNamesFlaggedIpCodeWithWaterLanguage(
  bullet: string | null | undefined,
): boolean {
  return bulletHasWaterLanguage(bullet) && bulletNamesFlaggedIpCode(bullet)
}

export interface IpRatingMetafieldHit {
  surface: IpRatingMetafieldSurface
  bullet: string
}

export interface IpRatingMetafieldProductBullets {
  handle: string
  careInstructions: string[]
  specifications: string[]
}

/**
 * Scans one product's care_instructions and specifications bullets for the
 * co-occurrence. Correlates across the two fields, not just within a single
 * bullet: a flagged IP code named in `specifications` and water language
 * named in a *different* `care_instructions` bullet (or vice versa) is the
 * same unsupported-claim shape as a single self-contained bullet, and ticket
 * #24094's own flagship product (le-wand-classique-petite-wand-massager)
 * only reproduces this way — the IP code and the water language sit in two
 * separate metafields, so a same-bullet-only check never flags it.
 */
export function findIpRatingMetafieldHits(
  product: IpRatingMetafieldProductBullets,
): IpRatingMetafieldHit[] {
  const entries: Array<{ surface: IpRatingMetafieldSurface; bullet: string; hasCode: boolean; hasWater: boolean }> = []
  const surfaces: Array<[IpRatingMetafieldSurface, string[]]> = [
    ['care_instructions', product.careInstructions],
    ['specifications', product.specifications],
  ]
  for (const [surface, bullets] of surfaces) {
    for (const bullet of bullets) {
      entries.push({
        surface,
        bullet,
        hasCode: bulletNamesFlaggedIpCode(bullet),
        hasWater: bulletHasWaterLanguage(bullet),
      })
    }
  }

  const productHasCode = entries.some(e => e.hasCode)
  const productHasWater = entries.some(e => e.hasWater)
  if (!productHasCode || !productHasWater) return []

  return entries
    .filter(e => e.hasCode || e.hasWater)
    .map(({ surface, bullet }) => ({ surface, bullet }))
}
