import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId, updateProductMetafield } from '~/lib/shopify.server'
import type { SensationDialV2 } from '~/types'

/**
 * Rename a single dial label on a product (no registry write). Used when the
 * editor decides a "proposed" label is actually a synonym of an existing
 * registry entry — they pick the existing label and we rewrite the product's
 * dial v2 in place.
 *
 * POST fields: productId, fromLabel, toLabel
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = String(form.get('productId') ?? '').trim()
  const fromLabel = String(form.get('fromLabel') ?? '').trim()
  const toLabel   = String(form.get('toLabel')   ?? '').trim()
  if (!productId || !fromLabel || !toLabel) return { ok: false, error: 'Missing productId, fromLabel, or toLabel' }

  const deal = await getDealByShopifyId(productId)
  if (!deal?.sensationDialV2?.items) return { ok: false, error: 'Product has no sensation_dial_v2' }

  const items = deal.sensationDialV2.items
  if (!items.some(it => it.label.toLowerCase() === fromLabel.toLowerCase())) {
    return { ok: false, error: `Label "${fromLabel}" not found on product` }
  }
  if (items.some(it => it.label.toLowerCase() === toLabel.toLowerCase() && it.label.toLowerCase() !== fromLabel.toLowerCase())) {
    return { ok: false, error: `Label "${toLabel}" already on this product — rename would dedupe.` }
  }

  const next: SensationDialV2 = {
    items: items.map(it => {
      if (it.label.toLowerCase() !== fromLabel.toLowerCase()) return it
      const { proposed: _proposed, ...rest } = it
      return { ...rest, label: toLabel }
    }),
  }

  try {
    await updateProductMetafield(productId, 'sensation_dial_v2', JSON.stringify(next), 'json')
    return { ok: true, dial: next }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Update failed' }
  }
}
