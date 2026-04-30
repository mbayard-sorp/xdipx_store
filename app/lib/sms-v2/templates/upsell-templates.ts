/**
 * app/lib/sms-v2/templates/upsell-templates.ts
 *
 * Deterministic upsell prose templates for the UPSELL stage handler.
 * No LLM — slots are filled server-side. Emma voice: warm, direct, no em-dashes,
 * no "buy now", no "sex" as adjective, no countdowns.
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
    `One quick add before the link: ${name} (${price}). Pairs really well together.\n${pdpUrl}\n\nReply 'yes' to toss it in, or 'checkout' if you're set.`,

  ({ name, price, pdpUrl }) =>
    `If you're grabbing this, ${name} is the one I tell everyone about. ${price}.\n${pdpUrl}\n\nWant it in too? Just say 'yes'. Or 'checkout' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Quick one: ${name} (${price}) goes really nicely with this pick.\n${pdpUrl}\n\nAdd it? Reply 'yes' or 'checkout' to skip ahead.`,

  ({ name, price, pdpUrl }) =>
    `Before I send the link, worth a look: ${name} at ${price}.\n${pdpUrl}\n\nI've been recommending this combo a lot. 'yes' to add, 'checkout' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Almost done. ${name} (${price}) rounds this out nicely, been living on my nightstand.\n${pdpUrl}\n\nReply 'yes' to add it, or 'checkout' and I'll send your cart link.`,
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
