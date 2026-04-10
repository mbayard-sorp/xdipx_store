import { rotateDeal } from './deal-rotator.server'

/**
 * Runs at 11:59 PM via /cron/deal-activator
 *
 * Delegates to the shared rotateDeal() function which:
 *   1. Transitions the current live deal to vault pricing
 *   2. Activates the next scheduled deal
 *   3. Triggers Klaviyo daily deal email
 *   4. Updates Vercel KV with today's deal handle
 */
export async function dealActivator(): Promise<{ vaulted: string | null; activated: string | null }> {
  return rotateDeal()
}
