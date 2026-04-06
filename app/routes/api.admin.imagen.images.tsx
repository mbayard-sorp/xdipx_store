import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getProductAdminImages } from '~/lib/shopify.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url       = new URL(request.url)
  const productId = url.searchParams.get('productId') ?? ''
  if (!productId) return Response.json({ error: 'productId required' }, { status: 400 })
  const images = await getProductAdminImages(productId)
  return Response.json({ images })
}
