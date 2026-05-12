import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDistinctProductTypes } from '~/lib/shopify.server'
import { getPricingRules } from '~/lib/pricing-agent.server'
import { suggestMarkupsByType } from '~/lib/pricing-suggestions.server'
import { HIGH_MARGIN_DISCOUNT, MEDIUM_MARGIN_DISCOUNT } from '~/lib/pricing-engine.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const [types, rules] = await Promise.all([
      getDistinctProductTypes(),
      getPricingRules(),
    ])

    const globalHighDiscount = rules.highMarginDiscount ?? HIGH_MARGIN_DISCOUNT
    const globalMediumDiscount = rules.mediumMarginDiscount ?? MEDIUM_MARGIN_DISCOUNT

    const suggestions = await suggestMarkupsByType({ types, globalHighDiscount, globalMediumDiscount })

    return Response.json({ ok: true, suggestions, types })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
