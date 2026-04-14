import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { searchAdminProducts } from '~/lib/shopify.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const q   = url.searchParams.get('q') ?? ''
  try {
    const products = await searchAdminProducts(q, 20)
    return Response.json({ products })
  } catch (err) {
    console.error('[api.product-search] error:', err)
    return Response.json({ products: [], error: 'Search failed' }, { status: 200 })
  }
}
