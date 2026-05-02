/**
 * app/lib/sms-v2/templates/objection-templates.ts
 *
 * Deterministic FALLBACK templates for the OBJECTION stage.
 * Used when the fabrication validator catches a PDP URL or price mismatch
 * in the LLM output.
 *
 * Voice: Emma, warm and honest. No em-dashes. No countdowns.
 * No "Buy now." No invented specs.
 *
 * Slots: { title, price, brief }
 *   title  — product name
 *   price  — formatted price string, e.g. "$49.99"
 *   brief  — one short sentence acknowledging the concern (caller supplies this)
 *
 * Each variant stays under 480 chars.
 */

export interface ObjectionTemplateSlots {
  title: string
  price: string
  brief: string
}

export type ObjectionTemplate = (slots: ObjectionTemplateSlots) => string

/**
 * Variant A: Acknowledge the concern, restate value, invite follow-up.
 */
export const objectionTemplateA: ObjectionTemplate = ({ title, price, brief }) =>
  `${brief} ${title} is ${price}, and that price is for something that actually delivers. If there's a specific thing holding you back, I'm happy to dig in. What's the sticking point?`

/**
 * Variant B: Direct acknowledgment, price anchor, open question.
 */
export const objectionTemplateB: ObjectionTemplate = ({ title, price, brief }) =>
  `Totally fair. ${brief} ${title} at ${price} gets a lot of side-eye until people actually use it. Is it the price itself, or something about what it does?`

/**
 * Variant C: Empathetic, then pivot to the specific concern.
 */
export const objectionTemplateC: ObjectionTemplate = ({ title, price, brief }) =>
  `I hear you. ${brief} ${title} is ${price} and worth every cent in my experience, but I'd rather help you feel sure than push. What would help you feel better about it?`

/** Ordered list for rotation. */
export const OBJECTION_TEMPLATES: ReadonlyArray<ObjectionTemplate> = [
  objectionTemplateA,
  objectionTemplateB,
  objectionTemplateC,
]

/**
 * Pick a deterministic template variant based on a stable hash of the product
 * title. Same product always gets the same fallback template for consistency.
 */
export function pickObjectionTemplate(
  slots: ObjectionTemplateSlots,
  handleHint?: string,
): string {
  const seed = handleHint ?? slots.title
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const idx = hash % OBJECTION_TEMPLATES.length
  const fn = OBJECTION_TEMPLATES[idx]!
  return fn(slots)
}
