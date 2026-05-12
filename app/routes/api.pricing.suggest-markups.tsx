import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getCachedProductTypes, getPricingRules } from '~/lib/pricing-agent.server'
import { suggestMarkupsByType } from '~/lib/pricing-suggestions.server'
import { HIGH_MARGIN_DISCOUNT, MEDIUM_MARGIN_DISCOUNT } from '~/lib/pricing-engine.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const [cache, rules] = await Promise.all([
      getCachedProductTypes(),
      getPricingRules(),
    ])

    const types = cache?.types ?? []
    if (types.length === 0) {
      return Response.json(
        { ok: false, error: 'No product types loaded yet. Click "Refresh types from Shopify" first.' },
        { status: 400 },
      )
    }

    const globalHighDiscount = rules.highMarginDiscount ?? HIGH_MARGIN_DISCOUNT
    const globalMediumDiscount = rules.mediumMarginDiscount ?? MEDIUM_MARGIN_DISCOUNT

    const suggestions = await suggestMarkupsByType({ types, globalHighDiscount, globalMediumDiscount })

    return Response.json({ ok: true, suggestions, types })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
