/**
 * app/lib/sms-v2/templates/support-templates.ts
 *
 * Phase 6b — SUPPORT stage deterministic templates.
 * No LLM. No em-dashes. No countdowns. Under 480 chars.
 * Brand: XDIPX (billing context only). In prose, site is xdipx.com.
 *
 * 4 status variants + 1 not-found fallback.
 *
 * #3519: SHIPPED_TEMPLATES built its sentence around trackingUrl. The voice
 * adapter strips URLs before TTS, so a voice caller heard "Track it here,"
 * trail off into nothing. SHIPPED now has a channel-aware pair: SMS keeps
 * the link inline, VOICE speaks the carrier/status and asks a real question
 * instead of dangling a half sentence.
 */

export type SupportTemplateChannel = 'sms' | 'voice' | 'web'

export interface SupportOrderSlots {
  orderName: string
  trackingUrl?: string
  trackingNumber?: string
  carrier?: string
  lastScan?: string
}

// ─── Paid (order placed, not yet fulfilled) ───────────────────────────────────

const PAID_TEMPLATES: ReadonlyArray<(s: SupportOrderSlots) => string> = [
  ({ orderName }) =>
    `Order ${orderName} is confirmed and paid. We're getting it ready to ship now. I'll have tracking for you once it's on its way. Anything else I can help with?`,

  ({ orderName }) =>
    `Got it. ${orderName} is paid and sitting in the queue. Should be heading out soon. Ping me when you need tracking and I'll have it.`,

  ({ orderName }) =>
    `${orderName} went through great. It's paid and in fulfillment now. Tracking will be on its way to you before it ships. Anything else?`,

  ({ orderName }) =>
    `${orderName} is confirmed. Payment cleared, and the team is packing it up. You'll get tracking info via email. Need anything else?`,
]

// ─── Fulfilled (packed, label created, not yet scanned) ───────────────────────

const FULFILLED_TEMPLATES: ReadonlyArray<(s: SupportOrderSlots) => string> = [
  ({ orderName }) =>
    `${orderName} is packed and the label's been created. Carrier hasn't scanned it into their system yet, so tracking may not show movement right away. That's normal. Check back in a few hours.`,

  ({ orderName }) =>
    `Order ${orderName} is fulfilled on our end. The package is labeled and waiting for carrier pickup. Tracking should go live within 24 hours.`,

  ({ orderName }) =>
    `${orderName} is packed and ready to go. Label created, waiting on the carrier scan. Tracking link will activate once they pick it up. You good for now?`,

  ({ orderName }) =>
    `Good news: ${orderName} is fulfilled. Label's created and it's heading to the carrier. Tracking goes live after their first scan, usually within a day.`,
]

// ─── Shipped / In Transit ────────────────────────────────────────────────────

const SHIPPED_TEMPLATES: ReadonlyArray<(s: SupportOrderSlots) => string> = [
  ({ orderName, trackingUrl, lastScan }) =>
    `${orderName} is on its way.${lastScan ? ` Last scan: ${lastScan}.` : ''} Track it here: ${trackingUrl ?? 'check your shipping email for the link'}. Need anything else?`,

  ({ orderName, carrier, trackingNumber, trackingUrl }) =>
    `${orderName} shipped${carrier ? ` via ${carrier}` : ''}.${trackingNumber ? ` Tracking: ${trackingNumber}.` : ''} ${trackingUrl ?? ''} Anything I can help with?`,

  ({ orderName, lastScan, trackingUrl }) =>
    `${orderName} is in transit.${lastScan ? ` Last update: ${lastScan}.` : ''} Full tracking: ${trackingUrl ?? 'in your shipping confirmation email'}. Hang tight.`,

  ({ orderName, carrier, trackingUrl }) =>
    `Your order ${orderName} is moving${carrier ? ` with ${carrier}` : ''}. Track it: ${trackingUrl ?? 'see your shipping email'}. ${lastScanNote()} Let me know if it stalls.`,
]

function lastScanNote(): string {
  return ''
}

// Voice bank: never a bare "Track it here," — the voice adapter strips the
// URL before TTS and leaves a dangling half sentence. Speak the carrier and
// last scan instead, and ask (a real question) whether to text the tracking
// link rather than asserting it's already been sent.
const SHIPPED_VOICE_TEMPLATES: ReadonlyArray<(s: SupportOrderSlots) => string> = [
  ({ orderName, carrier, lastScan }) =>
    `${orderName} is on its way${carrier ? ` with ${carrier}` : ''}.${lastScan ? ` Last scan was ${lastScan}.` : ''} Want me to text you the tracking link?`,

  ({ orderName, carrier }) =>
    `${orderName} shipped${carrier ? ` via ${carrier}` : ''} and is moving. Want the tracking link texted to you?`,

  ({ orderName, lastScan }) =>
    `${orderName} is in transit.${lastScan ? ` Last update was ${lastScan}.` : ''} I can text you the full tracking link, want that?`,

  ({ orderName, carrier }) =>
    `Your order ${orderName} is moving${carrier ? ` with ${carrier}` : ''}. Should I text you the tracking link?`,
]

// ─── Delivered ───────────────────────────────────────────────────────────────

const DELIVERED_TEMPLATES: ReadonlyArray<(s: SupportOrderSlots) => string> = [
  ({ orderName }) =>
    `${orderName} shows as delivered. If you haven't found it, check with neighbors or your building's mail area. If it's still missing, email hello@xdipx.com and we'll sort it out.`,

  ({ orderName }) =>
    `Looks like ${orderName} was delivered. Can't find it? Email hello@xdipx.com with your order number and we'll investigate right away.`,

  ({ orderName }) =>
    `${orderName} is marked delivered on our end. If something's off, email hello@xdipx.com and we'll get on it. We take care of our people.`,

  ({ orderName }) =>
    `Tracking says ${orderName} arrived. If you can't find it, give us a shout at hello@xdipx.com with the order number and we'll handle it.`,
]

// ─── Not Found fallback ──────────────────────────────────────────────────────

export const NOT_FOUND_REPLY =
  `I don't see an order on that number. It could be under a different phone. Can you give me the order number? It starts with #.`

// ─── Picker ─────────────────────────────────────────────────────────────────

type StatusKey = 'paid' | 'fulfilled' | 'shipped' | 'delivered'

const TEMPLATE_MAP: Record<StatusKey, ReadonlyArray<(s: SupportOrderSlots) => string>> = {
  paid:      PAID_TEMPLATES,
  fulfilled: FULFILLED_TEMPLATES,
  shipped:   SHIPPED_TEMPLATES,
  delivered: DELIVERED_TEMPLATES,
}

/**
 * Pick a deterministic template by rotating on seconds-epoch / 7 mod N.
 * Stable within a few seconds; varied across calls.
 *
 * Channel default is 'sms' for backwards compatibility; voice callers must
 * pass 'voice' explicitly. Only 'shipped' has a distinct voice bank — the
 * others never carry a URL and are safe to speak as written.
 */
export function pickSupportTemplate(
  status: StatusKey,
  slots: SupportOrderSlots,
  channel: SupportTemplateChannel = 'sms',
): string {
  const pool = status === 'shipped' && channel === 'voice' ? SHIPPED_VOICE_TEMPLATES : TEMPLATE_MAP[status]
  const idx = Math.floor(Date.now() / 7000) % pool.length
  const fn = pool[idx]!
  return fn(slots)
}
