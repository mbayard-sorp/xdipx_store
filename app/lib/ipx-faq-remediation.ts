/**
 * Ticket #4871: IP-code FAQ remediation for the Sanity productPage.productFaqs
 * surface.
 *
 * Ticket #1006's fixer (scripts/fix-ipx-shower-claims.ts) corrected the Shopify
 * metafields (descriptionHtml, full_story, feature_bullets, seo_meta_description,
 * specifications) but never touched PDP FAQs, which are a separate Sanity surface
 * (productPage.productFaqs, read by getProductFaqs). So a handful of the 24
 * remediated SKUs ended up contradicting themselves on the same live PDP: the
 * corrected Shopify copy says "not shower-safe, never submerge" while a stale
 * AI-generated FAQ answer on the same page still grants shower play, and one
 * (honey-play-box-tickler) carried a factually WRONG water-ingress instruction
 * ("IPX6 waterproof rated for shower play and submersion up to 3 feet"): IPX6 is
 * jet resistance, not immersion — submersion is IPX7 (1m/30min).
 *
 * The two pure pieces below are extracted so they are unit-tested without
 * Shopify, Sanity, or a network:
 *   - faqGrantsUnrestrictedWater: the audit predicate. Flags an FAQ answer that
 *     grants shower / bath / submersion use with no restriction clause — the
 *     exact defect class the ticket scopes ("flag any answer that grants shower
 *     or bath use with no restriction clause"), plus an over-grant of submersion
 *     for a jet-rated product.
 *   - planFaqAnswerPatch: decides, for one productPage's FAQ array, whether a
 *     given old->new answer correction applies, is already applied (idempotent
 *     re-run), or has drifted (exact-match guard, mirroring the Shopify fixer).
 *
 * The correction DATA (FAQ_ANSWER_CORRECTIONS) lives here too so the audit test
 * can prove every stale answer is flagged and every replacement is clean.
 * IP-code framing matches the per-SKU stance the #1006 fixer already established:
 * IPX4/5/6 = splash or jet resistance (sink rinse/cleanup only, no shower or
 * bath claim, never submerge); IPX7 = immersion to 1m/30min (shower and bath
 * fine). None of these 24 SKUs is IPX7.
 */

/** Positive grants of shower / bath / submersion use. */
const GRANTS_WATER =
  /shower[ -]?(?:play|time|use|safe|adventures|shenanigans|sessions|moments|spray)|steamy shower|in the (?:shower|bath)\b|submersion up to|aquatic adventures|bath (?:play|time|adventures)/i

/** Any clause that restricts water use (submersion / shower / bath limits). */
const RESTRICTS_WATER =
  /don'?t|do not|never|avoid|not (?:for|designed|recommended|shower[- ]?safe|built|made|completely|fully|submers)|isn'?t (?:for|on the table|where|shower)|aren'?t on the table|off the table|skip the (?:shower|bath)|out of (?:the (?:shower|bath)|both)|above the waterline|stick to (?:dry|shower)|might be pushing it|keep it dry|not submers|no submers/i

/**
 * True when an FAQ answer grants shower/bath/submersion use without any clause
 * restricting it. This is the audit criterion for DONE WHEN (c): after
 * remediation, zero of the 24 fixer handles' FAQ answers may return true.
 */
export function faqGrantsUnrestrictedWater(answer: string | null | undefined): boolean {
  if (!answer) return false
  return GRANTS_WATER.test(answer) && !RESTRICTS_WATER.test(answer)
}

export interface FaqAnswerCorrection {
  handle: string
  /** For the report only. */
  ipCode: string
  /** Must match the live stored answer exactly; a drift is skipped and reported. */
  oldAnswer: string
  newAnswer: string
}

/**
 * The three self-contradictory / factually-wrong FAQ answers confirmed by the
 * content-writer run 448 audit. Each oldAnswer is the exact live-stored string
 * (verified against production Sanity 2026-08-22); each newAnswer matches the
 * SKU's corrected Shopify framing and its true IP code.
 */
export const FAQ_ANSWER_CORRECTIONS: FaqAnswerCorrection[] = [
  {
    handle: 'honey-play-box-tickler-wiggling-g-spot-vibrator-tapping-clitoral-stimulator',
    ipCode: 'IPX6',
    oldAnswer:
      "Yes, it's IPX6 waterproof rated for shower play and submersion up to 3 feet. The multiple motors and controls still function perfectly when wet, making it great for aquatic adventures.",
    newAnswer:
      'Its IPX6 rating is splash-resistant, not submersion-proof, so it handles splashes and a quick rinse for cleanup but is not made for the shower or the bath. IPX6 covers water jets, not immersion, so never put it underwater. Keep it above the waterline and dry it fully before charging.',
  },
  {
    handle: 'pep-talk',
    ipCode: 'IPX6',
    oldAnswer:
      'Absolutely. It has an IPX6 waterproof rating, which means it can handle water splashing from any direction. Perfect for some steamy shower time.',
    newAnswer:
      'Its IPX6 rating is splash-resistant, so it shrugs off splashes and rinses clean easily at the sink, but the shower is not where this pep talk happens, so keep it out of the shower and the bath and never submerge it.',
  },
  {
    handle: 'curve-toys-gossip-pop-rocker-rechargeable-remote-controlled-silicone-vibrating-anal-plug-magenta',
    ipCode: 'IPX5',
    oldAnswer:
      'Yes, it has an IPX5 waterproof rating so it can handle splashes and shower play. Just make sure the charging port is fully closed before getting it wet.',
    newAnswer:
      'Its IPX5 rating is splash-resistant, so it handles sink splashes and a quick rinse for cleanup, but it is not made for the shower or the bath, so keep it out of both and never submerge it. Make sure the charging port is fully closed and dry before it goes near water.',
  },
]

/** One planned correction against a live FAQ array. */
export type FaqAnswerPatchPlan =
  | { status: 'already' }
  | { status: 'not_found' }
  | { status: 'patch'; key: string }

/**
 * Pure decision for one old->new answer correction against a productPage's FAQ
 * array. `already` when a sibling entry already carries the new answer (an
 * idempotent re-run), `patch` with the matching entry's _key, or `not_found`
 * when no entry's answer exactly equals oldAnswer (drift — skip and report,
 * never fuzzy-match).
 */
export function planFaqAnswerPatch(
  faqs: Array<{ _key?: string | null; answer?: string | null }>,
  oldAnswer: string,
  newAnswer: string,
): FaqAnswerPatchPlan {
  if (faqs.some(f => f.answer === newAnswer)) return { status: 'already' }
  const target = faqs.find(f => f.answer === oldAnswer && f._key)
  return target?._key ? { status: 'patch', key: target._key } : { status: 'not_found' }
}
