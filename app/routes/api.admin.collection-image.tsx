import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { updateCollectionImage, type CollectionImageSource } from '~/lib/shopify.server'

// No watermark on this path: a collection image renders as the hub card, the
// PLP hero and og:image, and design doctrine §4 keeps text and logos out of
// those pixels (the site logo stamp was the only thing this route added).
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let collectionId: string, base64: string, url: string, mimeType: string, alt: string
  try {
    const body = await request.json() as {
      collectionId?: string
      base64?: string
      url?: string
      mimeType?: string
      alt?: string
    }
    collectionId = body.collectionId ?? ''
    base64 = body.base64 ?? ''
    url = body.url ?? ''
    mimeType = body.mimeType ?? 'image/jpeg'
    alt = body.alt ?? 'Collection image'
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!collectionId) return Response.json({ error: 'collectionId is required' }, { status: 400 })
  if (!base64 && !url) return Response.json({ error: 'base64 image data or url is required' }, { status: 400 })

  const type = mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg'
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  const source: CollectionImageSource = url
    ? { url }
    : { buffer: Buffer.from(base64, 'base64'), filename: `collection-${Date.now()}.${ext}`, mimeType: type }

  try {
    const imageUrl = await updateCollectionImage(collectionId, source, alt)
    return Response.json({ ok: true, imageUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 502 })
  }
}
