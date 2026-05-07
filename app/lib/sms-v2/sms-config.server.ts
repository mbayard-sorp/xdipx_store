/**
 * SMS template runtime config accessor.
 *
 * Mirrors the shape of app/lib/ivr-config.server.ts. Returns three SMS
 * strings whose customization is admin-only (no env-var layer): admin UI
 * writes them to pipelineSettings, this resolver reads them with a
 * hardcoded default fallback.
 *
 * Resolution priority for each key: pipelineSettings row → hardcoded default.
 *
 * Wraps:
 *   - AGE_WELCOME_REPLY          (post-confirm 18+ welcome message)
 *   - the static returning-customer greeting (used when discovery-welcome
 *     can't reach Haiku; admins also want to be able to nudge the tone)
 *   - the CHECKOUT-stage closing line that ships the cart URL
 *
 * The regulatory AGE_GATE_REPLY (the 18+ disclosure itself) is intentionally
 * NOT exposed here — it stays hardcoded so admins can't accidentally weaken
 * the consent language.
 */
import { inArray } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../../db/schema'
import { withTimeout } from '~/lib/twilio.server'
// Inlined here to break a circular import: sms-processor.server imports
// getSmsConfig from this file; this file cannot import back from it.
// The canonical export of AGE_WELCOME_REPLY stays in sms-processor.server.ts
// for all other callers — this local copy is only used internally by sms-config.
const AGE_WELCOME_REPLY =
  "You're in. I'm Emma — ask me anything about our daily deals, products, or your orders. What's on your mind?"

/** Default returning-customer greeting prefix. Mirrors discovery-welcome's
 *  static fallback wording so behaviour stays the same when no override
 *  is set. The literal `{firstName}` slot is substituted by the caller. */
const SMS_DEFAULT_RETURNING_GREETING = 'Hey {firstName}, welcome back.'

/** Default CHECKOUT closing line. The literal `{url}` slot is substituted
 *  with the Shopify checkout URL at send time. */
const SMS_DEFAULT_CHECKOUT_CLOSING = "Here's your checkout:\n{url}"

export const SMS_CONFIG_KEYS = [
  'smsAgeWelcome',
  'smsReturningGreeting',
  'smsCheckoutClosing',
] as const

export type SmsConfigKey = (typeof SMS_CONFIG_KEYS)[number]

export interface SmsConfig {
  /** Reply sent after a customer confirms 18+ on first SMS contact. */
  ageWelcome: string
  /** Greeting prefix for returning customers. Slot: `{firstName}`. */
  returningGreeting: string
  /** Closing line that ships the cart URL. Slot: `{url}`. */
  checkoutClosing: string
}

export const SMS_DEFAULTS: SmsConfig = {
  ageWelcome: AGE_WELCOME_REPLY,
  returningGreeting: SMS_DEFAULT_RETURNING_GREETING,
  checkoutClosing: SMS_DEFAULT_CHECKOUT_CLOSING,
}

/**
 * Read all three SMS template overrides from pipelineSettings in a single
 * query. Falls back to hardcoded defaults on missing rows or DB timeout —
 * we never want a Neon hiccup to break an inbound SMS.
 */
export async function getSmsConfig(): Promise<SmsConfig> {
  const rows = await withTimeout(
    db
      .select({ key: pipelineSettings.key, value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(inArray(pipelineSettings.key, SMS_CONFIG_KEYS as unknown as string[])),
    3000,
    [] as Array<{ key: string; value: string | null }>,
    'getSmsConfig',
  )

  const map = new Map(rows.map((r) => [r.key, r.value]))
  const trim = (s: string | null | undefined): string => (s ?? '').trim()

  return {
    ageWelcome: trim(map.get('smsAgeWelcome')) || SMS_DEFAULTS.ageWelcome,
    returningGreeting: trim(map.get('smsReturningGreeting')) || SMS_DEFAULTS.returningGreeting,
    checkoutClosing: trim(map.get('smsCheckoutClosing')) || SMS_DEFAULTS.checkoutClosing,
  }
}

/**
 * Substitute `{url}` in the checkout closing template. Whitespace around
 * the slot is preserved (the default has a newline before the URL so it
 * lands on its own line for the iMessage preview).
 */
export function fillCheckoutClosing(template: string, url: string): string {
  return template.replace(/\{url\}/g, url)
}

/**
 * Substitute `{firstName}` in the returning-customer greeting. Empty/null
 * names are tolerated — the slot is replaced with an empty string and
 * callers should trim adjoining whitespace as needed.
 */
export function fillReturningGreeting(template: string, firstName: string | null | undefined): string {
  return template.replace(/\{firstName\}/g, (firstName ?? '').trim())
}
