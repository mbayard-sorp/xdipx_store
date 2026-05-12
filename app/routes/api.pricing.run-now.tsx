import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { runDailyPriceReview } from '~/lib/pricing-agent.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const result = await runDailyPriceReview({ source: 'manual', dryRun: false })
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('lock')) {
      return Response.json({ ok: false, error: 'Review already running. Try again in a moment.' }, { status: 409 })
    }
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
