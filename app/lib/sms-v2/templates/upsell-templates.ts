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

// #3218: closers speak to what the customer will feel from the pairing, never to
// what other customers felt or regretted. Emma is an AI guide with no lived
// experience, so no "folks tell me", no "most people regret it", no invented
// collective sentiment. Each variant is distinct; pickUpsellTemplate keys the
// rotation to the session pitch ordinal so no two pitches in one conversation
// share a closer.
const SMS_TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price, pdpUrl }) =>
    `Real talk, the right pairing changes how everything else feels. ${name} (${price}) fits right with what you picked.\n\n${pdpUrl}\n\n👍 to toss it in, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `One thing worth knowing: the pairing matters as much as the main event. ${name} (${price}) is the move here.\n\n${pdpUrl}\n\n👍 / 'yes' to add it, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `New to this? ${name} (${price}) is a solid place to start. It smooths the gap between 'this works' and 'oh, that's the point'.\n\n${pdpUrl}\n\n👍 to add it, 'no thanks' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Worth knowing: ${name} (${price}) is the kind of add you notice the second it's missing.\n\n${pdpUrl}\n\n👍 / 'yes' to toss it in, 'no' to skip.`,

  ({ name, price, pdpUrl }) =>
    `Honest pro tip: ${name} (${price}) turns a good night into a better one. Small add, real difference.\n\n${pdpUrl}\n\n👍 to add it, 'no' to skip.`,
]

// Web chat variants: the product card below the reply already renders the link,
// so the URL has no place in the prose. Tap-friendly closers replace the SMS
// "👍 / 'yes'" pattern — the stage emits pillOptions that render as tap chips.
const WEB_TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price }) =>
    `Real talk, the right pairing changes how everything else feels. **${name}** (${price}) fits right with what you picked. Toss it in?`,

  ({ name, price }) =>
    `One thing worth knowing: the pairing matters as much as the main event. **${name}** (${price}) is the move here. Add it?`,

  ({ name, price }) =>
    `New to this, **${name}** (${price}) is a solid place to start. It smooths the gap between 'this works' and 'oh, that's the point'. Want it?`,

  ({ name, price }) =>
    `Worth knowing: **${name}** (${price}) is the kind of add you notice the second it's missing. Add it?`,

  ({ name, price }) =>
    `Honest pro tip: **${name}** (${price}) turns a good night into a better one. Small add, real difference. Toss it in?`,
]

// Voice variants: TTS-friendly. No URLs (we never speak URLs aloud — the voice
// adapter handles the link-permission flow via pendingPdpUrl on the NEXT turn).
// No emoji, no "/" alternation, no quote marks. Natural spoken sentences.
// Prices written long-form so TTS reads them cleanly ("forty-two dollars", not
// "$42") — the IVR's tts-normalize layer also handles dollar-sign expansion,
// but we go natural here so a misread doesn't sound robotic.
const VOICE_TEMPLATES: ReadonlyArray<(slots: UpsellTemplateSlots) => string> = [
  ({ name, price }) =>
    `Real talk, the right pairing changes how everything else feels. ${name} runs about ${price}. Want me to add it?`,

  ({ name, price }) =>
    `One thing worth knowing, the pairing matters as much as the main event. ${name} at ${price} is the move here. Should I include it?`,

  ({ name, price }) =>
    `New to this, ${name} runs about ${price}, and it's a solid place to start. It smooths the gap between this works and oh, that's the point. Add it for you?`,

  ({ name, price }) =>
    `Worth knowing, ${name} at ${price} is the kind of add you notice the second it's missing. Want me to toss it in?`,

  ({ name, price }) =>
    `Honest pro tip, ${name} at ${price} turns a good night into a better one. Small add, real difference. Should I add it?`,
]

/**
 * Pick a template variant and fill slots.
 *
 * Rotation: when the caller passes `pitchIndex` (how many products it has already
 * pitched this session), the closer is keyed to that ordinal, so consecutive
 * pitches in one conversation never share a closer until the bank wraps
 * (#3218 — the voice log showed two different lubes getting the identical closer
 * in a single call). Callers without session context omit it and fall back to the
 * seconds-epoch / 7 rotation, which is stable within a retry window and varies
 * across calls spaced by time. Both avoid Math.random() so a retried call is
 * deterministic.
 *
 * Channel default is 'sms' for backwards compatibility (the deterministic
 * UPSELL handler only takes a channel arg if the caller plumbs it). Voice
 * callers must pass 'voice' explicitly.
 */
export function pickUpsellTemplate(
  slots: UpsellTemplateSlots,
  channel: UpsellTemplateChannel = 'sms',
  pitchIndex?: number,
): string {
  const bank =
    channel === 'voice' ? VOICE_TEMPLATES :
    channel === 'web'   ? WEB_TEMPLATES :
    SMS_TEMPLATES
  const base =
    pitchIndex !== undefined ? pitchIndex : Math.floor(Date.now() / 7000)
  const idx = ((base % bank.length) + bank.length) % bank.length
  const fn = bank[idx]!
  return fn(slots)
}

/**
 * Render an upsell using a CURATED pairing blurb as the lead (#3516).
 *
 * When the pitched product carries an editorial `xdipx.pairing_why` aside for
 * this accessory, that curated, product-specific line replaces the generic
 * "expertise beat" the rotating templates open with — it already says why the
 * two belong together, in Emma's voice. The channel mechanics are unchanged
 * from the templates above: voice speaks no URL and no emoji, SMS drops the PDP
 * URL on its own line for the iMessage preview, web leans on the product card
 * and its tap chips. The blurb is authored copy (emma-product-enricher, gated),
 * so it is used verbatim; only the framing closer is templated here.
 *
 * Callers pass this only when a blurb exists; with no blurb they fall back to
 * pickUpsellTemplate so a curated product with no aside still gets a pitch.
 */
export function renderCuratedUpsellTemplate(
  slots: UpsellTemplateSlots,
  pairingWhy: string,
  channel: UpsellTemplateChannel = 'sms',
): string {
  const blurb = pairingWhy.trim().replace(/\s+/g, ' ')
  const { name, price, pdpUrl } = slots

  if (channel === 'voice') {
    return `${blurb} ${name} runs about ${price}. Want me to add it?`
  }
  if (channel === 'web') {
    return `${blurb} **${name}** (${price}). Toss it in?`
  }
  // sms — PDP URL on its own line so iMessage renders the OG preview.
  return `${blurb}\n\n${name} (${price}).\n\n${pdpUrl}\n\n👍 to toss it in, 'no' to skip.`
}
