import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { reorderProductImages } from '~/lib/shopify.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let productId: string, imageIds: number[]
  try {
    const body = await request.json() as { productId?: string; imageIds?: number[] }
    productId = body.productId ?? ''
    imageIds  = Array.isArray(body.imageIds) ? body.imageIds.map(Number) : []
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!productId)          return Response.json({ error: 'productId is required' }, { status: 400 })
  if (imageIds.length === 0) return Response.json({ error: 'imageIds is required' }, { status: 400 })

  const positions = imageIds.map((id, idx) => ({ id, position: idx + 1 }))
  await reorderProductImages(productId, positions)
  return Response.json({ ok: true })
}
