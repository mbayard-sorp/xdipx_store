import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getCachedProductTypes, getPricingRules } from '~/lib/pricing-agent.server'
import { suggestMarkupsByType } from '~/lib/pricing-suggestions.server'
import { HIGH_MARGIN_DISCOUNT, MEDIUM_MARGIN_DISCOUNT } from '~/lib/pricing-engine.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const url = new URL(request.url)
    const bypassCache = url.searchParams.get('fresh') === '1'

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

    const result = await suggestMarkupsByType({ types, globalHighDiscount, globalMediumDiscount, bypassCache })

    if (result.suggestions.length === 0) {
      return Response.json({
        ok: false,
        error: result.debug?.error ?? 'Claude returned no usable suggestions. See debug.',
        debug: result.debug,
        types,
      }, { status: 502 })
    }

    return Response.json({ ok: true, suggestions: result.suggestions, debug: result.debug, types })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[api.pricing.suggest-markups]', msg)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
