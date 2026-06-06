import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import { enqueueFieldRegenJob } from '~/lib/field-regen-runner.server'

/**
 * POST /api/admin/emma-take/regenerate
 *
 * Enqueues an async field-regen batch job for Emma's product take (descriptionHtml).
 * Returns { ok, jobId, status: 'queued' } immediately.
 * Track progress at /admin/async-jobs?jobId=<jobId>.
 *
 * Pass dryRun=1 to enqueue without writing (result visible in job runner state).
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = form.get('productId') as string
  const dryRun    = form.get('dryRun') === '1'
  if (!productId) return Response.json({ ok: false, error: 'Missing productId' }, { status: 400 })

  const deal = await getDealByShopifyId(productId)
  if (!deal) return Response.json({ ok: false, error: 'Deal not found' }, { status: 404 })

  const sku = deal.sku ?? deal.handle

  const { jobId } = await enqueueFieldRegenJob({
    kind:      'emma-take',
    productId: deal.shopifyProductId,
    sku,
    deal: {
      seoTitle:  deal.seoTitle,
      tagline:   deal.tagline,
      fullStory: deal.fullStory,
      brand:     deal.brand,
      category:  deal.category,
      // exactOptionalPropertyTypes: only include when defined
      ...(deal.productTypeDial !== undefined ? { productTypeDial: deal.productTypeDial } : {}),
    },
    ...(dryRun ? { dryRun: true } : {}),
  })

  return Response.json({
    ok:     true,
    jobId,
    status: 'queued',
    message: `Emma take regeneration queued as job ${jobId}. Track at /admin/async-jobs?jobId=${jobId}`,
  })
}
