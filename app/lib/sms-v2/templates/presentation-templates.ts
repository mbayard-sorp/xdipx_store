/**
 * app/lib/sms-v2/templates/presentation-templates.ts
 *
 * Deterministic FALLBACK templates for the PRESENTATION stage.
 * Used when the fabrication validator catches the LLM output.
 *
 * Voice: Emma — warm, specific, playful. No em-dashes. No countdowns.
 * No "Buy now." Brand is "XDIPX" in billing context only; in copy, site is "xdipx.com."
 *
 * Each variant is a pure function of { title, price, pdpUrl }.
 * Kept under 480 chars to fit SMS display.
 */

export interface PresentationSlots {
  title:  string
  price:  string
  pdpUrl: string
}

export type PresentationTemplate = (slots: PresentationSlots) => string

/** Variant A — leading with the product name and value. */
export const templateA: PresentationTemplate = ({ title, price, pdpUrl }) =>
  `${title} is ${price} and honestly, it earns its price. This one keeps coming up when people ask me what to get first. Ready to take a peek? ${pdpUrl}`

/** Variant B — curiosity hook, price reveal at end. */
export const templateB: PresentationTemplate = ({ title, price, pdpUrl }) =>
  `${title} has been on my radar for a reason. ${price}, ships discreetly, and it delivers. Take a look: ${pdpUrl}\nWant the rundown or ready to grab it?`

/** Variant C — Emma aside first, hard facts second. */
export const templateC: PresentationTemplate = ({ title, price, pdpUrl }) =>
  `Still thinking about ${title} a week after I tried it, which is the best sign. ${price}. Full details here: ${pdpUrl}\n"I\'ll take it ♥" when you\'re ready.`

/** Variant D — brief, to the point, nudges to commit. */
export const templateD: PresentationTemplate = ({ title, price, pdpUrl }) =>
  `${title}, ${price}. No fluff. It does what it says. ${pdpUrl}\nShoot back "I\'ll take it ♥" and I\'ll get you sorted.`

/** Ordered list of all templates for round-robin or random selection. */
export const PRESENTATION_TEMPLATES: ReadonlyArray<PresentationTemplate> = [
  templateA,
  templateB,
  templateC,
  templateD,
]

/**
 * Pick a deterministic template variant based on a hash of the product handle.
 * This keeps the variant stable per-product (same product always gets same template)
 * while distributing across the variants.
 */
export function pickPresentationTemplate(
  slots: PresentationSlots,
  handleHint?: string,
): string {
  const seed = handleHint ?? slots.title
  // Simple stable hash — not crypto, just distribution
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const idx = hash % PRESENTATION_TEMPLATES.length
  const fn  = PRESENTATION_TEMPLATES[idx]!
  return fn(slots)
}
