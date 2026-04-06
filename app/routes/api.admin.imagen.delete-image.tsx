import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { deleteProductImage } from '~/lib/shopify.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let productId: string, imageId: number
  try {
    const body = await request.json() as { productId?: string; imageId?: number }
    productId = body.productId ?? ''
    imageId   = Number(body.imageId)
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!productId) return Response.json({ error: 'productId is required' }, { status: 400 })
  if (!imageId)   return Response.json({ error: 'imageId is required' },   { status: 400 })

  await deleteProductImage(productId, imageId)
  return Response.json({ ok: true })
}
