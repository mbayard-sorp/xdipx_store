import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { appendDialLabel } from '~/lib/dial-registry.server'
import { getDealByShopifyId, updateProductMetafield } from '~/lib/shopify.server'
import { PRODUCT_TYPE_DIALS, type ProductTypeDial, type SensationDialV2 } from '~/types'

// Phase 1 rebuild — only the legacy {vibrator, lube, wear} subset of the
// expanded ProductTypeDial currently has a Sanity dialRegistry field mapped
// (see TYPE_TO_FIELD in dial-registry.server.ts). Until the Sanity schema
// migration adds fields for the remaining 16 top-level types, this admin
// endpoint refuses appends for unmapped types with a clear error message.
const VALID_TYPES: readonly ProductTypeDial[] = PRODUCT_TYPE_DIALS

/**
 * Accept a proposed dial label: append to the Sanity registry for its product
 * type, then clear the `proposed: true` flag on the live product's dial v2.
 *
 * POST fields: productId, productTypeDial, label
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const productId       = String(form.get('productId') ?? '').trim()
  const productTypeDial = String(form.get('productTypeDial') ?? '').trim() as ProductTypeDial
  const label           = String(form.get('label') ?? '').trim()
  if (!productId || !label) return { ok: false, error: 'Missing productId or label' }
  if (!VALID_TYPES.includes(productTypeDial)) return { ok: false, error: 'Invalid productTypeDial' }

  try {
    const updatedRegistry = await appendDialLabel(productTypeDial, label)

    const deal = await getDealByShopifyId(productId)
    if (deal?.sensationDialV2?.items) {
      const next: SensationDialV2 = {
        items: deal.sensationDialV2.items.map(it => {
          if (it.label.toLowerCase() === label.toLowerCase() && it.proposed) {
            const { proposed: _proposed, ...rest } = it
            return rest
          }
          return it
        }),
      }
      await updateProductMetafield(productId, 'sensation_dial_v2', JSON.stringify(next), 'json')
    }

    return { ok: true, registry: updatedRegistry }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Append failed' }
  }
}
