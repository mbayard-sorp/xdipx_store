import type { LoaderFunctionArgs } from 'react-router'
import { getProductsByHandles } from '~/lib/shopify.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const handlesParam = url.searchParams.get('handles') ?? ''
  const handles = handlesParam.split(',').map(h => h.trim()).filter(Boolean).slice(0, 20)
  if (handles.length === 0) return Response.json({ products: [] })

  const products = await getProductsByHandles(handles)
  const byHandle = new Map(products.map(p => [p.handle, p]))
  const ordered = handles
    .map(h => byHandle.get(h))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(p => ({
      handle: p.handle,
      title:  p.title,
      image:  p.images[0]?.url ?? null,
      price:  p.price,
      compareAtPrice: p.compareAtPrice ?? null,
    }))

  return Response.json({ products: ordered })
}
