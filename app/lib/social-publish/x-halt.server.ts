/**
 * Account-wide halt flag for X publishing (ticket #18013).
 *
 * The publish tick used to let every queued X post individually run the
 * publish call, fail, and (on its second strike) file its own per-post
 * dead-row `code` ticket, even when the cause is account-wide and has no
 * per-post code fix: X's pay-per-use credits depleted on 2026-10-22 and six
 * different posts (#494, #496, #497, #501, #505, #508) each independently
 * went terminal and filed six identical-cause tickets that week. The owner
 * blocker (`x-publish-blocked-credits`, see social-publish-job.server.ts)
 * already deduped correctly across those six; the per-post `code` ticket did
 * not.
 *
 * This flag, checked once per tick before claiming each candidate, stops the
 * tick from even attempting the rest of the queue while a 402 credits-
 * depleted response is live, so the backlog stays queued and untouched
 * instead of manufacturing a ticket per post.
 *
 * Short-lived rather than a standing kill switch: it expires on its own, so a
 * missed clearing write cannot silently freeze posting forever, and the next
 * successful publish clears it explicitly and immediately.
 */

import { kvGet, kvSet, kvDel } from '~/lib/kv.server'

const HALT_KEY = 'x-publish:credits-halt'

/** 1h: long enough to outlast a tick's own retry cadence, short enough that a missed clear self-heals within the hour. */
const HALT_TTL_SECONDS = 60 * 60

export async function isXPublishHalted(): Promise<boolean> {
  try {
    return (await kvGet<string>(HALT_KEY)) != null
  } catch (err) {
    // Unknown must not block posting: fail open to "not halted" so a KV
    // outage degrades to the pre-fix per-post behavior, not a silent,
    // undiagnosable posting freeze.
    console.error('[x-publish-halt] read failed, assuming not halted:', err)
    return false
  }
}

export async function setXPublishHalt(): Promise<void> {
  try {
    await kvSet(HALT_KEY, '1', HALT_TTL_SECONDS)
  } catch (err) {
    console.error('[x-publish-halt] set failed (ignored):', err)
  }
}

export async function clearXPublishHalt(): Promise<void> {
  try {
    await kvDel(HALT_KEY)
  } catch (err) {
    console.error('[x-publish-halt] clear failed (ignored):', err)
  }
}
