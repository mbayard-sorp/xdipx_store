import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { recomputeCatalog } from '~/lib/pricing-apply-v2.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const result = await recomputeCatalog({ trigger: 'manual' })
    return Response.json({
      ok: true,
      total: result.total,
      autoApplied: result.autoApplied,
      pending: result.pending,
      skipped: result.skipped,
      rejected: result.rejected,
      errors: result.errors,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('lock')) {
      return Response.json({ ok: false, error: 'Review already running. Try again in a moment.' }, { status: 409 })
    }
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
