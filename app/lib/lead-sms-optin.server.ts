/**
 * The one switch for SMS opt-in on the paid-lead funnel (owner blocker 731).
 *
 * This is a KILL SWITCH for the SMS path, not a launch gate. The owner's
 * Twilio number is A2P-registered (Low Volume Mixed campaign, verified for
 * marketing and transactional SMS), a Twilio sender is being built, and the
 * phone and SMS-consent fields keep collecting consent in the meantime
 * (consent_log rows are written; subscribeToSms still returns early without
 * KLAVIYO_SMS_LIST_ID). Flipping the valve to 'false' is the instant,
 * no-deploy way to stop asking: the /hello page then renders no phone or
 * consent field, and /api/lead ignores both even if a client sends them.
 *
 * Default ON: `getKillSwitch` reads a missing `lead_sms_optin_enabled` row,
 * an unapplied seed, or a DB error as on, so there is no migration and a
 * slow database never changes what the page asks. LEAD_SMS_OPTIN_ENABLED=0
 * in the environment forces it off (a preview deploy, say); =1 forces it on.
 */

import { getKillSwitch, VALVE_KEYS } from '~/lib/team.server'

/** '0' forces off, '1' forces on, anything else defers to the valve. */
export function leadSmsOptinEnvOverride(): boolean | null {
  const v = process.env['LEAD_SMS_OPTIN_ENABLED']
  if (v === '0') return false
  if (v === '1') return true
  return null
}

export async function isLeadSmsOptinEnabled(): Promise<boolean> {
  const forced = leadSmsOptinEnvOverride()
  if (forced !== null) return forced
  return getKillSwitch(VALVE_KEYS.leadSmsOptin)
}
