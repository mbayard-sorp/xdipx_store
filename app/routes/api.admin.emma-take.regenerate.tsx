import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId, updateProductDescriptionHtml } from '~/lib/shopify.server'
import { generateEmmaTake } from '~/lib/claude.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = form.get('productId') as string
  const dryRun    = form.get('dryRun') === '1'
  if (!productId) return { ok: false, error: 'Missing productId' }

  const deal = await getDealByShopifyId(productId)
  if (!deal) return { ok: false, error: 'Deal not found' }

  try {
    const html = await generateEmmaTake({ deal })
    if (!dryRun) {
      await updateProductDescriptionHtml(productId, html)
    }
    return { ok: true, html, written: !dryRun }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Generation failed' }
  }
}
