/**
 * Internal endpoint for the Fly.io IVR service to fetch today's live deal.
 * Guarded by a shared secret header; never exposed to end users.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { getDailyDeal } from '~/lib/shopify.server'
import { verifyInternalSecret } from '~/lib/env.server'

export async function loader({ request }: LoaderFunctionArgs) {
  if (!verifyInternalSecret(request.headers.get('x-internal-secret'), 'INTERNAL_API_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const deal = await getDailyDeal()
  if (!deal) {
    return Response.json({ deal: null })
  }

  // Return a slim shape — the IVR only needs what Claude will say aloud.
  const origin = new URL(request.url).origin
  return Response.json({
    deal: {
      title: deal.seoTitle,
      tagline: deal.tagline,
      brand: deal.brand,
      category: deal.category,
      dealPrice: deal.dealPrice,
      msrp: deal.msrp,
      mapPrice: deal.mapPrice,
      savingsPct: deal.msrp > 0 ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100) : 0,
      inStock: deal.qty > 0,
      url: `${origin}/products/${deal.handle}`,
    },
  })
}
