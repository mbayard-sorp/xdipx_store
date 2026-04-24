import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId, updateProductMetafield } from '~/lib/shopify.server'
import { generateSensationDialV2 } from '~/lib/claude.server'
import { getDialLabelsForType } from '~/lib/dial-registry.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = form.get('productId') as string
  const dryRun    = form.get('dryRun') === '1'
  if (!productId) return { ok: false, error: 'Missing productId' }

  const deal = await getDealByShopifyId(productId)
  if (!deal) return { ok: false, error: 'Deal not found' }
  if (!deal.productTypeDial) return { ok: false, error: 'Product missing xdipx.product_type_dial — set it before generating.' }

  try {
    const preferredLabels = await getDialLabelsForType(deal.productTypeDial)
    const dial = await generateSensationDialV2({ deal, preferredLabels })
    if (!dryRun) {
      await updateProductMetafield(productId, 'sensation_dial_v2', JSON.stringify(dial), 'json')
    }
    const proposed = dial.items.filter(it => it.proposed === true).map(it => it.label)
    return { ok: true, dial, proposed, preferredLabels, written: !dryRun }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Generation failed' }
  }
}
