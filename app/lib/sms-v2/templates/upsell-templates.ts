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
 *
 * Channel-aware variants:
 *   - SMS: PDP URL on its own line with https:// prefix (iMessage auto-renders
 *     the OG preview), emoji + "yes/no" closer for thumb-friendly typing.
 *   - VOICE: NO URL (TTS can't speak it), NO emoji, NO "👍" (read aloud as
 *     "thumbs up sign"). Closer reads as a natural spoken question. The voice
 *     adapter's permission gate sets pendingPdpUrl from the productCard and
 *     handles the link-text-permission flow on the NEXT turn.
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

export type UpsellTemplateChannel = 'sms' | 'voice' | 'web'

const SMS_TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price, pdpUrl }) =>
    `Real talk — skipping a good lube is the #1 regret folks tell me about. ${name} (${price}) is the one I'd send a friend home with.\n\n${pdpUrl}\n\n👍 to toss it in, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `One thing the catalog makes obvious: the right pairing matters more than people think. ${name} (${price}) is the move here.\n\n${pdpUrl}\n\n👍 / 'yes' to add it, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `If you're new to this, trust me on ${name} (${price}). It's the difference between 'this is fine' and 'oh, that's why people love this'.\n\n${pdpUrl}\n\n👍 to add it, 'no thanks' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Worth knowing: ${name} (${price}) is a repeat buy for a reason. The ones who skip it always ask what they missed.\n\n${pdpUrl}\n\n👍 / 'yes' to toss it in, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Honest pro tip: ${name} (${price}) turns a good experience into a great one. Most folks regret skipping it more than any toy choice.\n\n${pdpUrl}\n\n👍 to add it, 'no' to skip.`,
]

// Web chat variants: the product card below the reply already renders the link,
// so the URL has no place in the prose. Tap-friendly closers replace the SMS
// "👍 / 'yes'" pattern — the stage emits pillOptions that render as tap chips.
const WEB_TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price }) =>
    `Real talk — skipping a good lube is the #1 regret folks tell me about. **${name}** (${price}) is the one I'd send a friend home with. Toss it in?`,

  ({ name, price }) =>
    `One thing the catalog makes obvious: the right pairing matters more than people think. **${name}** (${price}) is the move here. Add it?`,

  ({ name, price }) =>
    `If you're new to this, trust me on **${name}** (${price}). It's the difference between 'this is fine' and 'oh, that's why people love this'. Want it?`,

  ({ name, price }) =>
    `Worth knowing: **${name}** (${price}) is a repeat buy for a reason. The ones who skip it always ask what they missed. Add it?`,

  ({ name, price }) =>
    `Honest pro tip: **${name}** (${price}) turns a good experience into a great one. Most folks regret skipping it more than any toy choice. Toss it in?`,
]

// Voice variants: TTS-friendly. No URLs (we never speak URLs aloud — the voice
// adapter handles the link-permission flow via pendingPdpUrl on the NEXT turn).
// No emoji, no "/" alternation, no quote marks. Natural spoken sentences.
// Prices written long-form so TTS reads them cleanly ("forty-two dollars", not
// "$42") — the IVR's tts-normalize layer also handles dollar-sign expansion,
// but we go natural here so a misread doesn't sound robotic.
const VOICE_TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price }) =>
    `Real talk, skipping a good lube is the number one regret folks tell me about. ${name} runs about ${price}. Want me to add it?`,

  ({ name, price }) =>
    `One thing the catalog makes obvious, the right pairing matters more than people think. ${name} at ${price} is the move here. Should I include it?`,

  ({ name, price }) =>
    `If you're new to this, trust me on ${name}, runs about ${price}. It's the difference between this is fine and oh, that's why people love this. Add it for you?`,

  ({ name, price }) =>
    `Worth knowing, ${name} at ${price} is a repeat buy for a reason. The ones who skip it always ask what they missed. Want me to toss it in?`,

  ({ name, price }) =>
    `Honest pro tip, ${name} at ${price} turns a good experience into a great one. Most folks regret skipping it more than any toy choice. Should I add it?`,
]

/**
 * Pick a template variant and fill slots.
 * Rotation: seconds-epoch / 7 mod N — stable within a few seconds,
 * different across calls spaced by time. Use this over Math.random() so
 * the same call within a retry window returns the same template.
 *
 * Channel default is 'sms' for backwards compatibility (the deterministic
 * UPSELL handler only takes a channel arg if the caller plumbs it). Voice
 * callers must pass 'voice' explicitly.
 */
export function pickUpsellTemplate(
  slots: UpsellTemplateSlots,
  channel: UpsellTemplateChannel = 'sms',
): string {
  const bank =
    channel === 'voice' ? VOICE_TEMPLATES :
    channel === 'web'   ? WEB_TEMPLATES :
    SMS_TEMPLATES
  const idx = (Math.floor(Date.now() / 7000)) % bank.length
  const fn = bank[idx]!
  return fn(slots)
}
