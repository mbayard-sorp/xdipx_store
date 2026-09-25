// pricing-kick.server.ts
//
// Fire-and-forget request for a catalog recompute. Rule saves and the admin
// "Run Review Now" button used to either wait for the next 07:00 UTC batch or
// run recomputeCatalog inline with no lock and no time budget (which could
// overrun the serverless limit and clobber the day's batch cursor). Both now
// go through the cron endpoint, which owns the KV lock, the 240s budget, and
// the self-continuation, so a kick is safe to fire at any time of day.

export type PricingKickResult = 'kicked' | 'no_origin' | 'failed'

export async function kickPricingRecompute(reason: string): Promise<PricingKickResult> {
  const origin = process.env['APP_URL'] ?? process.env['VERCEL_URL']
  const secret = process.env['CRON_SECRET']
  if (!origin || !secret) {
    console.warn(`[pricing-kick] no APP_URL/CRON_SECRET; cannot kick recompute (${reason})`)
    return 'no_origin'
  }
  const base = origin.startsWith('http') ? origin : `https://${origin}`
  try {
    // Not awaited to completion: the cron handler takes the lock and runs on
    // its own invocation. We only need the request to be accepted.
    void fetch(`${base}/cron/pricing-batch-recompute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ trigger: 'manual', reason }),
    }).catch(e => console.warn('[pricing-kick] recompute kick failed:', e))
    return 'kicked'
  } catch (e) {
    console.warn('[pricing-kick] recompute kick threw:', e)
    return 'failed'
  }
}
