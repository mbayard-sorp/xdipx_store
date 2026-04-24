import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDailyDeal, shopifyAdmin } from '~/lib/shopify.server'

/**
 * GET /api/admin/emma-hero/debug
 *
 * Returns both sides of the Emma hero pipeline so we can see where the chain
 * is breaking when the homepage doesn't reflect a regenerate:
 *
 *   - admin.rawValue: what Shopify Admin REST reports for xdipx.emma_hero
 *     (authoritative — this is what regen wrote)
 *   - storefront.deal.emmaHero: what the Storefront API returns through the
 *     same path the homepage loader uses (if null, it's a visibility issue)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const deal = await getDailyDeal()
  if (!deal) return { error: 'No live deal' }

  const numericId = deal.shopifyProductId.replace('gid://shopify/Product/', '')
  type MfRes = { metafields: Array<{ namespace: string; key: string; value: string; type: string }> }
  const admin = await shopifyAdmin<MfRes>(
    `/products/${numericId}/metafields.json?namespace=xdipx`,
  ).catch((err: Error) => ({ error: err.message }))

  const adminEmma = 'metafields' in admin
    ? admin.metafields.find(m => m.key === 'emma_hero') ?? null
    : null

  return {
    productHandle: deal.handle,
    productId:     deal.shopifyProductId,
    admin: {
      allKeys:  'metafields' in admin ? admin.metafields.map(m => `${m.namespace}.${m.key}`) : [],
      emmaHero: adminEmma,
    },
    storefront: {
      emmaHero:      deal.emmaHero ?? null,
      mapRestricted: deal.mapRestricted,
      tagline:       deal.tagline,
    },
    diagnosis:
      !adminEmma
        ? 'WRITE MISSING — regen did not persist to Shopify. Check /api/admin/emma-hero/regenerate action logs.'
      : !deal.emmaHero
        ? 'STOREFRONT VISIBILITY — metafield exists in Admin but Storefront returns null. Run `npx tsx scripts/shopify-metafield-defs.ts` to grant storefront access.'
      : 'OK — homepage should reflect this copy. If it does not, hard-refresh.',
  }
}
