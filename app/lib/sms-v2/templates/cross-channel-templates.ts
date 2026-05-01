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
 */

export interface CrossChannelSlots {
  /** Human-readable channel label — "web chat" or "text". */
  channelLabel: string
  /** Product title or handle fallback. */
  productTitle: string
}

const TEMPLATES: ReadonlyArray<(s: CrossChannelSlots) => string> = [
  ({ channelLabel, productTitle }) =>
    `Welcome back. You were looking at ${productTitle} on ${channelLabel} earlier. Want to keep going, or are you shopping for something different today?`,

  ({ productTitle }) =>
    `Hey, picking up where you left off. Still curious about ${productTitle}? I can send you the link, or we can start fresh.`,

  ({ channelLabel, productTitle }) =>
    `You were checking out ${productTitle} on ${channelLabel}. Want me to send the link, or look at something else?`,
]

/**
 * Pick a template using time-based rotation, matching the pattern used by
 * other template pickers in this directory.
 */
export function pickCrossChannelTemplate(slots: CrossChannelSlots): string {
  const idx = Math.floor(Date.now() / 7000) % TEMPLATES.length
  const fn = TEMPLATES[idx]!
  return fn(slots)
}
