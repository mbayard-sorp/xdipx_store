/**
 * app/lib/sms-v2/email-delivery.server.ts
 *
 * Email delivery of a cart/checkout link for the conversation pipeline.
 * Ticket #3914 — the NON-PROTECTED (a) slice of #3517 (give customers a
 * delivery choice for their link: SMS / email / cart).
 *
 * Everything here is pure or reuses existing machinery — no schema/db change
 * and no diff to any protected path. Three concerns:
 *
 *   1. extractEmail / isValidEmail — parse and validate an email the customer
 *      types into the conversation.
 *   2. A tiny capture -> confirm state machine expressed as a plain object that
 *      rides along in the EXISTING conversation-state JSON (no new column).
 *   3. sendCartLinkEmail — emit the link through the EXISTING Klaviyo event
 *      machinery (klaviyo.server.ts trackStartedCheckout), behind the same
 *      config gating that already guards those calls, so nothing is sent when
 *      Klaviyo is unconfigured.
 *
 * EXPLICITLY out of scope (lands in the #3517 owner PR, which touches the
 * protected checkout stage): wiring the delivery-choice beat into
 * stages/checkout.server.ts, multi-line cart expansion, session cart
 * accumulation, and the real production send with live cart data.
 */
import { trackStartedCheckout } from '~/lib/klaviyo.server'

// ---------------------------------------------------------------------------
// 1. Email parsing + validation
// ---------------------------------------------------------------------------

// Pragmatic, deliberately conservative address shape: a local part, a single
// '@', and a dotted domain with a 2+ char TLD. Not a full RFC 5322 grammar
// (that matches strings no mail server accepts); this is the shape a customer
// actually types and Klaviyo will accept as a profile identifier.
const EMAIL_CORE = "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}"
const EMAIL_ANYWHERE_RE = new RegExp(EMAIL_CORE, 'i')
const EMAIL_ANCHORED_RE = new RegExp(`^${EMAIL_CORE}$`, 'i')

/** True when the trimmed string is a single, well-formed email address. */
export function isValidEmail(email: string): boolean {
  return EMAIL_ANCHORED_RE.test(email.trim())
}

/**
 * Pull the first email address out of a free-text message, normalized to
 * lower-case. Returns null when the text contains no address. Callers that
 * need a hard yes/no should still gate on isValidEmail(result).
 */
export function extractEmail(text: string): string | null {
  const match = text.match(EMAIL_ANYWHERE_RE)
  return match ? match[0].toLowerCase() : null
}

// ---------------------------------------------------------------------------
// 2. capture -> confirm state (rides in the existing conversation-state JSON)
// ---------------------------------------------------------------------------

export type EmailDeliveryStatus = 'none' | 'pending_confirm' | 'confirmed'

export interface EmailDeliveryState {
  status: EmailDeliveryStatus
  /** The captured address. Null until a valid one is captured. */
  email: string | null
}

export const EMPTY_EMAIL_DELIVERY_STATE: EmailDeliveryState = { status: 'none', email: null }

/**
 * Try to capture an email from the customer's message. A valid address moves
 * the state to `pending_confirm` (we read it back before sending); anything
 * else leaves the state empty so the caller can re-ask.
 */
export function captureEmailFromText(text: string): EmailDeliveryState {
  const email = extractEmail(text)
  if (email && isValidEmail(email)) {
    return { status: 'pending_confirm', email }
  }
  return { ...EMPTY_EMAIL_DELIVERY_STATE }
}

/**
 * Resolve the confirm step. From `pending_confirm`: an affirmative reply moves
 * to `confirmed` (the caller may now send); a negative reply clears the state
 * so the caller re-asks for the address. Any other starting state resets to
 * empty, so a stray "yes" never fabricates a `confirmed` with no address.
 */
export function resolveEmailConfirmation(
  state: EmailDeliveryState,
  affirmative: boolean,
): EmailDeliveryState {
  if (state.status !== 'pending_confirm' || !state.email) {
    return { ...EMPTY_EMAIL_DELIVERY_STATE }
  }
  return affirmative
    ? { status: 'confirmed', email: state.email }
    : { ...EMPTY_EMAIL_DELIVERY_STATE }
}

// ---------------------------------------------------------------------------
// 3. Send the link via the existing Klaviyo machinery
// ---------------------------------------------------------------------------

/** Matches klaviyo.server.ts's internal LineItemInfo shape. */
export interface CartLinkEmailItem {
  productHandle?: string
  productTitle?: string
  variantId?: string
  price?: number
  quantity?: number
}

export interface SendCartLinkEmailInput {
  email: string
  cartUrl: string
  items: CartLinkEmailItem[]
  /** Optional explicit cart id. Defaults to the cart URL (see sendCartLinkEmail). */
  cartId?: string
  /** ISO 4217 code. Defaults to USD. */
  currency?: string
  /** Klaviyo dedupe key so a retried send is not double-counted. */
  uniqueId?: string
}

export interface SendCartLinkEmailResult {
  sent: boolean
  reason?: string
}

/**
 * True when the Klaviyo credentials the event API needs are present. Mirrors
 * the guard used by the SMS Klaviyo helpers so nothing hits the network when
 * the integration is unconfigured (dev, preview, or a missing secret).
 */
export function isEmailDeliveryConfigured(): boolean {
  return Boolean((process.env['KLAVIYO_API_KEY'] ?? '').trim())
}

/**
 * Emit the cart link to the customer's email through the existing "Started
 * Checkout" Klaviyo event, which drives the abandoned-checkout flow that
 * renders the recovery link. Returns { sent:false, reason } without touching
 * the network when the address is invalid or Klaviyo is unconfigured.
 *
 * The payload is built to trackStartedCheckout's real parameter type (via
 * Parameters<>), not a hand-copied shape, so it cannot drift from the function
 * it calls (routine-dev-daily.md §3d).
 */
export async function sendCartLinkEmail(
  input: SendCartLinkEmailInput,
): Promise<SendCartLinkEmailResult> {
  if (!isValidEmail(input.email)) {
    return { sent: false, reason: 'invalid-email' }
  }
  if (!isEmailDeliveryConfigured()) {
    return { sent: false, reason: 'klaviyo-unconfigured' }
  }

  const currency = input.currency ?? 'USD'
  const value = input.items.reduce(
    (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
    0,
  )

  // In the headless flow the cart permalink IS the durable cart identifier:
  // trackStartedCheckout dedupes on cartId and Klaviyo's Started Checkout flow
  // renders the recovery link from it. The real production wiring (the live
  // Shopify cart id + URL threaded from the checkout stage) lands in the #3517
  // owner PR; this slice only builds the correctly-shaped call.
  const params: Parameters<typeof trackStartedCheckout>[1] = {
    cartId: input.cartId ?? input.cartUrl,
    value,
    currency,
    items: input.items,
    ...(input.uniqueId ? { uniqueId: input.uniqueId } : {}),
  }

  await trackStartedCheckout(input.email, params)
  return { sent: true }
}
