import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { recomputeCatalog } from '~/lib/pricing-apply-v2.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const result = await recomputeCatalog({ trigger: 'manual' })
    return Response.json({
      ok: true,
      scanned: result.total,
      applied: result.autoApplied,
      pending: result.pending,
      rejected: result.rejected,
      skipped: result.skipped,
      missingCost: result.missingCost,
      errors: result.errors,
      changesProposed: result.autoApplied + result.pending,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
