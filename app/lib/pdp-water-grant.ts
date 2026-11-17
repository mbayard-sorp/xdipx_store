/**
 * Ticket #22588: the IPX7-as-shower defect (app/lib/ipx7-water-grant.ts,
 * scoped to the Notebook blogPost surface) also lives in PDP copy — the
 * product description and the xdipx-namespace tagline and full_story
 * ("Emma's take") metafields — a surface nothing audits. Found by content
 * run 2074 while running the mandatory PDP-as-source pre-flight on a
 * product it wanted to embed.
 *
 * Unlike the Notebook case, two of the three live instances found carry no
 * IP code at all — the grant rests on a bare vendor adjective ("waterproof",
 * "washable") or a depth figure ("up to 20 inches") rather than a misapplied
 * rating. So this predicate widens the basis check past "mentions IPX7" to
 * any of: a vendor waterproofing adjective, a bare depth figure, or an IPX7
 * mark, each promoted — with no restriction clause in the same sentence —
 * into a shower, bath, jet, or tap permission that the stated basis does
 * not actually certify.
 *
 * Mirrors sentenceGrantsUnrestrictedIpx7Water's three-part shape (mentions a
 * basis, grants water use, carries no restriction) and reuses the same
 * restriction vocabulary shape, since the house wording for "this is not a
 * shower/bath grant" repeats across both surfaces.
 *
 * ── Known limit ─────────────────────────────────────────────────────────
 * A reusable-token checker, the same shape and the same limit as
 * ipx7-water-grant.ts and self-consistency.ts: it only sees a basis-and-grant
 * pair when both are named in the same sentence. A sentence that refers back
 * to the rating by pronoun ("that rating", "it") instead of repeating a basis
 * token is invisible to it. A false positive here is cheap — one more
 * sentence read that turns out fine; a missed instance is a live safety
 * overreach, so this stays deliberately over-inclusive on the grant phrases
 * it does recognize, rather than clever.
 */
import { splitSentences } from './aphorism-closer'

/**
 * A weak water-safety basis: a vendor waterproofing adjective, a bare depth
 * figure (inches/feet/meters/cm with no accompanying IP code), or an IPX7
 * mark (which certifies still-water immersion only, not jets or running
 * water — see ipx7-water-grant.ts's own header).
 */
const WEAK_WATER_BASIS_RE =
  /\bwaterproof\b|\bwater-?resistant\b|\bwashable\b|\bsubmersible\b|\bIPX7\b|\b\d+\s*(?:inch(?:es)?|in\.|feet|ft\.?|meters?|metres?|m\b|cm)\b/i

/**
 * A plain grant of shower, bath, jet, or running-tap use, phrased as a
 * permission rather than a bare mention. Extended past
 * ipx7-water-grant.ts's GRANTS_WATER_RE and ipx-faq-remediation.ts's
 * GRANTS_WATER with the "for the shower" / "clears it for" / "lives in"
 * constructions that the live PDP evidence actually used.
 */
const GRANTS_WATER_PERMISSION_RE =
  /shower[ -]?(?:play|time|use|safe|adventures|shenanigans|sessions|moments|spray|ready)|steamy shower|in the (?:shower|bath)\b|lives in the (?:shower|bath)|for the (?:shower|bath|jets?|tap)\b|clears? it for the (?:shower|bath)|under (?:the|a) (?:tap|faucet|running water)|submersion up to|aquatic adventures|bath (?:play|time|adventures)/i

/** Any clause that restricts water use, mirroring the house wording. */
const RESTRICTS_WATER_RE =
  /don'?t|do not|never|avoid|not (?:for|designed|recommended|shower[- ]?safe|built|made|completely|fully|submers)|isn'?t (?:for|shower|on the table)|not shower-safe|sink rinse only|keep it (?:out of|dry|above)|no submers|not submers|does not cover (?:jets|showers?)|immersion only/i

/**
 * True when a single sentence names a weak water basis and grants
 * shower/bath/jet/tap use with no restriction clause anywhere in that same
 * sentence.
 */
export function sentenceGrantsUnrestrictedPdpWater(sentence: string | null | undefined): boolean {
  if (!sentence) return false
  if (!WEAK_WATER_BASIS_RE.test(sentence)) return false
  if (!GRANTS_WATER_PERMISSION_RE.test(sentence)) return false
  if (RESTRICTS_WATER_RE.test(sentence)) return false
  return true
}

export type PdpWaterGrantSurface = 'description' | 'tagline' | 'fullStory'

export interface PdpWaterGrantHit {
  surface: PdpWaterGrantSurface
  sentence: string
}

export interface PdpProductCopy {
  handle: string
  description?: string | null
  tagline?: string | null
  fullStory?: string | null
}

/** Strips HTML tags before sentence-splitting; descriptionHtml/fullStory may carry markup. */
function toPlainText(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

/** Scans one product's description, tagline, and fullStory (Emma's take) surfaces for the defect. */
export function findPdpWaterGrants(product: PdpProductCopy): PdpWaterGrantHit[] {
  const hits: PdpWaterGrantHit[] = []
  const surfaces: Array<[PdpWaterGrantSurface, string | null | undefined]> = [
    ['description', product.description],
    ['tagline', product.tagline],
    ['fullStory', product.fullStory],
  ]
  for (const [surface, text] of surfaces) {
    if (!text) continue
    for (const sentence of splitSentences(toPlainText(text))) {
      if (sentenceGrantsUnrestrictedPdpWater(sentence)) {
        hits.push({ surface, sentence: sentence.trim() })
      }
    }
  }
  return hits
}
