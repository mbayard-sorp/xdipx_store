import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getCachedProductTypes } from '~/lib/pricing-agent.server'
import { suggestMarkupsByType } from '~/lib/pricing-suggestions.server'
import { getGlobalRule } from '~/lib/pricing-admin.server'

// Global defaults when no DB row exists yet
const DEFAULT_TARGET_MARGIN = 0.45
const DEFAULT_MARGIN_FLOOR = 0.20

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const url = new URL(request.url)
    const bypassCache = url.searchParams.get('fresh') === '1'

    const [cache, globalRule] = await Promise.all([
      getCachedProductTypes(),
      getGlobalRule(),
    ])

    const types = cache?.types ?? []
    if (types.length === 0) {
      return Response.json(
        { ok: false, error: 'No product types loaded yet. Click "Refresh types from Shopify" first.' },
        { status: 400 },
      )
    }

    const globalTargetMarginPct = globalRule.targetMarginPct ?? DEFAULT_TARGET_MARGIN
    const globalMarginFloorPct = globalRule.marginFloorPct ?? DEFAULT_MARGIN_FLOOR

    const result = await suggestMarkupsByType({
      types,
      globalTargetMarginPct,
      globalMarginFloorPct,
      bypassCache,
    })

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
