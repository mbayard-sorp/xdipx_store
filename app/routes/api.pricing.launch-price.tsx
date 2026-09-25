import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { findVariantsBySkus, setVariantLaunchPrice } from '~/lib/shopify.server'
import { recomputeVariant } from '~/lib/pricing-apply-v2.server'

/**
 * Reset a variant's xdipx.launch_price to its current sell price (owner
 * direction 2026-09-25). Used when the owner deliberately reprices a product
 * and does not want the old launch price shown as a strike-through. The
 * variant is repriced immediately so the compare-at reflects the new anchor.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  let sku = ''
  try {
    const body = await request.json() as { sku?: unknown }
    sku = typeof body.sku === 'string' ? body.sku.trim() : ''
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!sku) return Response.json({ ok: false, error: 'sku required' }, { status: 400 })

  const matches = await findVariantsBySkus([sku])
  const match = matches.find(m => m.variant.sku === sku) ?? matches[0]
  if (!match) return Response.json({ ok: false, error: `No variant with SKU ${sku}` }, { status: 404 })

  await setVariantLaunchPrice(match.variant.variantId, match.variant.price)
  const result = await recomputeVariant({ variantId: match.variant.variantId, trigger: 'manual' })
  return Response.json({ ok: true, sku, launchPrice: match.variant.price, recompute: result.status })
}
