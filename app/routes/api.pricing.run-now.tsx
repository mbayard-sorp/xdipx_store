import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { kickPricingRecompute } from '~/lib/pricing-kick.server'

/**
 * "Run Review Now". Used to call recomputeCatalog inline: no KV lock, no time
 * budget, and it overwrote the day's batch cursor, so a click during the
 * 07:00 walk could race it and a full-catalog run could outlive the 300s
 * serverless limit. It now kicks the cron endpoint, which owns all three.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const kicked = await kickPricingRecompute('admin run-now')
  if (kicked !== 'kicked') {
    return Response.json({ ok: false, error: `Could not start the recompute (${kicked}).` }, { status: 500 })
  }
  return Response.json({ ok: true, started: true })
}
