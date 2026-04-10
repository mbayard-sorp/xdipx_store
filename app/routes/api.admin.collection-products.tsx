import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getCollectionProducts } from '~/lib/shopify.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const handle = url.searchParams.get('handle')
  if (!handle) return Response.json({ error: 'handle required' }, { status: 400 })

  const products = await getCollectionProducts(handle, 50)
  return Response.json({
    products: products.map(p => ({
      id: p.id,
      title: p.title,
      images: p.images.map(img => ({ url: img.url, altText: img.altText })),
    })),
  })
}
