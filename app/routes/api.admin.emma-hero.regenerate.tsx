import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDealByShopifyId, updateProductMetafield } from '~/lib/shopify.server'
import { generateEmmaHero } from '~/lib/claude.server'
import type { EmmaHeroVariant } from '~/types'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId = form.get('productId') as string
  const variantOverride = (form.get('variant') as string) || ''
  if (!productId) return { ok: false, error: 'Missing productId' }

  const deal = await getDealByShopifyId(productId)
  if (!deal) return { ok: false, error: 'Deal not found' }

  const variant: EmmaHeroVariant =
    variantOverride === 'loving' || variantOverride === 'bundle' || variantOverride === 'quote'
      ? variantOverride
      : deal.mapRestricted ? 'quote' : 'loving'

  try {
    const copy = await generateEmmaHero({ deal, variant })
    await updateProductMetafield(productId, 'emma_hero', JSON.stringify(copy), 'json')
    // Mirror the Emma signature into xdipx.tagline so anything that still reads
    // the tagline metafield (PDP header, legacy cards) picks up Emma's voice
    // automatically.
    if (copy.aside) {
      await updateProductMetafield(productId, 'tagline', copy.aside, 'single_line_text_field')
    }
    return { ok: true, copy }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Generation failed' }
  }
}
