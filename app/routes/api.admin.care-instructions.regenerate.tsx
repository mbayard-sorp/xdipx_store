import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId, updateProductMetafield } from '~/lib/shopify.server'
import { generateCareInstructions } from '~/lib/claude.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = form.get('productId') as string
  const dryRun    = form.get('dryRun') === '1'
  if (!productId) return { ok: false, error: 'Missing productId' }

  const deal = await getDealByShopifyId(productId)
  if (!deal) return { ok: false, error: 'Deal not found' }

  try {
    const bullets = await generateCareInstructions({ deal })
    if (!dryRun) {
      await updateProductMetafield(productId, 'care_instructions', JSON.stringify(bullets), 'json')
    }
    return { ok: true, bullets, written: !dryRun }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Generation failed' }
  }
}
