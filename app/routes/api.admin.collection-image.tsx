import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { updateCollectionImage } from '~/lib/shopify.server'
import { applyWatermark } from '~/lib/watermark.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let collectionId: string, base64: string, alt: string
  try {
    const body = await request.json() as {
      collectionId?: string
      base64?: string
      mimeType?: string
      alt?: string
    }
    collectionId = body.collectionId ?? ''
    base64 = body.base64 ?? ''
    alt = body.alt ?? 'Collection image'
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!collectionId) return Response.json({ error: 'collectionId is required' }, { status: 400 })
  if (!base64) return Response.json({ error: 'base64 image data is required' }, { status: 400 })

  const rawBuffer = Buffer.from(base64, 'base64')
  const buffer = await applyWatermark(rawBuffer)
  const filename = `collection-${Date.now()}.jpg`

  try {
    const imageUrl = await updateCollectionImage(collectionId, buffer, filename, alt)
    return Response.json({ ok: true, imageUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 502 })
  }
}
