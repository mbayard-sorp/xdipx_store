import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { dryRunRuleChange } from '~/lib/pricing-apply-v2.server'
import type { RuleOverride } from '~/lib/pricing-apply-v2.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let overrides: RuleOverride[] = []
  try {
    const body = await request.json() as { overrides?: RuleOverride[] }
    overrides = body.overrides ?? []
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = await dryRunRuleChange({ overrides })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
