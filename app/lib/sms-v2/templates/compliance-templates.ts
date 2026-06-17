/**
 * app/lib/sms-v2/templates/compliance-templates.ts
 *
 * Verbatim from v1's sms-processor.server.ts. Kept here so v2 handlers
 * can import without depending on the v1 processor file. Source of truth
 * remains a single literal string per template — do not diverge.
 *
 * HELP_REPLY / STOP_REPLY / START_REPLY stay on v1 — they're the
 * carrier-required compliance keywords handled upstream of stage dispatch.
 * The age-gate / age-welcome strings move here so the new GREETING and
 * CONSENT_GATE handlers can import them without reaching into v1.
 */

export const AGE_GATE_REPLY =
  "xdipx is 18+ only. Reply YES to confirm you're 18 or older AND agree to receive recurring marketing texts from xdipx (auto-dialed, ~4 msgs/month, msg & data rates may apply). Reply STOP to opt out anytime, HELP for help."

export const AGE_WELCOME_REPLY =
  "You're in. I'm Emma — ask me anything about our products or your orders. What's on your mind?"

export const RETURNING_GREETING_REPLY =
  "Welcome back. What can I help you find today?"
