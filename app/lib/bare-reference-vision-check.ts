/**
 * bare-reference-vision-check.ts
 *
 * Pure classification/decision core for ticket #12912 (owner-approved
 * 2026-10-01, all-hands on social product variety, sibling of #12875/
 * #12876/#12877). The catalog-wide `xdipx.bare_product_reference` backfill
 * (`scripts/resolve-bare-product-references.ts --apply`, run 2026-10-01)
 * resolved 1,617 of 5,331 products to `url: null`; 1,615 of those share one
 * reason: "the only media entry has no altText and no sibling to confirm it
 * against; not trusted as bare" — `resolveBareProductReference`'s
 * (`app/lib/shopify.server.ts`) filename/altText/sibling heuristic can never
 * confirm a single-photo product bare on text alone. That is roughly 30% of
 * the catalog locked out of social imagery (`api.team.social-image.tsx`
 * refuses any handle with no confirmed reference).
 *
 * This module is the pure half of `scripts/vision-check-bare-reference.ts`:
 * given a vision model's free-text classification of one such product's
 * single image, decide whether that image may be trusted as the bare
 * reference, or must stay `url: null` with a specific reason. Kept dependency-
 * free and side-effect-free so the decision logic — the part that matters
 * for not repeating SKU 96203 (a carton briefed as the product, the model
 * inventing a stalk and club that do not exist) — is unit-testable without a
 * network call or an API key.
 *
 * FAIL-CLOSED BY DESIGN: only the exact 'bare-text-free' label writes a url.
 * Every other label, including a vision response this module cannot parse
 * at all, keeps url: null. Loosening the carton/wordmark/AI-generated
 * refusals is explicitly out of scope (ticket's own words) — a fuzzy-match
 * miss degrades to "still locked out of social, try again later", never to
 * "briefed from a carton".
 */

/** The five classes the ticket itself specifies, in the order it lists them. */
export const VISION_BARE_REFERENCE_LABELS = [
  'bare-text-free',
  'bare-with-label',
  'carton',
  'lifestyle',
  'ai-generated-or-other',
] as const

export type VisionBareReferenceLabel = (typeof VISION_BARE_REFERENCE_LABELS)[number]

/** What the model should answer with, in the exact wording the ticket uses
 *  for each class — shown to the model in the prompt and used below to
 *  fuzzy-match a response that didn't come back as the bare label token. */
export const VISION_BARE_REFERENCE_LABEL_PROMPT_TEXT: Record<VisionBareReferenceLabel, string> = {
  'bare-text-free': 'bare product, text-free',
  'bare-with-label': 'bare product with a legible wordmark or printed label',
  carton: 'retail carton or packaging',
  lifestyle: 'lifestyle or model shot',
  'ai-generated-or-other': 'AI-generated or other',
}

/**
 * Parse a vision model's free-text reply into one of the five labels.
 * Fail-closed: a reply that doesn't cleanly match any label, or matches
 * ambiguously, resolves to `ai-generated-or-other` — the safe, non-writing
 * bucket — never to `bare-text-free`, which is the only label with the
 * authority to write a url.
 */
export function parseVisionBareReferenceLabel(raw: string): VisionBareReferenceLabel {
  const norm = raw.trim().toLowerCase().replace(/[.!]+$/, '')
  const exact = (VISION_BARE_REFERENCE_LABELS as readonly string[]).find(l => l === norm)
  if (exact) return exact as VisionBareReferenceLabel

  // Carton/packaging and AI-generated are checked before the bare checks so
  // a response like "a bare product, but it's actually packaging" cannot be
  // misread as bare-text-free by the looser bare patterns below.
  if (/carton|packaging|\bbox\b/.test(norm)) return 'carton'
  if (/\bai[- ]?generated\b|\bsynthetic\b/.test(norm)) return 'ai-generated-or-other'
  if (/lifestyle|model (shot|is)|holding|being (held|used)|on (a|someone's) (body|hand|skin)/.test(norm)) return 'lifestyle'
  if (/wordmark|logo|printed label|brand(ing)? (text|label)/.test(norm)) return 'bare-with-label'
  if (/\bbare\b/.test(norm) && /text-free|text free|no text|no label|no wordmark/.test(norm)) return 'bare-text-free'

  // Nothing matched: an unparseable response is exactly the case this
  // module must never guess its way past.
  return 'ai-generated-or-other'
}

export interface VisionBareReferenceDecision {
  label: VisionBareReferenceLabel
  url: string | null
  reason: string
}

/**
 * The actual write/no-write decision for one classified image. Only
 * 'bare-text-free' returns a non-null url; every other label returns
 * `url: null` with a reason specific enough to read back later (mirrors
 * `BareProductReferenceResolution.reason` in shopify.server.ts, prefixed so
 * a later reader can tell a vision-check verdict apart from the heuristic's).
 */
export function decideBareReferenceFromVisionLabel(
  label: VisionBareReferenceLabel,
  imageUrl: string,
): VisionBareReferenceDecision {
  if (label === 'bare-text-free') {
    return { label, url: imageUrl, reason: 'vision check: confirmed bare, text-free product frame' }
  }
  return { label, url: null, reason: `vision check: ${VISION_BARE_REFERENCE_LABEL_PROMPT_TEXT[label]}` }
}

/** One line of the system prompt sent to the vision model, listing the five
 *  classes verbatim so the model's own reply vocabulary matches this
 *  module's parser as closely as possible. Exported so the script and a
 *  test can both assert the prompt actually lists all five. */
export const VISION_BARE_REFERENCE_SYSTEM_PROMPT =
  'You are looking at ONE product photo. Classify it as exactly one of these five labels ' +
  '(reply with the label token only, nothing else):\n' +
  VISION_BARE_REFERENCE_LABELS.map(l => `- ${l}: ${VISION_BARE_REFERENCE_LABEL_PROMPT_TEXT[l]}`).join('\n') +
  '\n\n"bare-text-free" means the product itself, alone, on a plain background, with no wordmark, ' +
  'logo, or printed text visible anywhere in frame. If any brand name or text is legible on the ' +
  'product or its surface, use "bare-with-label" instead, even if the product is otherwise bare. ' +
  'If this is the retail box, blister pack, or any packaging, use "carton". If a person is holding, ' +
  'wearing, or otherwise using the product, or it sits in a styled scene rather than a plain product ' +
  'shot, use "lifestyle". If the image looks synthetic/AI-rendered rather than a photograph, use ' +
  '"ai-generated-or-other". Reply with the label token only.'
