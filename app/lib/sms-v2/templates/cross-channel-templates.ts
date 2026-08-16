/**
 * app/lib/sms-v2/templates/cross-channel-templates.ts
 *
 * Phase 10 — Cross-channel continuation templates.
 *
 * Used by the RECONNECT handler when Emma detects that the customer was
 * active on another channel recently. Slots: {channelLabel, productTitle}.
 *
 * Rules:
 *   - Emma voice — warm, personal, no em-dashes, under 480 chars.
 *   - Never "Buy now". Never a countdown.
 *   - Give the customer an easy out ("or look at something else").
 *
 * #3519: the SMS bank offered "I can send you the link" with no permission
 * gate and no channel branch. On a phone call that promise has no wiring
 * behind it unless the caller's turn also carries a productCard.pdpUrl — the
 * voice adapter's permission gate reads that field, not the prose, to decide
 * what a later "yes" means. reconnect.server.ts now attaches the card; the
 * VOICE bank asks the same thing as a natural spoken question so the gate
 * has something to arm.
 */

export type CrossChannelTemplateChannel = 'sms' | 'voice' | 'web'

export interface CrossChannelSlots {
  /** Human-readable channel label — "web chat" or "text". */
  channelLabel: string
  /** Product title or handle fallback. */
  productTitle: string
}

const SMS_TEMPLATES: ReadonlyArray<(s: CrossChannelSlots) => string> = [
  ({ channelLabel, productTitle }) =>
    `Welcome back. You were looking at ${productTitle} on ${channelLabel} earlier. Want to keep going, or are you shopping for something different today?`,

  ({ productTitle }) =>
    `Hey, picking up where you left off. Still curious about ${productTitle}? I can send you the link, or we can start fresh.`,

  ({ channelLabel, productTitle }) =>
    `You were checking out ${productTitle} on ${channelLabel}. Want me to send the link, or look at something else?`,
]

// Voice bank: no "send you the link" as a bare statement — it reads as a
// promise with nothing armed behind it. Each variant either asks outright
// (so the productCard.pdpUrl permission gate has a real question to answer)
// or offers a spoken alternative that needs no link at all.
const VOICE_TEMPLATES: ReadonlyArray<(s: CrossChannelSlots) => string> = [
  ({ productTitle }) =>
    `Welcome back. You were looking at ${productTitle} earlier. Want to keep going, or are you after something different today?`,

  ({ productTitle }) =>
    `Picking up where you left off. Still curious about ${productTitle}? Want me to text you the link, or should we start fresh?`,

  ({ productTitle }) =>
    `You were checking out ${productTitle} last time we talked. Want me to text you the link, or look at something else?`,
]

/**
 * Pick a template variant and fill slots. Channel default is 'sms' for
 * backwards compatibility; voice callers must pass 'voice' explicitly.
 */
export function pickCrossChannelTemplate(
  slots: CrossChannelSlots,
  channel: CrossChannelTemplateChannel = 'sms',
): string {
  const bank = channel === 'voice' ? VOICE_TEMPLATES : SMS_TEMPLATES
  const idx = Math.floor(Date.now() / 7000) % bank.length
  const fn = bank[idx]!
  return fn(slots)
}
