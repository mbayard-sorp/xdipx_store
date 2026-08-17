/**
 * app/lib/sms-v2/templates/email-delivery-templates.ts
 *
 * Emma-voice prose for the email-delivery beat of the link handoff.
 * Ticket #3914 (non-protected slice of #3517). Pure functions, no state,
 * no async, no LLM.
 *
 * Three moments:
 *   - emailChoice   — offer the delivery choice (text / email / cart).
 *   - addressCapture — ask for the email address.
 *   - addressConfirm — read the captured address back before sending.
 *
 * This module only provides the strings. Wiring the beat into the checkout
 * flow (a protected path) is the #3517 owner PR.
 *
 * Voice rules (CLAUDE.md / docs/emma-voice.md, support register 2-3 — this is
 * a logistics beat, not a temptation beat):
 *   - No em-dashes (periods and commas only; hyphens in compounds are fine).
 *   - No "buy" / "buy now", no countdowns, no "sex"/"sexy" as an adjective.
 *   - Emma is an AI guide with no lived experience.
 *   - Channel-aware: the 'voice' variant carries no URL, no emoji, and none of
 *     the SMS-only idioms ("reply", "tap", "click") that read as garbage aloud;
 *     it ends on a spoken question. SMS/web may use those idioms.
 */

export type EmailDeliveryChannel = 'sms' | 'voice' | 'web'

export interface AddressConfirmSlots {
  email: string
}

// Deterministic-friendly rotation: callers may pass an ordinal (e.g. the turn
// count) for stable variety; without one we fall back to a cosmetic random
// pick, same convention as the other template banks.
function pick<T>(arr: ReadonlyArray<T>, ordinal?: number): T {
  const n = arr.length
  const idx =
    ordinal == null ? Math.floor(Math.random() * n) : ((ordinal % n) + n) % n
  return arr[idx]!
}

// ---------------------------------------------------------------------------
// emailChoice — offer the three ways to get the link
// ---------------------------------------------------------------------------

const EMAIL_CHOICE_SMS: ReadonlyArray<() => string> = [
  () => `Want the link by text, by email, or should I pull it up in your cart? Your call.`,
  () => `How do you want it: text, email, or straight to your cart? Just say the word.`,
  () => `I can text the link, email it, or drop it in your cart. Which works best?`,
]

const EMAIL_CHOICE_VOICE: ReadonlyArray<() => string> = [
  () => `Would you like that link by text, by email, or shall I pull it up in your cart?`,
  () => `I can send it by text, send it by email, or add it to your cart. Which would you prefer?`,
]

/** Offer the delivery choice. */
export function emailChoiceTemplate(
  channel: EmailDeliveryChannel,
  ordinal?: number,
): string {
  const bank = channel === 'voice' ? EMAIL_CHOICE_VOICE : EMAIL_CHOICE_SMS
  return pick(bank, ordinal)()
}

// ---------------------------------------------------------------------------
// addressCapture — ask for the email
// ---------------------------------------------------------------------------

const ADDRESS_CAPTURE_SMS: ReadonlyArray<() => string> = [
  () => `Perfect. What is the best email for it?`,
  () => `Great. What email should I send it to?`,
  () => `On it. What is the best email to use?`,
]

const ADDRESS_CAPTURE_VOICE: ReadonlyArray<() => string> = [
  () => `Perfect. What is the best email to send it to?`,
  () => `Great. What email address should I use?`,
]

/** Ask the customer for their email address. */
export function addressCaptureTemplate(
  channel: EmailDeliveryChannel,
  ordinal?: number,
): string {
  const bank = channel === 'voice' ? ADDRESS_CAPTURE_VOICE : ADDRESS_CAPTURE_SMS
  return pick(bank, ordinal)()
}

// ---------------------------------------------------------------------------
// addressConfirm — read the captured address back
// ---------------------------------------------------------------------------

const ADDRESS_CONFIRM_SMS: ReadonlyArray<(s: AddressConfirmSlots) => string> = [
  ({ email }) => `Got it. I will send it to ${email}. That look right?`,
  ({ email }) => `Sending to ${email}. Did I get that right?`,
  ({ email }) => `Perfect, ${email} it is. Sound right?`,
]

const ADDRESS_CONFIRM_VOICE: ReadonlyArray<(s: AddressConfirmSlots) => string> = [
  ({ email }) => `Got it. I will send it to ${email}. Did I get that right?`,
  ({ email }) => `Sending it to ${email}. Is that correct?`,
]

/** Read the captured email back for confirmation. */
export function addressConfirmTemplate(
  slots: AddressConfirmSlots,
  channel: EmailDeliveryChannel,
  ordinal?: number,
): string {
  const bank = channel === 'voice' ? ADDRESS_CONFIRM_VOICE : ADDRESS_CONFIRM_SMS
  return pick(bank, ordinal)(slots)
}
