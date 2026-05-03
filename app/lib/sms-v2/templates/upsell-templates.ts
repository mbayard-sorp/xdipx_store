/**
 * app/lib/sms-v2/templates/upsell-templates.ts
 *
 * Deterministic upsell prose templates for the UPSELL stage handler.
 * No LLM — slots are filled server-side. Emma voice: warm, direct, no em-dashes,
 * no "buy now", no "sex" as adjective, no countdowns.
 *
 * Each template:
 *   - Leads with one beat of EXPERTISE so Emma sounds like a guru, not a checkout
 *     prompt. Establishing trust at the upsell moment is the difference between
 *     a thoughtful pairing and an empty "want fries with that".
 *   - Does NOT reveal the existence of a checkout link yet. The customer hasn't
 *     been told a link is coming, and saying "before the link" leaks the next
 *     step before they've seen the value.
 *   - Puts the PDP URL on its own line with https:// prefix so iMessage and
 *     other modern messaging clients auto-render the OG preview without us
 *     paying for MMS.
 *   - Ends with a clear yes/no so the next-turn parser can act.
 *
 * Slots: {name}, {price}, {pdp_url}
 *
 * Variant selection: rotate by seconds-epoch mod N so repeated calls within a
 * few seconds stay stable, but different conversations get different templates.
 */

export interface UpsellTemplateSlots {
  name: string
  price: string
  pdpUrl: string
}

const TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price, pdpUrl }) =>
    `Real talk — skipping a good lube is the #1 regret folks tell me about. ${name} (${price}) is the one I'd send a friend home with.\n\n${pdpUrl}\n\n👍 to toss it in, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `One thing I've learned testing a lot of these: the right pairing matters more than people think. ${name} (${price}) is the move here.\n\n${pdpUrl}\n\n👍 / 'yes' to add it, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `If you're new to this, trust me on ${name} (${price}). It's the difference between 'this is fine' and 'oh, that's why people love this'.\n\n${pdpUrl}\n\n👍 to add it, 'no thanks' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Worth knowing — ${name} (${price}) lives on my nightstand. The folks who skip it always come back asking what they missed.\n\n${pdpUrl}\n\n👍 / 'yes' to toss it in, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Honest pro tip: ${name} (${price}) turns a good experience into a great one. Most folks regret skipping it more than any toy choice.\n\n${pdpUrl}\n\n👍 to add it, 'no' to skip.`,
]

/**
 * Pick a template variant and fill slots.
 * Rotation: seconds-epoch / 7 mod N — stable within a few seconds,
 * different across calls spaced by time. Use this over Math.random() so
 * the same call within a retry window returns the same template.
 */
export function pickUpsellTemplate(slots: UpsellTemplateSlots): string {
  const idx = (Math.floor(Date.now() / 7000)) % TEMPLATES.length
  const fn = TEMPLATES[idx]!
  return fn(slots)
}
