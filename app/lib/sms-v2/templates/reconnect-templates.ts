/**
 * app/lib/sms-v2/templates/reconnect-templates.ts
 *
 * Phase 6b — RECONNECT stage templates.
 * Customer returned after >24h. One-turn stage.
 * No LLM call. No em-dashes. No product pitches. Under 480 chars.
 * Brand motif: heart symbol in CTAs.
 */

// ─── With prior order context ────────────────────────────────────────────────

export type ReconnectWithOrderSlots = {
  itemTitle: string
}

const WITH_ORDER_TEMPLATES: ReadonlyArray<(s: ReconnectWithOrderSlots) => string> = [
  ({ itemTitle }) =>
    `Welcome back. Last time you grabbed ${itemTitle}. Let me know if it's working out, or if you're looking for something new. ♥`,

  ({ itemTitle }) =>
    `Hey, good to hear from you again. How's the ${itemTitle} treating you? Happy to help with whatever you need today.`,

  ({ itemTitle }) =>
    `Welcome back. You had the ${itemTitle} last time. Let me know if there's anything I can help with, or if you're exploring something different.`,

  ({ itemTitle }) =>
    `Oh hey, you're back. Hope the ${itemTitle} has been a good one. What can I do for you today?`,
]

// ─── Without prior order (cold reconnect) ───────────────────────────────────

const WITHOUT_ORDER_TEMPLATES: ReadonlyArray<() => string> = [
  () => `Welcome back ♥ What brings you in today?`,
  () => `Hey, glad you're back. What are you looking for today?`,
  () => `Welcome back. What can I help you find?`,
  () => `Oh good, you're here again. What's on your mind?`,
]

// ─── Pickers ────────────────────────────────────────────────────────────────

/**
 * Pick a template variant using time-based rotation (stable within a call,
 * varied across conversations).
 */
export function pickReconnectWithOrderTemplate(slots: ReconnectWithOrderSlots): string {
  const idx = Math.floor(Date.now() / 7000) % WITH_ORDER_TEMPLATES.length
  const fn = WITH_ORDER_TEMPLATES[idx]!
  return fn(slots)
}

export function pickReconnectColdTemplate(): string {
  const idx = Math.floor(Date.now() / 7000) % WITHOUT_ORDER_TEMPLATES.length
  const fn = WITHOUT_ORDER_TEMPLATES[idx]!
  return fn()
}
