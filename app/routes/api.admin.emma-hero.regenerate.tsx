import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import { enqueueFieldRegenJob } from '~/lib/field-regen-runner.server'
import type { EmmaHeroVariant } from '~/types'

/**
 * POST /api/admin/emma-hero/regenerate
 *
 * Enqueues an async field-regen batch job for the Emma hero block.
 * Returns { ok, jobId, status: 'queued' } immediately.
 * Track progress at /admin/async-jobs?jobId=<jobId>.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = form.get('productId') as string
  const variantOverride = (form.get('variant') as string) || ''
  if (!productId) return Response.json({ ok: false, error: 'Missing productId' }, { status: 400 })

  const deal = await getDealByShopifyId(productId)
  if (!deal) return Response.json({ ok: false, error: 'Deal not found' }, { status: 404 })

  const variant: EmmaHeroVariant =
    variantOverride === 'loving' || variantOverride === 'bundle' || variantOverride === 'quote'
      ? variantOverride
      : deal.mapRestricted ? 'quote' : 'loving'

  const sku = deal.sku ?? deal.handle

  const { jobId } = await enqueueFieldRegenJob({
    kind:      'emma-hero',
    productId: deal.shopifyProductId,
    sku,
    deal: {
      seoTitle:  deal.seoTitle,
      tagline:   deal.tagline,
      fullStory: deal.fullStory,
      brand:     deal.brand,
      category:  deal.category,
      dealPrice: deal.dealPrice,
      msrp:      deal.msrp,
      // exactOptionalPropertyTypes: only include when defined
      ...(deal.mapRestricted !== undefined ? { mapRestricted: deal.mapRestricted } : {}),
    },
    variant,
  })

  return Response.json({
    ok:     true,
    jobId,
    status: 'queued',
    message: `Emma hero regeneration queued as job ${jobId}. Track at /admin/async-jobs?jobId=${jobId}`,
  })
}
