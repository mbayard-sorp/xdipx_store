/**
 * The one switch for SMS opt-in on the paid-lead funnel (owner blocker 731).
 *
 * KLAVIYO_SMS_LIST_ID is unset in production and the owner expects Klaviyo to
 * refuse SMS for a sex-toy store; a Twilio path needs the same A2P 10DLC
 * carrier approval. Until some sending path is approved, the /hello page must
 * not ask for a phone number or SMS consent, and /api/lead must not act on
 * either even when a client sends them. Both read this function.
 *
 * On when the `lead_sms_optin_enabled` valve is 'true' (owner-flipped on the
 * Ad Studio Spend tab, audited) or LEAD_SMS_OPTIN_ENABLED=1 is in the
 * environment. Fails closed: a DB error reads as off.
 */

import { getValve, VALVE_KEYS } from '~/lib/team.server'

export function leadSmsOptinEnvOverride(): boolean {
  return process.env['LEAD_SMS_OPTIN_ENABLED'] === '1'
}

export async function isLeadSmsOptinEnabled(): Promise<boolean> {
  if (leadSmsOptinEnvOverride()) return true
  try {
    return await getValve(VALVE_KEYS.leadSmsOptin)
  } catch (err) {
    console.error('[lead-sms-optin] valve read failed, treating as off', err)
    return false
  }
}
